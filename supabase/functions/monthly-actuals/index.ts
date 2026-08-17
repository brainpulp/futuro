import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Categories that represent money moving between the owner's own accounts rather
// than being spent. Defence in depth: the 'monthly expenses' group should never
// contain these, but if one is added by accident it must not inflate the baseline.
const INTERNAL_CATS = new Set(['interbank outgoing', 'interbank incoming', 'transfers']);

// Uncategorized outflows COUNT as monthly expenses. Nobody files every transaction, and
// leaving them out silently understated the baseline by whatever was forgotten.
//
// The exceptions are the ones that are self-evidently not household consumption. Each
// pattern below is here because it appears in this ledger and would otherwise land a
// lump sum in a single month's living costs:
//   pago proveedores      - a supplier payment run (2026-01: $4,924 to viamonte express)
//   transfer to           - a move into an investment vehicle (2026-07: $10,000 to Lucord)
//   pago + tarjeta de credito - the card BILL; the card's own purchases are separate rows,
//                               so counting the bill too would charge the same money twice
// Five rows in eleven months match. Keep this list short and evidence-based: guessing at
// intent from free text is how the `xfer` bug happened.
const NOT_CONSUMPTION: Array<(d: string) => boolean> = [
  d => d.includes('pago proveedores'),
  d => d.includes('transfer to '),
  d => d.includes('tarjeta de credito') && d.includes('pago'),
];

const PAGE = 1000;

// How many days short of the month's end still counts as a complete upload. A bank
// statement usually has activity on the last day, but a quiet weekend at month end
// should not condemn an otherwise finished month. Anything cut earlier than this is a
// statement that has not been uploaded in full, and every total built from it
// understates real spending.
const COVERAGE_SLACK_DAYS = 3;

type Row = { ym: string; usd: number | null; cat: string | null; raw_desc?: string | null; merchant?: string | null };

// PostgREST returns at most 1000 rows per request and says nothing about the rest. One
// of these filters matches ~3000 rows and the other ~1300, so a single select silently
// dropped most of them - and because rows come back roughly oldest-first, the months it
// dropped were the RECENT ones. The baseline then read ~$1.5k/mo against a true ~$5k.
async function pageAll(build: () => any): Promise<{ rows: Row[]; error: string | null }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return { rows, error: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Read the 'monthly expenses' group categories from gastos settings
  const { data: settingsRows } = await supabase
    .from('settings')
    .select('groups')
    .limit(1);

  const groups: Array<{ name: string; categories: string[] }> = settingsRows?.[0]?.groups ?? [];
  const monthlyGroup = groups.find(g => g.name?.toLowerCase() === 'monthly expenses');
  const cats: string[] = monthlyGroup?.categories ?? [];

  if (cats.length === 0) {
    return new Response(JSON.stringify({ error: 'No "monthly expenses" group defined in gastos settings' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const currentYM = new Date().toISOString().slice(0, 7);
  const base = () => supabase.from('transactions')
    .select('ym, usd, cat, raw_desc, merchant')
    .is('deleted_at', null)
    .not('usd', 'is', null)
    .lt('ym', currentYM);

  const filed = await pageAll(() => base().in('cat', cats));
  if (filed.error) {
    return new Response(JSON.stringify({ error: filed.error }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // `cat` is empty on rows that were never filed. PostgREST needs both spellings: a NULL
  // and an empty string are different values and `is.null` will not match ''.
  const unfiled = await pageAll(() => base().or('cat.is.null,cat.eq.'));
  if (unfiled.error) {
    return new Response(JSON.stringify({ error: unfiled.error }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // How far into each month the upload actually reaches. Measured over EVERY transaction
  // in the month, not the category subset: whether a statement was uploaded in full is a
  // property of the upload, and a month with no groceries in its last week is not the
  // same thing as a month that was cut short.
  const { data: cov } = await supabase.rpc('monthly_coverage');
  const coverage: Record<string, { lastDay: number; days: number }> = {};
  for (const c of (cov ?? []) as Array<Record<string, unknown>>) {
    coverage[String(c.ym)] = {
      lastDay: Number(c.last_day) || 0,
      days:    Number(c.days_in_month) || 0,
    };
  }

  const monthly: Record<string, number> = {};   // total charged to monthly expenses
  const unfiledSum: Record<string, number> = {}; // ...of which came from unfiled rows
  const heldBack: Record<string, { usd: number; n: number }> = {};

  for (const tx of filed.rows) {
    // NOTE: `xfer` marks HOW a payment was made (a bank transfer), not whether it
    // was internal. Skipping xfer rows here dropped real living costs that happen
    // to be paid by transferencia -- healthcare, boat maintenance, sports, pets --
    // understating the historical baseline by ~$8.2k. Internal movement is
    // identified by category instead, and the whitelist above already excludes it.
    if (INTERNAL_CATS.has((tx.cat ?? '').trim().toLowerCase())) continue;
    const usd = Number(tx.usd);
    if (usd >= 0) continue; // outflows only
    monthly[tx.ym] = (monthly[tx.ym] || 0) + Math.abs(usd);
  }

  for (const tx of unfiled.rows) {
    const usd = Number(tx.usd);
    if (usd >= 0) continue; // outflows only
    const amt = Math.abs(usd);
    const d = `${tx.raw_desc ?? ''} ${tx.merchant ?? ''}`.toLowerCase();
    if (NOT_CONSUMPTION.some(f => f(d))) {
      const h = heldBack[tx.ym] || (heldBack[tx.ym] = { usd: 0, n: 0 });
      h.usd += amt; h.n += 1;
      continue;
    }
    monthly[tx.ym] = (monthly[tx.ym] || 0) + amt;
    unfiledSum[tx.ym] = (unfiledSum[tx.ym] || 0) + amt;
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;

  // Every month is still returned, flagged rather than dropped, so a caller can say WHICH
  // month it skipped and why. Dropping them here would also have changed the response
  // out from under the copy of the desktop already deployed.
  const result = Object.entries(monthly)
    .map(([ym, usd]) => {
      const c = coverage[ym];
      const complete = c ? c.lastDay >= c.days - COVERAGE_SLACK_DAYS : true;
      const h = heldBack[ym];
      return {
        ym,
        usd: r2(usd),
        // How much of `usd` came from rows that were never categorized. Reported so a
        // month carrying an unusual amount of unfiled spend is legible rather than
        // silently folded into the baseline.
        unfiled: r2(unfiledSum[ym] || 0),
        heldBack: r2(h?.usd || 0),
        heldBackN: h?.n || 0,
        complete,
        lastDay: c?.lastDay ?? null,
        days:    c?.days ?? null,
      };
    })
    .sort((a, b) => a.ym.localeCompare(b.ym));

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
