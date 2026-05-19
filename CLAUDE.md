# Retiro — Handoff

## What it is
Single-file HTML/JS retirement net-worth projector. No build step.
Deployed to GitHub Pages: https://brainpulp.github.io/retiro/
Repo: https://github.com/brainpulp/retiro

## Tech
- `index.html` — entire app (~4100 lines). Edit this file directly.
- `save-server.js` — local Node server (port 3001) for saving scenarios.json and proxying IBKR. NOT deployed. Run with `node save-server.js`.
- `supabase/functions/get-ibkr-liquid/index.ts` — deployed edge function for IBKR Flex API pull.
- Chart.js (bundled locally), Supabase JS client (CDN).

## Supabase projects
| Project | ID | Purpose |
|---------|-----|---------|
| retiro  | `kbatdnrxfrltcmqvsmyy` | scenarios persistence, IBKR edge function |
| gastos  | `fnzdkqrkranedtgysqcf` | expense actuals (monthly-actuals, auto-categorize) |

Supabase access token (for CLI deploys): stored in session, ask user if needed.
Deploy edge function: `SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy get-ibkr-liquid --project-ref kbatdnrxfrltcmqvsmyy --no-verify-jwt`

## Key constants in index.html
```js
const SB_URL   = 'https://kbatdnrxfrltcmqvsmyy.supabase.co';
const SB_ANON  = 'eyJ...'; // anon key
const GASTOS_URL  = 'https://fnzdkqrkranedtgysqcf.supabase.co';
const GASTOS_ANON = 'eyJ...'; // gastos anon key
const IBKR_SYNC_MS = 4 * 60 * 60 * 1000; // 4 hours
const _currentYM = new Date().toISOString().slice(0, 7); // e.g. "2026-05"
```

## Globals
```js
let _yearMode = false;       // age vs calendar year display
let _gastosActuals = {};     // { "2026-01": 4320.50, ... } from gastos edge fn
let _theme = ...;            // persisted via localStorage 'retiro-theme'
```

## Features implemented (recent)
- **Age/Year toggle** — `◑` button switches all age displays to calendar years. `dispA(age)` / `readA(val)` helpers. `body.year-mode` class widens ifield inputs to 54px.
- **Gastos actuals integration** — past months use real USD spend from gastos instead of projected base expenses. `gastosSync()` calls `monthly-actuals` edge function on load.
- **Graphite dark theme** — `body[data-theme="graphite"]` CSS block. Toggle button `◑` in app bar. Persists via `localStorage('retiro-theme')`.
- **IBKR auto-sync toggle** — checkbox "auto" next to ↓ IBKR button. Persists via `localStorage('retiro-ibkr-auto')`. Default OFF (avoids Flex API rate limit during dev).
- **IBKR verbose errors** — edge function returns `ibkr_error_code`, `ibkr_status`, `xml_snippet` on failure. Error 1001 = rate limited, wait ~15 min.
- **Money bag favicon** — SVG data URL emoji.
- **Chart age labels** — theme-aware color (lighter in graphite mode).

## IBKR status
- Uses Flex API (query ID `1510170`). Token in Supabase secret `IBKR_FLEX_TOKEN`.
- Error 1001 = rate limited. Transient — retry in 15 min.
- Token appears to be valid (not expired).
- Auto-sync disabled by default. Enable checkbox when not actively developing.

## Gastos auto-categorize
- Edge function runs hourly via pg_cron on gastos Supabase project.
- Requires `ANTHROPIC_API_KEY` secret set in gastos project functions settings.
- Two passes: vendor hints (free) then Claude Haiku (60 tx/batch).
- ~1980 uncategorized transactions as of 2026-05-16, clearing gradually.

## Simulation logic (key snippet)
```js
// In monthly simulation loop:
const _simYM = String(startYear + (age - sa)) + '-' + String(mo).padStart(2,'0');
const _gastos = _simYM < _currentYM ? _gastosActuals[_simYM] : undefined;
let exp = _gastos !== undefined ? _gastos : inflM + (S.winterTrip + S.summerTrip) / 12;
```
Past months use gastos actuals; future months use projected inflation-adjusted expenses.

## Helper functions
- `dispA(age)` — returns year or age based on `_yearMode`
- `readA(val)` — inverse of dispA (parse input back to age)
- `ageToYear(age)` — `startYear + (age - startAge)`
- `yearToAge(year)` — `startAge + (year - startYear)`
- `gastosSync()` — fetches monthly actuals from gastos edge function
- `ibkrSync({manual})` — fetches net liquidation from retiro edge function
- `toggleTheme()` — flips graphite/light, persists to localStorage
- `toggleYearMode()` — flips age/year display, toggles body.year-mode class
- `toggleIbkrAuto(on)` — saves IBKR auto-sync preference

## Local dev
Local path: `F:\code\retiro\` (moved out of Google Drive on 2026-05-19 — Drive sync corrupts git index)

```bash
node save-server.js          # start local save server (port 3001)
npx http-server . -p 8765    # serve app locally
```
App auto-saves to Supabase (no save-server needed for basic use).
save-server only needed for: scenario file export backup, IBKR via Client Portal API (alternative to Flex).

## Git
Main branch. Push directly to main → GitHub Pages deploys automatically.
```bash
git add index.html && git commit -m "..." && git push
```
