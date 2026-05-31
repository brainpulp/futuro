import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Fetch all transactions tagged with a project label (outflows only, non-xfer)
  const { data, error } = await supabase
    .from('transactions')
    .select('project, ym, usd, xfer')
    .is('deleted_at', null)
    .not('usd', 'is', null)
    .not('project', 'is', null)
    .neq('project', '');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Aggregate: { [project]: { total, byMonth: { [ym]: amount } } }
  const result: Record<string, { total: number; byMonth: Record<string, number> }> = {};

  for (const tx of data) {
    if (tx.xfer) continue;
    const usd = Number(tx.usd);
    if (usd >= 0) continue; // outflows only (expenses are negative in DB)
    const amt = Math.round(Math.abs(usd) * 100) / 100;
    const proj = tx.project as string;
    const ym = tx.ym as string;

    if (!result[proj]) result[proj] = { total: 0, byMonth: {} };
    result[proj].total = Math.round((result[proj].total + amt) * 100) / 100;
    result[proj].byMonth[ym] = Math.round(((result[proj].byMonth[ym] || 0) + amt) * 100) / 100;
  }

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
