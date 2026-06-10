# Futuro — Claude Instructions

## Session start protocol (ALWAYS do this first)
1. Run `_selfTest()` via Chrome MCP on the open Futuro tab (localhost:8765 or GitHub Pages)
2. One call: `mcp__Claude_in_Chrome__javascript_tool` with `text: "_selfTest().summary"`
3. If 22/22 passed → continue. If any fail → fix before touching anything else.

## What it is
Single-file HTML/JS retirement net-worth projector. No build step.
- Repo: https://github.com/brainpulp/futuro
- Deployed: https://brainpulp.github.io/futuro/
- Local dev: `python3 -m http.server 8765 --directory ~/futuro` (or node save-server.js)
- Edit only: `~/futuro/index.html` (~6800 lines)

## Pre-commit UI review (ALWAYS before committing any UI change)
Before declaring a UI change done, scan for obvious gaps:
1. **Branch parity** — if one conditional branch (e.g. `type=oneoff`) gets fields A+B, check every other branch has what it needs.
2. **Cross-function parity** — if a parallel function already handles the same case fully (e.g. `_dealCapBlock` for installments), use it as a checklist. Go field by field.
3. **User completeness test** — read the rendered section and ask: "does a user have everything they need to fill this in?"
4. **Render path check** — confirm which function actually renders the visible UI (`_renderDealSubItem` not `_dealCapBlock` for deal expand cards). Editing the wrong function = silent no-op.

## Commit & push protocol (ALWAYS after any code change)
1. Run `_selfTest()` → all must pass
2. `cd ~/futuro && git add index.html && git commit -m "..." && git push` — push immediately, don't wait for user to ask

## Key globals
```js
S                    // active scenario data object
SCENARIOS            // array of all scenarios
go()                 // main render: runSim() → update ribbon + LW chart
runSim()             // monthly sim engine → data.monthly[] + yearly out[]
ensureFields()       // normalizes S properties — called on load, NOT in go()
markDirty()          // debounces saveActive() at 600ms
upP(id, field, val)  // update property
upD(id, field, val)  // update deal field
upDf(id, block, field, val) // update deal sub-block field (capital/returns/exit)
upE(id, field, val)  // update expense
upI(id, field, val)  // update income
_selfTest()          // 22-assertion in-browser test suite
```

## Render architecture — CRITICAL
- `renderEvents()` — renders the unified events table (expenses, incomes, properties, deals)
- `renderDeals()` — writes to `#deals-list` which does NOT exist; it's a dead stub. Never call it expecting a visible result.
- Deal expand cards render via `_renderDealExpandCard(d)` → `_renderDealSubItem(item, kind)` for tagged sub-items
- All button/input handlers inside deal blocks must call `renderEvents()` not `renderDeals()`
- `openId` — string tracking which row's expand card is open

## Deal expand card structure
```
_renderDealExpandCard(d):
  deal-body: [Out block if cap≠none] [Returns block if ret≠none] [Color]
  subSections: tagged expense sub-items + tagged income sub-items
  deal-body: [Exit/Sale block]   ← always at the bottom
```

## Tagged sub-items pattern (CRITICAL)
Some deals store cashflows in tagged `S.expenses`/`S.incomes` (`item.dealId = deal.id`) with `capital.type='none'` and `returns.type='none'`. These render via `_renderDealSubItem`, not `_dealCapBlock`/`_dealRetBlock`.

## _renderDealSubItem field completeness
Each type must have ALL fields a user needs:
- `oneoff`: Amount, Type, **Date**
- `monthly/annual`: Amount, Type, **From → To**
- `installments`: Amount, Type, **# payments**, **frequency**, **Starts date**

## Exit types
- `none` — no exit event; asset has no illiquid value
- `auto` — appreciates at rate%, sells at date, proceeds = cv × (1 - costs%)
- `auto` + date > simEnd — "Hold" mode, stays illiquid
- `manual` — fixed sale price at date; **cv interpolates linearly from basis → manualPrice over the hold** (no cliff)
- `appreciation` — exit = outflow × (1+rate)^years, base = Out amount or custom

## _dealAssets — illiquid asset tracking
```js
_dealAssets[d.id] = {
  cv,        // current carrying value (updated each month)
  rate,      // annual appreciation % (used for auto/appreciation exits)
  sold,      // true once exit fires
  basis,     // original cost basis
  capDate,   // 'YYYY-MM' string — when capital was committed
  exitDate,  // 'YYYY-MM' string — for manual exits only (else null)
  exitPrice, // Number — for manual exits only (else null)
}
```
- Init: `basis = ex.baseType==='custom' ? ex.basis : (cap.amount || cap.totalAmount || ex.basis || 0)`
  - Already-owned assets (capYear ≤ startYr): cv = basis from sim start
  - Future investments (capYear > startYr): cv = 0 until activation month
- Activation (future oneoff cap): `da.cv = cap.amount || cap.totalAmount || 0` — does NOT use ex.basis (prevents phantom iliq for zero-cost deals like Luisma)
- Monthly: manual exits → linear interp; auto exits → compound at da.rate/12
- Exit (pre-yield): snaps `da.cv = manualPrice` before computing net, marks `da.sold = true`

## Known bugs fixed (2026-06-10)
| Bug | Root cause | Fix |
|-----|-----------|-----|
| manualPrice exit destroys NW | liq got manualPrice but iliq lost full grown cv | Snap `da.cv = manualPrice` before exit in both pre-yield loop and `_dealCashflow` |
| Phantom iliq for zero-cost future deals | Activation used `cap.amount \|\| ex.basis`, inflating iliq with no cash outflow | Activation now uses only `cap.amount \|\| cap.totalAmount` |
| Cliff in NW chart at manual exit | cv held flat at basis then dropped at exit | cv now linearly interpolates from basis → exitPrice over hold period |

## Net-worth conservation invariant
For any month: `Δ(liq + iliq)` should equal `income - expenses + mktGain`.
At a manual exit: liq += net, iliq -= cv (which was snapped to manualPrice) → Δ = 0. ✓
T12a/T12b regression tests enforce this.

## Self-test suite — 22 assertions
T1–T10: existing (yield, rent, property sale, market, inflation, ensureFields)
T11/T11b: annual tooltip shows full annual amount
T12a: manualPrice exit conserves net worth (Δ(liq+iliq) ≈ 0 at exit month)
T12b: iliq depreciates smoothly before exit (no cliff — checks mid-hold value)

## Open / pending
- **Luisma deal**: cap.amount=0, exit.basis=230k, capDate=2036. With the activation fix, da.cv=0 during hold; $230k exits as a windfall via `_dealNetProceeds`. If Luisma represents a pre-existing asset (already paid), cap.type should be 'none' and capDate should be before 2026 so cv initializes at sim start. Needs data review.
- **Tagged sub-items migration**: eventually move tagged S.expenses/S.incomes into deal's own Out/Returns blocks so every deal is self-contained. Not urgent — tagged pattern still works.
- **Gastos spend tracking in Out block**: `_dealCapBlock` has a progress bar vs Gastos actuals. Not yet ported to `_renderDealSubItem`.

## Persistence
- localStorage key: `futuro_scenarios`
- Supabase: project `kbatdnrxfrltcmqvsmyy`, table `futuro_state`
- `saveActive()` → deepCopy(S) into SCENARIOS → lsSave() → sbSave()
