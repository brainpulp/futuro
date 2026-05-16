import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QUERY_ID = '1510170';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  const raw = Deno.env.get('IBKR_FLEX_TOKEN');
  if (!raw) {
    return new Response(
      JSON.stringify({ error: 'IBKR_FLEX_TOKEN not set in Supabase secrets' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
  const token = raw.trim();

  try {
    const r1 = await fetch(
      `https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest?t=${token}&q=${QUERY_ID}&v=3`
    );
    const xml1 = await r1.text();

    const refCode = xml1.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/)?.[1];
    const url     = xml1.match(/<Url>(https?:\/\/[^<]+)<\/Url>/)?.[1];

    if (!refCode || !url) {
      const detail = ibkrError(xml1, r1.status, 'SendRequest');
      return new Response(
        JSON.stringify({ error: detail.ibkr_error_msg ?? 'SendRequest failed', detail }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    let xml2 = '';
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const r2 = await fetch(`${url}?t=${token}&q=${refCode}&v=3`);
      lastStatus = r2.status;
      xml2 = await r2.text();
      if (!xml2.includes('<Status>Processing</Status>')) break;
    }

    if (xml2.includes('<Status>Processing</Status>')) {
      const detail = ibkrError(xml2, lastStatus, 'GetStatement-timeout');
      return new Response(
        JSON.stringify({ error: 'Flex report still processing after 12s — try again shortly', detail }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    if (xml2.includes('<ErrorCode>') || xml2.includes('<ErrorMessage>')) {
      const detail = ibkrError(xml2, lastStatus, 'GetStatement');
      return new Response(
        JSON.stringify({ error: detail.ibkr_error_msg ?? 'GetStatement error', detail }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    const liquid = extractLiquid(xml2);
    if (liquid === null) {
      const detail = ibkrError(xml2, lastStatus, 'parse');
      detail.xml_snippet = xml2.slice(0, 1200).replace(/[\r\n]+/g, ' ');
      return new Response(
        JSON.stringify({ error: 'Could not parse net liquidation from XML', detail }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    return new Response(
      JSON.stringify({ liquid }),
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
