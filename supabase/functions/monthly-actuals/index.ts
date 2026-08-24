import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// How many days short of the month's end still counts as a complete upload. A bank
// statement usually has activity on the last day, but a quiet weekend at month end
// should not condemn an otherwise finished month. Anything cut earlier than this is a
// statement that has not been uploaded in full, and every total built from it
// understates real spending.
const COVERAGE_SLACK_DAYS = 3;

// All the arithmetic lives in monthly_actuals_agg() -- the category group, the internal
// transfers, the vendor precedent for unfiled rows. Doing it in SQL keeps it to one pass
// and, just as importantly, sidesteps PostgREST's silent 1000-row cap: this used to be
// three paged selects, and before the paging existed it dropped two thirds of the ledger
// without a word, taking the most recent months with it.
//
// This function only reshapes and attaches coverage. Changing the SQL needs no redeploy;
// changing either function's SIGNATURE does.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const [agg, cov] = await Promise.all([
    supabase.rpc('monthly_actuals_agg'),
    supabase.rpc('monthly_coverage'),
  ]);

  if (agg.error) {
    return new Response(JSON.stringify({ error: agg.error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // How far into each month the upload actually reaches. Measured over EVERY transaction
  // in the month, not the category subset: whether a statement was uploaded in full is a
  // property of the upload, and a month with no groceries in its last week is not the
  // same thing as a month that was cut short.
  const coverage: Record<string, { lastDay: number; days: number }> = {};
  for (const c of ((cov.data ?? []) as Array<Record<string, unknown>>)) {
    coverage[String(c.ym)] = {
      lastDay: Number(c.last_day) || 0,
      days:    Number(c.days_in_month) || 0,
    };
  }

  const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

  const result = ((agg.data ?? []) as Array<Record<string, unknown>>)
    .map(r => {
      const ym = String(r.ym);
      const c = coverage[ym];
      return {
        ym,
        usd: num(r.usd),
        // Rows the owner never filed, which count as living costs unless their vendor has
        // a precedent. Reported so a month resting on unfiled spend is legible rather
        // than silently folded into the baseline.
        unfiled:  num(r.unfiled),
        unfiledN: Number(r.unfiled_n) || 0,
        // Unfiled money the owner's own vendor history routed OUT of living costs --
        // project labour, mostly. Worth showing: it is the difference between a baseline
        // and a baseline with someone's construction crew in it.
        inferredOut: num(r.inferred_out),
        // Unfiled and no precedent either: counted, but nothing corroborates it.
        unknown: num(r.unknown),
        // Whether the month's statements reach its end. A partial month is not a cheap
        // month, and both clients skip it rather than report a fraction of real costs.
        complete: c ? c.lastDay >= c.days - COVERAGE_SLACK_DAYS : true,
        lastDay:  c?.lastDay ?? null,
        days:     c?.days ?? null,
      };
    })
    .sort((a, b) => a.ym.localeCompare(b.ym));

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
