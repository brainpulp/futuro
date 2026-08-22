import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The 10-year TIPS yield: what the market will actually pay, today, for a decade of
// inflation-protected money. It is the one forward-looking number in this whole system
// that is a PRICE rather than a forecast -- nobody's opinion, no model, no licence, and
// a keyless government feed.
//
// Deliberately NOT here: VIX, AAII, put/call, and the rest of the sentiment family. They
// carry no signal past a few weeks, and this plan runs forty years. A weekly-refreshing
// expected return would move the headline for reasons that say nothing about age 95.
const FEED = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml'
           + '?data=daily_treasury_real_yield_curve&field_tdr_date_value=';

type Point = { date: string; tenYear: number };

// The feed is an Atom document, one <entry> per business day, oldest first. Parsed by
// regex rather than an XML library: the shape is two fixed tags and the alternative is a
// dependency that can break the deploy.
function parseFeed(xml: string): Point[] {
  const out: Point[] = [];
  for (const m of xml.matchAll(/<content[\s\S]*?<\/content>/g)) {
    const block = m[0];
    const date = block.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/)?.[1];
    const ten  = block.match(/<d:TC_10YEAR[^>]*>([^<]*)<\/d:TC_10YEAR>/)?.[1];
    if (!date || !ten || ten.trim() === '') continue;
    const v = parseFloat(ten);
    if (!isFinite(v)) continue;
    out.push({ date: date.slice(0, 10), tenYear: v });
  }
  return out;
}

async function yearOf(year: number): Promise<{ points: Point[]; status: number }> {
  const r = await fetch(FEED + year, { headers: { 'Accept': 'application/xml' } });
  const xml = await r.text();
  return { points: parseFeed(xml), status: r.status };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const now = new Date();
  const thisYear = now.getUTCFullYear();

  try {
    // In early January the current year's file can still be empty, so fall back a year
    // rather than reporting "no data" for a feed that is working perfectly.
    let { points, status } = await yearOf(thisYear);
    let usedYear = thisYear;
    if (points.length === 0) {
      const prev = await yearOf(thisYear - 1);
      points = prev.points; status = prev.status; usedYear = thisYear - 1;
    }

    if (points.length === 0) {
      return new Response(JSON.stringify({
        error: 'No 10-year real yield found in the Treasury feed',
        detail: { step: 'parse', http_status: status, tried: [thisYear, thisYear - 1],
                  note: 'The feed shape may have changed — check d:TC_10YEAR in ' + FEED + thisYear },
      }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    const last = points[points.length - 1];

    // A month of context, so the client can say whether today is unusual rather than
    // just quoting a number. Cheap: it is already in the response we parsed.
    const recent = points.slice(-22);
    const avg = recent.reduce((s, p) => s + p.tenYear, 0) / recent.length;

    return new Response(JSON.stringify({
      realYield10: last.tenYear,
      asOf: last.date,
      avg1mo: Math.round(avg * 1000) / 1000,
      nPoints: points.length,
      year: usedYear,
      source: 'US Treasury — Daily Treasury Real Yield Curve Rates (10 yr TIPS)',
    }), { headers: { 'Content-Type': 'application/json', ...CORS } });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg, detail: { step: 'fetch', note: 'network-level error' } }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
});
