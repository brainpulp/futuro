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

  // Fetch all outflow transactions — query both `cat` and `project` fields
  // so we catch historically-tagged (via cat) and newly-tagged (via project) transactions
  const { data, error } = await supabase
    .from('transactions')
    .select('project, cat, ym, usd, xfer')
    .is('deleted_at', null)
    .not('usd', 'is', null)
    .lt('usd', 0); // outflows only

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Aggregate by tag: use `project` if set, else `cat`
  // This covers transactions tagged either way
  const result: Record<string, { byMonth: Record<string, number> }> = {};

  for (const tx of data) {
    if (tx.xfer) continue;
    const usd = Number(tx.usd);
    if (usd >= 0) continue;

    // Use project field if non-empty, otherwise fall back to cat
    const tag = (tx.project || '').trim() || (tx.cat || '').trim();
    if (!tag) continue;

    const amt = Math.round(Math.abs(usd) * 100) / 100;
    const ym = tx.ym as string;
    const key = tag.toLowerCase();

    if (!result[key]) result[key] = { byMonth: {} };
    result[key].byMonth[ym] = Math.round(((result[key].byMonth[ym] || 0) + amt) * 100) / 100;
  }

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
