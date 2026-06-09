# Futuro — Claude Instructions

## Session start protocol (ALWAYS do this first)
1. Run `_selfTest()` via Chrome MCP on the open Futuro tab (localhost:8765 or GitHub Pages)
2. One call: `mcp__Claude_in_Chrome__javascript_tool` with `text: "_selfTest().summary"`
3. If 20/20 passed → continue. If any fail → fix before touching anything else.

## What it is
Single-file HTML/JS retirement net-worth projector. No build step.
- Repo: https://github.com/brainpulp/futuro
- Deployed: https://brainpulp.github.io/futuro/
- Local dev: `python3 -m http.server 8765 --directory ~/futuro` (or node save-server.js)
- Edit only: `~/futuro/index.html` (~6700 lines)

## Pre-commit UI review (ALWAYS before committing any UI change)
Before declaring a UI change done, scan for obvious gaps:
1. **Branch parity** — if one conditional branch (e.g. `type=oneoff`) gets fields A+B, check every other branch has what it needs. Don't ship a branch with missing fields.
2. **Cross-function parity** — if a parallel function already handles the same case fully (e.g. `_dealCapBlock` for installments), use it as a checklist. Go field by field.
3. **User completeness test** — read the rendered section and ask: "does a user have everything they need to fill this in?" If any input is ambiguous or missing context, add it.
4. **Render path check** — confirm which function actually renders the visible UI (e.g. `_renderDealSubItem` not `_dealCapBlock` for deal expand cards). Editing the wrong function = silent no-op.

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
_selfTest()          // 20-assertion in-browser test suite
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
Deals like Canchitas store cashflows in tagged `S.expenses`/`S.incomes` (`item.dealId = deal.id`) with `capital.type='none'` and `returns.type='none'`. These render via `_renderDealSubItem`, not `_dealCapBlock`/`_dealRetBlock`.

## _renderDealSubItem field completeness
Each type must have ALL fields a user needs:
- `oneoff`: Amount, Type, **Date**
- `monthly/annual`: Amount, Type, **From → To**
- `installments`: Amount, Type, **# payments**, **frequency**, **Starts date**

## Exit types
- `none` — no exit event
- `auto` — appreciates at rate%, sells at date, proceeds = cv × (1 - costs%)
- `auto` + date > simEnd — "Hold" mode, stays illiquid
- `manual` — fixed sale price at date, independent of appreciation
- `appreciation` — exit = outflow × (1+rate)^years, base = Out amount or custom

## In progress / pending (updated 2026-06-09)

### Canchitas data fix needed
- `exit.type` was accidentally set to `'hold'` during a debugging session — should be `'none'` (Canchitas has no planned exit)
- Fix: `upD('deal_canchitas', 'exit', {type:'none'}); saveActive()`

### Conceptual deal model — partially implemented
Agreed design (discussed 2026-06-09):
- **OUT** = any outflow (replaces "Capital In" label — done ✓)
- **RETURNS** = periodic cashflows back in
- **EXIT** = terminal cash event; its amount IS the illiquid asset value on the chart
- Illiquid asset value = exit amount expected, or 0 if no exit (done ✓ in `_dealAssets` init)
- "Expense" vs "Capital" distinction is irrelevant — it's all just outflow (label renamed ✓)

### Tagged sub-items — not yet unified
Canchitas uses tagged `S.expenses`/`S.incomes` (dealId pattern) instead of the deal's own Out/Returns blocks. This predates the new model. Agreed direction: eventually migrate these into the deal's own blocks so every deal is self-contained. Not done yet — tagged pattern still works and renders correctly via `_renderDealSubItem`.

### Open design questions
- Should the "Out" block support a name/description field (for deals with multiple outflows)?
- Should tagged sub-items be migrated away entirely, or kept as a power-user pattern?
- `_dealCapBlock` (used in old `renderDeals()` stub) has more features than `_renderDealSubItem` — e.g. Gastos spend tracking bar. Should that be ported to `_renderDealSubItem`?

## Persistence
- localStorage key: `futuro_scenarios`
- Supabase: project `kbatdnrxfrltcmqvsmyy`, table `futuro_state`
- `saveActive()` → deepCopy(S) into SCENARIOS → lsSave() → sbSave()
