import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Recibe el Net Liquidation Value en vivo desde el script que corre junto a IB Gateway.
// POST {"net_liq": 1434853.12, "currency": "USD"} con header x-push-key = secret IBKR_PUSH_KEY.
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const key = Deno.env.get('IBKR_PUSH_KEY');
  if (!key) return new Response(JSON.stringify({ error: 'IBKR_PUSH_KEY not set' }), { status: 500 });
  if (req.headers.get('x-push-key') !== key) return new Response('forbidden', { status: 403 });

  let body: { net_liq?: unknown; currency?: unknown };
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const netLiq = Number(body.net_liq);
  if (!Number.isFinite(netLiq) || netLiq <= 0) return new Response('bad net_liq', { status: 400 });
  const currency = typeof body.currency === 'string' && body.currency.length <= 8 ? body.currency : 'USD';

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await sb.from('ibkr_live').insert({ net_liq: netLiq, currency });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  // keep the table small: one row per push, prune anything older than 30 days
  await sb.from('ibkr_live').delete().lt('at', new Date(Date.now() - 30 * 86400e3).toISOString());
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
