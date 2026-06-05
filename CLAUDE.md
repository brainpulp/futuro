# Futuro — Handoff

## Code review
**ALWAYS run the `check-futuro` skill before committing.** It is at `.claude/skills/check-futuro/SKILL.md`.
Invoke it by reading that file and following every check listed. Fix all 🔴 CRITICAL findings before pushing.

## What it is
Single-file HTML/JS retirement net-worth projector. No build step.
Deployed to GitHub Pages: https://brainpulp.github.io/futuro/
Repo: https://github.com/brainpulp/futuro

## Tech
- `index.html` — entire app (~6200 lines). Edit this file directly.
- `save-server.js` — local Node server (port 3001) for saving scenarios.json and proxying IBKR. NOT deployed.
- `supabase/functions/get-ibkr-liquid/index.ts` — deployed edge function for IBKR Flex API pull.
- **TradingView LightweightCharts v4.2.0** (CDN) — main NW chart. Replaced Chart.js for main chart.
- Chart.js (bundled locally at `index_files/chart.umd.js`) — still used for sub-charts only (expense breakdown, MC distribution).
- Supabase JS client (CDN).

## Supabase projects
| Project | ID | Purpose |
|---------|-----|---------|
| futuro  | `kbatdnrxfrltcmqvsmyy` | scenarios persistence, IBKR edge function. Table: `futuro_state` |
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

## LightweightCharts globals (main NW chart)
```js
let lwChart = null, lwLiqSeries = null, lwReSeries = null;
let lwTotalSeries = null, lwRealSeries = null;
let lwVigCanvas = null;  // overlay canvas for emoji vignette + dot hit detection
let _txnDots = [];       // [{xp,yp,hitR,age,mo,year,txns,net,isYearly}]
function _mt(year, mo) { return `${year}-${String(mo).padStart(2,'0')}-01`; }
```

Key functions:
- `_initLwChart()` — creates chart, 4 series (RE orange, Liquid blue, Total green dashed, Real grey dashed), overlay canvas, mouse event listeners
- `_updateLwChart(data)` — sets series data from `data.monthly`, calls `_buildLwMarkers(data)`, calls `_setLwZoom`
- `_buildLwMarkers(data)` — builds LW markers + `_txnDots`. In 1y/5y: monthly dots. In 10y+: yearly aggregate dots with `_groupTxnsForYearly()` to collapse repeated rents/installments
- `_groupTxnsForYearly(txns)` — groups all txns by name+type, sums amounts, tracks `_count`
- `_setLwZoom(years)` — sets `timeScale().setVisibleRange()`
- `_updateVig()` — draws emoji vignette clipped to liquid curve on overlay canvas

## Other globals
```js
let _yearMode = false;       // age vs calendar year display
let _gastosActuals = {};     // { "2026-01": 4320.50, ... } from gastos edge fn
let _chartZoom = 10;         // persisted via localStorage 'futuro-chart-zoom'
```

## Transaction markers behavior
- **1y / 5y zoom** (`_chartZoom <= 5`): one dot per month that has transactions, tooltip shows that month's txns
- **10y / 20y / 30y zoom**: one dot per age-year (placed at July), tooltip shows annual totals with grouped rows
- Installments grouped: badge shows `X/Y` in monthly view, `×N/yr` in yearly view
- Recurring rent/income grouped: badge shows `×12/yr` with annual total

## Simulation
- `runSim()` generates `data.monthly[]` — array of `{age, mo, year, liq, iliq, inc, baseExp, oneoffs}`
- `getMonthTxns(age, mo)` — returns all transactions for a specific month
- `getYearSummary(age)` — aggregates all monthly transactions for a year
- Past months use gastos actuals; future months use projected inflation-adjusted expenses
- `rentFromAge` guard: `if (ra > 2000) ra = yearToAge(ra)` — some properties saved rentFromAge as calendar year

## Features implemented
- **Age/Year toggle** — `◑` button. `dispA(age)` / `readA(val)` helpers. `body.year-mode` class.
- **Gastos actuals integration** — past months use real USD spend from gastos. `gastosSync()` on load.
- **Graphite dark theme** — `body[data-theme="graphite"]`. Toggle `◑`. Persists via localStorage.
- **IBKR auto-sync toggle** — checkbox, default OFF during dev. Persists via localStorage.
- **IBKR verbose errors** — edge fn returns `ibkr_error_code`, `ibkr_status`, `xml_snippet`.
- **Montecarlo** — 500 runs, amber/gold bands. `_mcResult` global. Not yet on LW chart (sub-chart only).
- **Emoji vignette** — animated emoji background clipped to liquid curve area, on overlay canvas.
- **Crisis drops** — applied in sim and visible in reality check table via `_crisisItems`.

## Pending / deferred
- Dancing numbers on LW chart (not yet reimplemented after Chart.js migration)
- Montecarlo bands on LW chart (not yet reimplemented)
- TradingView watermark (TV logo, bottom-left) — free tier limitation
- Edge browser: timeline/budget title bars don't expand (Chrome/Mac work fine)

## IBKR status
- Uses Flex API (query ID `1510170`). Token in Supabase secret `IBKR_FLEX_TOKEN`.
- Error 1001 = rate limited. Transient — retry in 15 min.
- Auto-sync disabled by default. Enable checkbox when not actively developing.

## Gastos auto-categorize
- Edge function runs hourly via pg_cron on gastos Supabase project.
- Requires `ANTHROPIC_API_KEY` secret set in gastos project functions settings.

## Local dev
Local path: `F:\code\futuro\` (moved out of Google Drive on 2026-05-19 — Drive sync corrupts git index)

```bash
node save-server.js          # start local save server (port 3001)
npx http-server . -p 8765    # serve app locally
```

## Git
Main branch → GitHub Pages auto-deploys.
```bash
git add index.html && git commit -m "..." && git push
```
Always update CLAUDE.md and `memory/project_retiro.md` after significant changes.
