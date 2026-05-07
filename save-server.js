// Local save server — runs on port 3001 during development.
// Accepts POST /save with { scenarios, activeId } JSON body → writes scenarios.json.
// This file is NOT deployed to Netlify.
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = 3001;
const OUT_FILE = path.join(__dirname, 'scenarios.json');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

http.createServer((req, res) => {
  // Pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
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
