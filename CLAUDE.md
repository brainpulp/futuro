# Futuro — Claude Instructions

## Session start protocol (ALWAYS do this first)
1. Run `_selfTest()` via Chrome MCP on the open Futuro tab (localhost:8765 or GitHub Pages)
2. One call: `mcp__Claude_in_Chrome__javascript_tool` with `text: "_selfTest().summary"`
3. If 52/52 passed → continue. If any fail → fix before touching anything else.

**No browser available?** (remote/CI sessions) Run the suite headlessly with jsdom:
```bash
npm install --no-save jsdom          # once per container
NODE_PATH=$PWD/node_modules node selftest.js index.html
```
The runner loads index.html in jsdom, strips CDN `<script src>` tags, stubs
`getContext()` (jsdom has no canvas backend — without the stub the page script aborts
partway and later `const`s stay in TDZ), then calls `window._selfTest()`.
Note `S`, `EMPTY` and `_DEAL_COLORS` are `let`/`const`, so they are NOT on `window` —
reach them with `window.eval(...)`, not `window.S`.

## What it is
Single-file HTML/JS retirement net-worth projector. No build step.
- Repo: https://github.com/brainpulp/futuro
- Deployed: https://brainpulp.github.io/futuro/
- Local dev: `python3 -m http.server 8765 --directory ~/futuro` (or node save-server.js)
- Edit only: `~/futuro/index.html` (~8000 lines) — plus `mobile.html` (phone view)

## mobile.html — phone view
A separate lightweight page that **reuses index.html as its engine** rather than
duplicating the simulation. It loads `index.html?engineonly=1` in a hidden iframe and
drives it with `contentWindow.eval(...)`.
- `engineonly=1` makes index.html skip `loadScenarios()`, all network sync and UI init,
  and set `window._engineReady`. Nothing then races with or overwrites the injected `S`.
- Never duplicate sim logic into mobile.html — inject `S` and call `runSim()` in the frame.
- Scenario sources, in order: `#s=` URL hash (gzip+base64url, stays client-side) →
  `localStorage.futuro_scenarios` → `EMPTY`.
- The phone has no localStorage copy and Supabase sync may be paused, so the
  **hash link is the real transfer path**. "Copy link for another device" builds it.
- No CDN and no chart library: the area chart is hand-rolled inline SVG.
- Controls: spend, return, volatility, early crash, inflation, horizon, median toggle,
  cost toggle, per-asset sale price + year steppers, per-income switches, add/remove
  businesses, per-expense amount/date/enable/delete + add, and scenario-level fields
  (liquidBase, startAge, assetAppreciation, sellCostRate, propertyTaxRate, borrowRate).
  All edits are working-scenario only — Reset restores them.
- Detail sections are `<details class="card">`, collapsed by default, each with a `.cnt`
  summary so the closed state still says what is inside. Browser tests must open them
  (`d.open = true`) before interacting, and again after clicking Reset.
- ⚠ A one-off dated earlier in the START year never fires: the sim opens at the *current*
  month. `renderExpenses` flags those `_past` ("already spent") — without it, editing the
  amount silently does nothing and looks broken. Four of the sample scenario's five
  project costs are in this state.
- A condensed result bar (`#stick`) mirrors the verdict + net worth + MC while scrolling.
  It is `position:fixed` (not sticky) so it never occupies layout space, revealed by an
  IntersectionObserver on `#head`, and `aria-hidden` since it duplicates that card.
- ⚠ Text-input handlers must NOT call `renderLists()`: replacing the node that is mid-blur
  throws "node to be removed is no longer a child". Update the field in place, then
  `render(true)`. Only button clicks may re-render the list.
- Sale-year steppers must handle BOTH shapes: plain `S.properties` (`saleAge`/`hold`) and
  migrated deals (`exit.date` as `YYYY-MM`, year 2100 = hold). `assetsOf`/`applyEdits`.
- ⚠ Never commit real scenario data into mobile.html — the repo is public and deployed.

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

## Cost & return model (added 2026-08-08)
Scenario-level fields, all with per-asset overrides:
```js
S.sellCostRate      // % lost on every sale. Override: exit.sellingCosts / property.sellCosts
S.propertyTaxRate   // annual % of carrying value, charged monthly. Override: deal.taxRate / property.taxRate
S.mcVol             // assumed annual σ of market returns (was hardcoded 15 inside _mcParams)
S.useMedianReturn   // default TRUE — applies σ²/2 volatility drag to the deterministic line
S.borrowRate        // annual % at which a NEGATIVE liquid balance grows (default 10)
S.crashYears        // sequence-of-returns stress: N years from startAge pinned to…
S.crashPct          // …this annual return. crashYears:0 disables. Set together.
property.salePrice  // agreed sale price for a plain property (deals: exit.manualPrice)
```

**`salePrice` mirrors a deal's `manualPrice`, interpolation included.** When set, carrying
value walks linearly from `_basis` to the price over the hold instead of compounding at
`appRate` — otherwise the chart shows a cliff at the sale and `Δ(liq+iliq)` breaks. Uses
the same `-1` month offset so the sale month is a clean iliq→liq swap. `props` carries
`_basis` from init and from the acquisition-year activation. T21 guards it.

**Crash years outrank everything, including the Monte Carlo.** `getYield` checks
`_crashRate(age)` *before* the yield curve, so `runMonteCarlo` — which overwrites
`S.yieldCurve` wholesale on every run — cannot sample the crash away. That is the point:
the MC then measures "bad start, then randomness", which is the actual retirement risk.
`_mcParams` counts pinned years in its mean too. Drag never applies to them (specified
path, not an expectation). T20 guards all of this.

⚠ `Object.assign` only copies keys that are *present*. Clearing a flag between two test
arms needs it set explicitly (`{...FIX, crashYears: 0}`) — omitting it leaks the previous
arm's value and silently makes both arms identical.
Helpers: `_sellCostPct(ex)` / `_netOfSellCosts(gross, ex)` / `_taxPct(obj)` /
`_monthlyPropTax(cv, obj)` / `_propTaxThisMonth(props, dealAssets)` / `_liqMonthlyRate(liq, yld)` / `volDrag()`.

**Override resolution:** unset/`''` → falls through to the global; an explicit `0` is honoured.
So never write `sellingCosts: 0` when you mean "unset" — that masks the global default.
The property→deal migration used to do exactly this; `ensureFields` now strips those
auto-generated zeros once, behind the `S._migSellCosts` flag.

**Volatility drag applies ONLY to the flat `S.yieldRate`.** A per-age `S.yieldCurve`
value is a *realized* path — its own ups and downs already drag compounding below the
arithmetic mean, so applying σ²/2 on top double-penalizes. `getYield` returns curve
values untouched. T17d guards this.

**`_mcParams` blends, never falls back wholesale.** The MC mean is the average of the
rate the sim would actually use at each age (curve value where present, `S.yieldRate`
where absent). The old version only trusted the curve at *full* coverage, so pushing
`endAge` one year past the end of a 30-year curve silently reverted the whole MC to a
stale `yieldRate` — which is how a scenario with `yieldRate: 20` behind a curve reported
100% success while the deterministic line went bankrupt. T19 guards this.

**Volatility drag must not stack with the Monte Carlo.** MC draws around the *arithmetic*
mean, and its spread already produces the median path. `runMonteCarlo` sets `_mcActive`
so `volDrag()` returns 0 for the duration of the run. Restore it in a `finally`.

**Inflation convention:** everything entered is in TODAY's money.
- Inflated: base spend, trips, recurring (`monthly`/`annual`) expenses AND incomes.
- Nominal: `oneoff` items, `installments`, and deal capital/returns — these are
  contractual amounts fixed at a specific date.
Expenses and incomes MUST be treated symmetrically; T16b enforces it.

## Known bugs fixed (2026-08-08)
| Bug | Root cause | Fix |
|-----|-----------|-----|
| In-progress installments stopped firing | `_installFires` compared `paidSoFar + slot < installN`, but `slot` was already absolute from plan start — so elapsed time counted twice. A >50%-elapsed plan contributed **zero** future outflows | Track `slotAtStart`; re-base to the sim's first month via `_installNum()` |
| Property sales credited 100% of value | Sale did `liq += p.cv` with no transaction costs; `deal_prop_*` exits were stamped `sellingCosts: 0` | `S.sellCostRate` global + per-asset override; migration no longer writes the literal 0 |
| Itemised expenses never inflated | `exp += e.amount` (face value) while incomes used `i.monthly * f` — trips stayed nominal for 30 years too | Recurring expenses and trips now multiply by `f` |
| Headline line overstated the typical outcome | Deterministic sim compounded the arithmetic mean; ~half of real outcomes fall below it | `useMedianReturn` subtracts σ²/2 |
| Shortfalls compounded at the portfolio yield | `liq *= (1 + mYld)` applied the investment return to a negative balance | `_liqMonthlyRate()` switches to `S.borrowRate` when `liq < 0` |
| Gastos actuals double-counted | Past months used the Gastos actual as the base, then added itemised expenses on top | Items with a `gastosCategory` are skipped when an actual exists for that month |
| Expense curve froze at its baking rate | `applyExpenseCeiling` baked with the then-current inflation and was never redone | `S.expenseAnchor` + `rebakeExpenseCurve()` on the inflation slider |
| Sold properties never left the monthly net-worth line | The yearly rows did `props.filter(p => !p.sold)` but BOTH `out.monthly` pushes summed every property, while correctly filtering sold *deals*. A sold property's cv froze and was counted forever, so the monthly chart overstated net worth after every sale | Filter `!p.sold` in both monthly pushes (T21f) |
| T3 silently broke in August | Asserted on a July row; the start-year loop begins at the current month | Assert on December |

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

## Self-test suite — 52 assertions
T1–T10: existing (yield, rent, property sale, market, inflation, ensureFields)
T11/T11b: annual tooltip shows full annual amount
T12a: manualPrice exit conserves net worth (Δ(liq+iliq) ≈ 0 at exit month)
T12b: iliq depreciates smoothly before exit (no cliff — checks mid-hold value)
T13a–d: in-progress installment plans fire all REMAINING payments, numbered correctly
T14a–c: selling costs — none / global default / per-asset override
T15a–c: property tax charged while held, stops at sale, silent at 0%
T16a–b: recurring expenses inflate, and identically to recurring incomes
T17a–d: volatility drag puts the median below the mean by ≈σ²/2; an explicit curve is exempt
T18a–b: negative balances accrue at `borrowRate`, not the portfolio yield
T19: MC mean blends a partial yield curve with `S.yieldRate` instead of ignoring one
T20a–e: early-crash years are pinned, recover after the window, and survive the MC
T21a–f: property `salePrice` overrides appreciation, interpolates, conserves net worth,
        and a sold property leaves the MONTHLY iliq total

**BASE fixture opts out of the new defaults** (`useMedianReturn:false`, `borrowRate:0`,
`sellCostRate:0`, `propertyTaxRate:0`) so T1–T12 keep asserting raw engine mechanics.
Any new test that wants the production defaults must set them explicitly.

⚠ T3 reads a **December** row on purpose: the start-year loop begins at the *current*
month, so any earlier month is simply absent from `out.monthly` once the calendar
passes it. Never assert on a fixed early month in the start year.

## Open / pending
- **Luisma deal**: cap.amount=0, exit.basis=230k, capDate=2036. With the activation fix, da.cv=0 during hold; $230k exits as a windfall via `_dealNetProceeds`. If Luisma represents a pre-existing asset (already paid), cap.type should be 'none' and capDate should be before 2026 so cv initializes at sim start. Needs data review.
- **Tagged sub-items migration**: eventually move tagged S.expenses/S.incomes into deal's own Out/Returns blocks so every deal is self-contained. Not urgent — tagged pattern still works.
- **Gastos spend tracking in Out block**: `_dealCapBlock` has a progress bar vs Gastos actuals. Not yet ported to `_renderDealSubItem`.

## Persistence
- localStorage key: `futuro_scenarios`
- Supabase: project `fnzdkqrkranedtgysqcf` (**gastos**), table `futuro_state`
  - ⚠ Scenario sync and the Gastos actuals share ONE project on purpose. `futuro_state`
    used to live in `alphabiotec` (`kbatdnrxfrltcmqvsmyy`); creating a third project
    crossed the free-tier cap of two, so alphabiotec was auto-paused and sync died
    **silently** — the app kept serving localStorage, so nothing looked broken.
    Never split them back apart.
  - `futuro_state` is the only anon-readable table in gastos. Everything else is
    `auth.uid() = user_id`, and the app reads actuals through Edge Functions
    (`/functions/v1/monthly-actuals`, `/functions/v1/project-actuals`), never
    PostgREST — so anon has no path to `transactions`. Verified with `set local role anon`.
- `saveActive()` → deepCopy(S) into SCENARIOS → lsSave() → sbSave()
