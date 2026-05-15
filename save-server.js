// Local save server — runs on port 3001 during development.
// Accepts POST /save with { scenarios, activeId } JSON body → writes scenarios.json.
// Accepts GET  /ibkr/liquid → proxies IBKR Client Portal API for Net Liquidation Value.
// This file is NOT deployed.
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT     = 3001;
const OUT_FILE = path.join(__dirname, 'scenarios.json');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── IBKR Client Portal API proxy ──────────────────────────────
// Requires IB Gateway running on localhost:5000 and authenticated.
const IBKR_BASE  = 'https://localhost:5000';
const IBKR_AGENT = new https.Agent({ rejectUnauthorized: false });

function ibkrGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(IBKR_BASE + urlPath, { agent: IBKR_AGENT }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(new Error('IBKR response not JSON: ' + body.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('IBKR timeout')); });
  });
}

http.createServer((req, res) => {
  // Pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // GET /ibkr/liquid — fetch Net Liquidation Value from IB Gateway
  if (req.method === 'GET' && req.url === '/ibkr/liquid') {
    (async () => {
      try {
        const { data: accounts } = await ibkrGet('/v1/api/portfolio/accounts');
        if (!Array.isArray(accounts) || accounts.length === 0)
          throw new Error('No accounts returned — is IB Gateway authenticated?');
        const accountId = accounts[0].id;
        const { data: summary } = await ibkrGet(`/v1/api/portfolio/${accountId}/summary`);
        const nl = summary.netliquidation;
        if (!nl || nl.isNull) throw new Error('netliquidation not available in account summary');
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ liquid: nl.amount, currency: nl.currency, account: accountId }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        JSON.parse(body); // validate
        fs.writeFileSync(OUT_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end();
}).listen(PORT, '127.0.0.1', () => {
  console.log('Save server listening on http://127.0.0.1:' + PORT);
});
