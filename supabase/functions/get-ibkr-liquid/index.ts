import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The Flex Query to run. Overridable by secret so a new query does not need a redeploy --
// a wrong id here fails as an IBKR error code, which reads like a broken token.
const QUERY_ID = Deno.env.get('IBKR_QUERY_ID')?.trim() || '1510170';

// IBKR publishes a preliminary row for the current day (intraday, revised at night).
// Those rows have been off by ~1% (crypto valuation), so everything dated today in New
// York is dropped: only final closes are used.
function nyToday(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dropTodayRows(xml: string): string {
  const today = nyToday().replace(/-/g, '');
  return xml.replace(/<EquitySummaryByReportDate[A-Za-z]*\b[^>]*\breportDate="(\d{8})"[^>]*>/g,
    (row, d) => d >= today ? '' : row);
}

function extractLiquid(xml: string): number | null {
  const patterns = [
    /NetAssetValueByDate[^>]*\btotal="([^"]+)"/,
    /NetAssetValue[^>]*\btotal="([^"]+)"/,
    /EquitySummaryByReportDate[^>]*\btotal="([^"]+)"/,
    /AccountInformation[^>]*\bnetLiquidation="([^"]+)"/i,
  ];
  for (const p of patterns) {
    const all = [...xml.matchAll(new RegExp(p.source, 'g'))];
    if (all.length > 0) {
      const val = parseFloat(all[all.length - 1][1]);
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

// Daily NAV series from whichever daily section the query carries (IBKR suffixes the
// section with the currency mode, e.g. EquitySummaryByReportDateInBase). Rows come in
// date order. If the query selects "Report Date" the dates are exact; if not, dates are
// assigned by position — last row = today, then one business day back per row, which
// ignores US market holidays (a few days of drift on the yearly figure, none on the
// daily one).
function extractHistory(xml: string): { date: string; nav: number }[] {
  const rowRe = /<(?:NetAssetValueByDate|EquitySummaryByReportDate)[A-Za-z]*\b([^>]*)>/g;
  const rows: { date: string | null; nav: number }[] = [];
  for (const m of xml.matchAll(rowRe)) {
    const attrs = m[1];
    const t = attrs.match(/\btotal="([^"]+)"/)?.[1];
    const nav = t ? parseFloat(t) : NaN;
    if (isNaN(nav)) continue;
    const d = attrs.match(/\breportDate="([^"]+)"/)?.[1]?.replace(/\D/g, '');
    rows.push({ date: d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null, nav });
  }
  if (rows.some(r => r.date === null)) {
    const cur = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    cur.setHours(12, 0, 0, 0);
    for (let i = rows.length - 1; i >= 0; i--) {
      while (cur.getDay() === 0 || cur.getDay() === 6) cur.setDate(cur.getDate() - 1);
      rows[i].date = cur.toISOString().slice(0, 10);
      cur.setDate(cur.getDate() - 1);
    }
  }
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.date as string, r.nav);
  return [...byDate.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, nav]) => ({ date, nav }));
}

// External cash flows (deposits/withdrawals) per day, in base currency, from the
// Cash Transactions section. Dividends, interest and fees are NOT external flows: they
// are part of the return. Flows on days without a NAV row roll into the next NAV day.
function extractFlows(xml: string): Map<string, number> {
  const flows = new Map<string, number>();
  for (const m of xml.matchAll(/<CashTransaction\b([^>]*)>/g)) {
    const a = m[1];
    const type = a.match(/\btype="([^"]*)"/)?.[1] ?? '';
    if (!/deposits?\/withdrawals?/i.test(type)) continue;
    const amt = parseFloat(a.match(/\bamount="([^"]*)"/)?.[1] ?? '');
    if (isNaN(amt)) continue;
    const fx = parseFloat(a.match(/\bfxRateToBase="([^"]*)"/)?.[1] ?? '1');
    const raw = a.match(/\breportDate="([^"]*)"/)?.[1] ?? a.match(/\bdateTime="([^"]*)"/)?.[1] ?? '';
    const d = raw.replace(/\D/g, '').slice(0, 8);
    if (d.length !== 8) continue;
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    flows.set(date, (flows.get(date) ?? 0) + amt * (isNaN(fx) ? 1 : fx));
  }
  return flows;
}

// Time-weighted index: daily return r = (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1}, chained.
// idx starts at 1 on the first day; the widget takes idx_now / idx_then - 1 for any horizon.
function buildIndex(history: { date: string; nav: number }[], flows: Map<string, number>) {
  const out: { date: string; nav: number; idx: number }[] = [];
  const flowDays = [...flows.keys()].sort();
  let fi = 0, idx = 1, prev: number | null = null;
  for (const h of history) {
    let f = 0;
    while (fi < flowDays.length && flowDays[fi] <= h.date) { f += flows.get(flowDays[fi]) ?? 0; fi++; }
    if (prev !== null && prev > 0) idx *= 1 + (h.nav - prev - f) / prev;
    out.push({ date: h.date, nav: h.nav, idx });
    prev = h.nav;
  }
  return out;
}

function ibkrError(xml: string, httpStatus: number, step: string): Record<string, unknown> {
  return {
    step,
    http_status: httpStatus,
    ibkr_error_code: xml.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1] ?? null,
    ibkr_error_msg:  xml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)?.[1] ?? null,
    ibkr_status:     xml.match(/<Status>([^<]+)<\/Status>/)?.[1] ?? null,
    xml_snippet:     xml.slice(0, 600).replace(/[\r\n]+/g, ' '),
  };
}

// Latest live Net Liquidation Value pushed by the IB Gateway script (table ibkr_live),
// or null when there is none or it is older than LIVE_MAX_AGE_MIN.
const LIVE_MAX_AGE_MIN = 30;
async function latestLive(): Promise<{ value: number; at: string } | null> {
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data } = await sb.from('ibkr_live').select('net_liq, at').order('at', { ascending: false }).limit(1);
    const row = data?.[0];
    if (!row) return null;
    if (Date.now() - Date.parse(row.at) > LIVE_MAX_AGE_MIN * 60e3) return null;
    return { value: Number(row.net_liq), at: row.at };
  } catch (_) { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // ?live=1: only the live value from the table, no IBKR call. Cheap; the widget polls this.
  if (new URL(req.url).searchParams.has('live')) {
    return new Response(JSON.stringify({ live: await latestLive() }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  const raw = Deno.env.get('IBKR_FLEX_TOKEN');
  if (!raw) {
    return new Response(
      JSON.stringify({
        error: 'IBKR_FLEX_TOKEN is not set',
        detail: {
          step: 'config',
          note: 'Set it in the gastos project: Supabase dashboard -> Project Settings -> '
              + 'Edge Functions -> Secrets. The value is the Flex Web Service token from '
              + 'IBKR Client Portal -> Settings -> Account Reporting -> Flex Web Service.',
        },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
  const token = raw.trim();

  // ?p=<days> (1..365) asks IBKR for that lookback instead of the query's saved period
  // (documented Flex Web Service v3 override) and adds a daily `history` array to the
  // response. Without it the behaviour is exactly the old one: {liquid} only.
  const pRaw = parseInt(new URL(req.url).searchParams.get('p') ?? '', 10);
  const period = Number.isFinite(pRaw) && pRaw > 0 ? Math.min(pRaw, 365) : 0;
  const polls = period ? 10 : 6;   // a year of rows takes IBKR longer to generate

  // Current IBKR host for every call. The legacy gdcdyn Universal/servlet host answered
  // error 1001 to most requests in Sep 2026 while this one kept working.
  const sendUrl = `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=${token}&q=${QUERY_ID}&v=3`
    + (period ? `&p=${period}` : '');

  try {
    const r1 = await fetch(sendUrl, { headers: { 'User-Agent': 'futuro-get-ibkr-liquid/1' } });
    const xml1 = await r1.text();

    const refCode = xml1.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/)?.[1];
    const url     = xml1.match(/<Url>(https?:\/\/[^<]+)<\/Url>/)?.[1];

    if (!refCode || !url) {
      const detail = ibkrError(xml1, r1.status, 'SendRequest');
      console.error('ibkr SendRequest failed', JSON.stringify({ period, ...detail }));
      return new Response(
        JSON.stringify({ error: detail.ibkr_error_msg ?? 'SendRequest failed', detail }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    let xml2 = '';
    let lastStatus = 0;
    for (let i = 0; i < polls; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const r2 = await fetch(`${url}?t=${token}&q=${refCode}&v=3`);
      lastStatus = r2.status;
      xml2 = await r2.text();
      if (!xml2.includes('<Status>Processing</Status>')) break;
    }

    if (xml2.includes('<Status>Processing</Status>')) {
      const detail = ibkrError(xml2, lastStatus, 'GetStatement-timeout');
      console.error('ibkr GetStatement timeout', JSON.stringify({ period, polls }));
      return new Response(
        JSON.stringify({ error: `Flex report still processing after ${polls * 2}s — try again shortly`, detail }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    if (xml2.includes('<ErrorCode>') || xml2.includes('<ErrorMessage>')) {
      const detail = ibkrError(xml2, lastStatus, 'GetStatement');
      console.error('ibkr GetStatement failed', JSON.stringify({ period, ...detail }));
      return new Response(
        JSON.stringify({ error: detail.ibkr_error_msg ?? 'GetStatement error', detail }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    xml2 = dropTodayRows(xml2);
    const liquid = extractLiquid(xml2);
    if (liquid === null) {
      const detail = ibkrError(xml2, lastStatus, 'parse');
      detail.xml_snippet = xml2.slice(0, 1200).replace(/[\r\n]+/g, ' ');
      return new Response(
        JSON.stringify({ error: 'Could not parse net liquidation from XML', detail }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    // Diagnostic: the latest daily row with all its components, to reconcile against the app.
    const lastRow = [...xml2.matchAll(/<EquitySummaryByReportDate[A-Za-z]*\b[^>]*>/g)].pop()?.[0] ?? '';
    console.log('ibkr last row', lastRow.slice(0, 1500));

    const body: Record<string, unknown> = { liquid, live: await latestLive() };
    if (period) {
      const flows = extractFlows(xml2);
      const hist = buildIndex(extractHistory(xml2), flows);
      body.history = hist;
      // Sanity log: TWR over the last month and year-to-date, to compare with the IBKR app.
      const last = hist[hist.length - 1];
      const at = (date: string) => { let r = null as null | typeof last; for (const h of hist) if (h.date <= date) r = h; return r; };
      const ago = (days: number) => { const d = new Date(Date.now() - days * 86400e3); return d.toISOString().slice(0, 10); };
      const ytd = at(`${new Date().getFullYear() - 1}-12-31`);
      const m1 = at(ago(30));
      const pct = (ref: typeof last | null) => (ref && last) ? ((last.idx / ref.idx - 1) * 100).toFixed(2) + '%' : 'n/a';
      let flowSum = 0; for (const v of flows.values()) flowSum += v;
      // Net external outflow over the report window, so the widget can show an annualized
      // withdrawal rate against the current balance.
      const first = hist[0];
      const windowDays = (first && last) ? Math.max(1, Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86400e3)) : 365;
      body.withdrawals = { net: -flowSum, days: windowDays };
      const recent = [...flows.entries()].filter(([d]) => d >= ago(45)).map(([d, v]) => `${d}:${v.toFixed(0)}`).join(' ');
      const navAround = hist.filter(h => h.date >= ago(45)).map(h => `${h.date.slice(5)}=${(h.nav / 1000).toFixed(1)}k`).join(' ');
      console.log('ibkr history rows', hist.length, 'flows', flows.size, 'flowSum', flowSum.toFixed(0),
        'twr 1m', pct(m1), 'ytd', pct(ytd), 'nav', last?.nav, 'xml bytes', xml2.length,
        '| recent flows', recent, '| nav 45d', navAround);
    }

    return new Response(
      JSON.stringify(body),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    );

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg, detail: { step: 'fetch', note: 'network-level error' } }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
});
