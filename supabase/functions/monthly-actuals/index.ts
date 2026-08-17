import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Categories that represent money moving between the owner's own accounts rather
// than being spent. Defence in depth: the 'monthly expenses' group should never
// contain these, but if one is added by accident it must not inflate the baseline.
const INTERNAL_CATS = new Set(['interbank outgoing', 'interbank incoming', 'transfers']);

const PAGE = 1000;

// How many days short of the month's end still counts as a complete upload. A bank
// statement usually has activity on the last day, but a quiet weekend at month end
// should not condemn an otherwise finished month. Anything cut earlier than this is a
// statement that has not been uploaded in full, and every total built from it
// understates real spending.
const COVERAGE_SLACK_DAYS = 3;

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

  // ⚠ PostgREST returns at most 1000 rows per request and says nothing about the rest.
  // This filter matches ~3000, so a single select silently dropped two thirds of them —
  // and because rows come back roughly oldest-first, the months it dropped were the
  // RECENT ones. The baseline then read ~$1.5k/mo against a true ~$5k. Page explicitly,
  // and order so the paging is deterministic.
  const rows: Array<{ ym: string; usd: number | null; cat: string | null }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('transactions')
      .select('ym, usd, cat')
      .is('deleted_at', null)
      .not('usd', 'is', null)
      .in('cat', cats)
      .lt('ym', currentYM)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  // How far into each month the upload actually reaches. Measured over EVERY transaction
  // in the month, not the category subset: whether a statement was uploaded in full is a
  // property of the upload, and a month with no groceries in its last week is not the
  // same thing as a month that was cut short.
  const { data: cov } = await supabase.rpc('monthly_coverage');
  const coverage: Record<string, {
    lastDay: number; days: number; nTx: number; uncatN: number; uncatUsd: number;
  }> = {};
  for (const c of (cov ?? []) as Array<Record<string, unknown>>) {
    coverage[String(c.ym)] = {
      lastDay:  Number(c.last_day) || 0,
      days:     Number(c.days_in_month) || 0,
      nTx:      Number(c.n_tx) || 0,
      uncatN:   Number(c.uncat_n) || 0,
      uncatUsd: Math.round((Number(c.uncat_usd) || 0) * 100) / 100,
    };
  }

  const monthly: Record<string, number> = {};
  for (const tx of rows) {
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

  // Every month is still returned, flagged rather than dropped, so a caller can say WHICH
  // month it skipped and why. Dropping them here would also have changed the response
  // out from under the copy of the desktop already deployed.
  const result = Object.entries(monthly)
    .map(([ym, usd]) => {
      const c = coverage[ym];
      const complete = c ? c.lastDay >= c.days - COVERAGE_SLACK_DAYS : true;
      return {
        ym,
        usd: Math.round(usd * 100) / 100,
        complete,
        lastDay:  c?.lastDay ?? null,
        days:     c?.days ?? null,
        uncatN:   c?.uncatN ?? 0,
        uncatUsd: c?.uncatUsd ?? 0,
      };
    })
    .sort((a, b) => a.ym.localeCompare(b.ym));

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
