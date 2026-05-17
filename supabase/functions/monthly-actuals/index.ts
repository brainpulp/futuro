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

  const { data, error } = await supabase
    .from('transactions')
    .select('ym, usd, xfer, cat')
    .is('deleted_at', null)
    .not('usd', 'is', null)
    .in('cat', cats)
    .lt('ym', currentYM);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const monthly: Record<string, number> = {};
  for (const tx of data) {
    if (tx.xfer) continue;
    const usd = Number(tx.usd);
    if (usd >= 0) continue; // outflows only
    monthly[tx.ym] = (monthly[tx.ym] || 0) + Math.abs(usd);
  }

  const result = Object.entries(monthly)
    .map(([ym, usd]) => ({ ym, usd: Math.round(usd * 100) / 100 }))
    .sort((a, b) => a.ym.localeCompare(b.ym));

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
