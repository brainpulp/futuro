# Futuro — Claude Instructions

## READ MAP.md FIRST
`MAP.md` is the conceptual map: the layers and who owns which number, the exact order of
operations inside one simulated month, the conservation laws, the register of places the
same money can be counted twice, and the units/scope mismatches. Read it before touching
anything that moves money, and check a change against its §7 checklist before claiming a
number is correct. This file is the history of what went wrong; MAP.md is the structure
that must stay true.

⚠ **MAP.md is also the app's own map panel** — the "map" button in the desktop top bar
fetches `MAP.md` and renders it with `_mdRender()`. There is deliberately no second copy:
a map that can drift from the code it certifies is worse than none. Keep MAP.md to the
Markdown subset the renderer handles (h1–h3, paragraphs, `---`, fenced code, ordered and
unordered lists, tables, inline code/bold/italic) — anything else renders as plain text.
`map.js` asserts the section, table and row counts, so adding a section means updating it.
Not in mobile.html: the phone ships no CDN and stays lean, and the map is a desk-side
reference.

## Session start protocol (ALWAYS do this first)
0. **Read `MAP.md` end to end.** Not skimmed, not "I remember it" — the recurring failures
   have all come from working off recollection instead of the structure. Before any change
   that moves a number, name the layer that owns it (§1), locate it in the month (§2), and
   run §7 afterwards. Costs one file read; the alternative has cost far more.
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
- Scenario sources, in order: `#s=` URL hash (gzip+base64url) → newest of
  (`futuro_state` in Supabase, `localStorage.futuro_scenarios`) → `EMPTY`.
- No CDN and no chart library: the area chart is hand-rolled inline SVG.
- Controls: spend, return, volatility, early crash, inflation, horizon, median toggle,
  cost toggle, per-asset sale price + year steppers, per-income enable/remove **plus
  name/amount/age-span**, add/remove businesses, per-expense name/amount/date/enable/
  delete + add, a scenario picker when more than one exists, and scenario-level fields
  (liquidBase, startAge, assetAppreciation, sellCostRate, propertyTaxRate, borrowRate).

### mobile.html — base spend from Gastos
"Use what you actually spend" sets monthly spending to the mean of the **last three
complete months** from `monthly-actuals`, which sums only the categories in the
`monthly expenses` group in gastos settings. "Complete" means the month's statements
reach its end — see the `monthly-actuals` section; a month cut short is skipped and named
in the caption, never quietly averaged in.
- Applying it marks `sp` as touched, so the figure PERSISTS and the desktop sees the same
  number. It is not a display-only overlay.
- Dragging the spend slider is an explicit manual override and switches tracking off;
  the choice lives in `localStorage.futuro_mobile_spend_src`.
- The value is clamped to the slider's own min/max/step, so the control and the number it
  reports can never disagree.

### mobile.html — withdrawal rate
`#wrCard` shows what the plan draws each year on two denominators, from `cur.wr` (built in
`simulate()`, ALWAYS — unlike the ledger it is not gated on a card being open).
- `net = spending − income`. Sale proceeds are **not** income here: selling a house
  converts illiquid to liquid, it is not a draw on savings.
- ⚠ **The first plan year is partial** (the sim opens at the current month), so its raw
  total is a few months of spending against a full year's portfolio — about 2.5% where the
  truth is 6%. `wr` annualises (`net × 12 / months`) and the card says how many months it
  rests on. Never show the raw figure for that year.
- Denominators are the balances at the START of the year, taken from the preceding month,
  with the first month inferred from its own flows — the same trick the ledger uses, so
  the two can never disagree.
- **"Of everything" is not comparable to the 4% rule.** That rule is about a liquid
  portfolio; property in the denominator makes the rate look lower than what you can
  actually spend. It is a "how much of this depends on selling something" gauge.
- `pctLiq` is null once opening cash ≤ 0. Both the year row and the detail row then render
  **nothing** rather than a dash, which reads as a missing number instead of an undefined
  one.
- The ledger annotation is year-grain only — a quarter's draw against a full-year
  portfolio would be a quarter of the truth.

### mobile.html ↔ cloud sync
Edits autosave (700 ms debounce) to localStorage **and** upsert into the same
`futuro_state` table the desktop uses, so the two apps round-trip.
- Talks to PostgREST with plain `fetch` — no supabase-js, because this page ships no CDN.
  `SB_URL`/`SB_ANON` are read out of the engine frame (`win.eval`), never copied, so the
  repo holds one set of credentials.
- Each device owns one row keyed by `localStorage.futuro_sb_id`; loading merges rows by
  scenario NAME keeping the newest, exactly like index.html's `sbLoad()`. The cloud wins
  only when **strictly newer** than localStorage — same tie-break as the desktop, so the
  two can never disagree about which copy is authoritative.
- ⚠ **Saving uses `materialize()`, NOT `readControls()`.** `readControls()` flattens
  `expMultiplier`, `expenseCurve` and `yieldCurve` so the phone's sliders are the whole
  story — correct for simulating, catastrophic if persisted, since it would wipe a baked
  curve the desktop owns. `materialize()` writes back only fields in the `touched` set,
  so merely opening the phone can never rewrite anything.
- Touching spend clears `expenseCurve`, touching return clears `yieldCurve` — otherwise a
  baked per-age curve overrides the edit on the desktop and the change looks ignored.
- A scenario from `#s=` or an inlined build is `readOnly`: it renders and simulates but
  never saves, so opening someone's shared link cannot overwrite your own plan.
- ⚠ **The built-in `EMPTY` fallback is `readOnly` too, and must stay that way.** It is not
  user data, and merge-by-name means a demo scenario called "Base" outranks the real
  "Base" once it is newer. This is easy to hit: an iOS home-screen app gets a fresh
  storage partition, so the phone legitimately starts with nothing, falls back to the
  sample, and any edit would otherwise publish the sample as the user's plan. It already
  happened once — the cloud row had to be backdated to 2000-01-01 to defuse it.
- ⚠ **index.html's `beforeunload`/`visibilitychange` savers MUST stay inside
  `if (!_engineOnly)`.** In engine-only mode `loadScenarios()` never runs, so `SCENARIOS`
  is `[]` — persisting that writes an empty scenario list over the real one. Because
  mobile.html embeds index.html in a hidden iframe, every navigation away from the phone
  view used to wipe `futuro_scenarios` on that device.
- Detail sections are `<details class="card">`, collapsed by default, each with a `.cnt`
  summary so the closed state still says what is inside. Browser tests must open them
  (`d.open = true`) before interacting, and again after clicking "Undo my changes".
- Browser tests: `#sp` has `step="250"`, so slider values snap — assert on aligned
  numbers. Navigating to `mobile.html#s=…` from `mobile.html` is a same-document hash
  change and does NOT reload; force a `reload()`. Build scenario fixtures from the
  engine's own `EMPTY` — a hand-written sparse scenario makes `runSim()` return a final
  row of `NaN`, which the UI then shows as a plausible-looking `$0k`.
- ⚠ A one-off dated earlier in the START year never fires: the sim opens at the *current*
  month. `renderExpenses` flags those `_past` ("already spent") — without it, editing the
  amount silently does nothing and looks broken. Four of the sample scenario's five
  project costs are in this state.
  - One-offs therefore expose a **month** select as well as an age. Without it every cost
    at the start age lands in January, which is behind the sim's opening month for most of
    the year, and no amount of editing can rescue the money. The desktop shows those costs
    as ordinary future spending while equally never spending them — mobile is the only
    place that says so, which reads as "the phone has the wrong data".
- Chart range buttons (`#zoom`: 5/10/20 yr, All) clip the series to the next N years and
  rescale both axes to that window. It is a VIEW preference: kept in
  `localStorage.futuro_mobile_zoom`, never written into the scenario, and the handler
  redraws via `chart(cur.series)` without re-simulating or calling `markDirty()`.
  ⚠ `visible()` must feed BOTH the drawing and the pointermove readout — if only one uses
  it the tooltip reports a different age than the point under your finger.
- ⚠ **The three head tiles are WHOLE-PLAN figures; the curve below them is windowed.** That
  reads as a contradiction — a curve that never nears zero above "Lowest cash −$3.99M",
  whose trough is simply at age 95 outside a 20-yr view. It was reported three times as a
  bug. Each tile therefore prints the age it refers to (`#kNWAt`/`#kMinAt`/`#kMCAt`), and
  `syncRange()` captions the chart with the visible span vs the plan span, calling out in
  `--warn` when the trough falls outside the window. Floor the ages, never round: the last
  monthly point is age N month 12, and rounding says the plan runs a year past the tiles.
- Dragging the chart pins a crosshair: dashed cross, a dot on the total curve, and the
  amount + age drawn on the curve itself. It deliberately does NOT clear on
  pointerup/pointerleave — reading the value after lifting your finger is the point.
  - `markAge` stores an AGE, not an index, so the pin survives a re-simulation and a zoom
    change. It is drawn inside `chart()`'s single `innerHTML` write, so any redraw keeps
    it; drawing it separately would be wiped by the next `chart()` call.
  - If the pinned age falls outside the zoom window it is hidden rather than clamped —
    clamping would silently point at a different year.
  - Labels use `paint-order="stroke"` with a `--card`-coloured stroke as a halo, otherwise
    they are unreadable over the filled areas.
  - The pointermove guard is `pointerType === 'mouse' || e.buttons`: touch only reports
    moves while in contact, and a mouse should still track on hover. A synthetic
    `PointerEvent` with neither set is correctly ignored — tests must set `pointerType`.
- A condensed result bar (`#stick`) mirrors the verdict + net worth + MC while scrolling.
  It is `position:fixed` (not sticky) so it never occupies layout space, revealed by an
  IntersectionObserver on `#head`, and `aria-hidden` since it duplicates that card.
- ⚠ Text-input handlers must NOT call `renderLists()`: replacing the node that is mid-blur
  throws "node to be removed is no longer a child". Update the field in place, then
  `render(true)`. Only button clicks may re-render the list.
- Sale-year steppers must handle BOTH shapes: plain `S.properties` (`saleAge`/`hold`) and
  migrated deals (`exit.date` as `YYYY-MM`, year 2100 = hold). `assetsOf`/`applyEdits`.
- ⚠ Never commit real scenario data into mobile.html — the repo is public and deployed.
- ⚠ **`engineonly=1` skips `projectActualsSync()`, which the SIMULATION depends on.**
  `runSim` counts installments already paid as `floor(_projActual(cat) / perPayment)` for
  any expense with a `gastosCategory`. With `_projectActuals` empty in the frame that
  returns 0, the engine falls back to counting elapsed *time*, and re-spends budgets
  Gastos shows were spent years ago — Carhué and Arcos alone made the next two years look
  catastrophic. mobile.html therefore fetches `project-actuals` and injects it with
  `win.eval('_projectActuals = …')` BEFORE the first `simulate()`. Anything else added to
  the `if (!_engineOnly)` branch that the engine reads must be injected the same way.
- The chart plots the MONTHLY series (`d.monthly`), not the yearly rows, so ages are
  fractional (month as a twelfth) and points are matched by proximity, never equality.
  `minLiq`/`minAge`/`minMo` are monthly, so a yearly chart could never put the trough
  marker on the line. "Net worth at end" reads the last MONTHLY record for the same
  reason — the yearly roll-up differs from the curve's right-hand end.

### Home-screen install (iOS)
`mobile.html` is installable via Safari → Share → Add to Home Screen. It launches
standalone (no browser chrome) because of `apple-mobile-web-app-capable`.
- ⚠ iOS reads **`<link rel="apple-touch-icon">` only** for the home-screen icon — it
  ignores `manifest.icons`, SVG and `data:` URIs. That link must point at a real PNG
  (`icon-180.png`), by RELATIVE path: the site is served from `/futuro/`, so a leading
  slash resolves to the wrong origin root. Icons are generated by hand-written PNG
  encoding (see git history) since no image library is available in this environment.
- `manifest.webmanifest` exists for Android/Chrome; iOS does not use it.
- ⚠ An iOS home-screen app gets its **own storage partition, separate from Safari**, so
  `localStorage` starts empty there and it registers as a NEW device row
  (fresh `futuro_sb_id`). It repopulates from Supabase on first launch — which only works
  because cloud sync exists. Merge-by-name means the extra row is harmless.
- No service worker: with no network the app will not start. Add a network-first one if
  offline launch is ever wanted (network-first, so a stale cache can't pin old code).

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
S.crashStartAge     // where the crash lands. Unset = startAge. It used to be pinned to
                    // startAge, which assumed the plan begins when you stop earning —
                    // wrong for anyone who stopped years ago or plans to work again.
S.crashYears        // sequence-of-returns stress: N years from crashStartAge pinned to…
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

## Gastos actuals — `project_actuals_agg()`
`renderProjectBudgets()` compares budgeted project costs against this function, via the
`project-actuals` Edge Function (which only reshapes `(tag,ym,amount)` into
`{tag:{byMonth}}` — so changing the SQL needs no redeploy, but changing its SIGNATURE does).

- **`tag` = `project` if non-empty, else `cat`.** The `project` column is empty on all
  10,485 rows today, so in practice every tag is a *category*. Set `gastosCategory` on an
  expense to the category name, not to some project label that exists only in your head.
- ⚠ **`xfer` means "paid by bank transfer", NOT "internal movement".** Contractors are paid
  by transferencia, so filtering `xfer = false` deleted most construction spend — Arcos
  read $206 for 2026 against a true $9,167, and ~$52k of 2026 project spend was invisible.
  Internal movement is identified by CATEGORY instead: `interbank outgoing` ($8.59M),
  `transfers` ($965k), `interbank incoming`. Those three stay excluded; nothing else does.
- **Amounts are GROSS outflows — inflows are deliberately not netted off.** `roca deptos`
  has $35.5k of inflows that are rental revenue, not cost refunds; subtracting them would
  understate budget consumed.
- Blind spot: ~$31k of 2026 outflows (156 rows) have neither `cat` nor `project` and so
  appear under no tag at all. Categorize them in Gastos, not here.

### Installments vs Gastos: the budget is the WHOLE project
`budget` (or `installTotal`) is the total for the project **including what has already
been spent**. Future spend must therefore be `budget - _projActual(gastosCategory)`.
- ⚠ Counting whole payment-sized chunks (`floor(spent / perPayment)`) throws the
  part-payment away and spends it twice. Carhué at 150,000 over 8 payments with 102,017
  spent left 3 x 18,750 = 56,250 against a true 47,983 remaining — an 8,267 overshoot.
- `_effInstall` therefore re-bases the MONEY, not the count: whatever is left is spread
  over the payments still scheduled (`installN - slotAtStart`), so the future total is
  exactly `budget - spent`. Plans with no `gastosCategory` keep the timing-only path.
- Payment labels count within the REMAINING run (`_installLabel`), not the original
  schedule. "11 of 11" described money already spent, at a payment size no longer being
  charged; the remaining payments cover only the remaining budget, so they read 1..N of
  what is actually left.
- The phone's per-cost field edits `budget`/`installTotal` only. It must NOT write
  `amount` as well: for installments the engine reads `budget || installTotal` and
  `amount` is a separate contractual figure, so writing all three collapses them.

## Gastos actuals — `monthly-actuals` Edge Function
Feeds the baseline "what do I actually spend" line for past months. Sums outflows whose
`cat` is in the **`monthly expenses`** group defined in `settings.groups` (gastos).
- It carried the SAME `xfer` bug as `project_actuals_agg` (`if (tx.xfer) continue`), which
  dropped living costs paid by transferencia — healthcare, boat maintenance, sports, pets.
  Historical baseline was understated by ~$8.2k; recent months were off by far more in
  relative terms (2026-06: $2,912 → $5,286; 2026-04: $3,659 → $6,455). Fixed in v5.
- ⚠ **PostgREST caps a select at 1000 rows and says nothing about the rest.** This filter
  matches ~3,006, and rows come back roughly oldest-first, so a single `.select()` dropped
  exactly the RECENT months the three-month average is built from — the baseline read
  $1,495/mo against a true $5,026. v6 pages explicitly (`.order('id').range(...)`, loop
  until a short page). Verified against SQL: 2026-05 $8,306 · 2026-06 $5,286 ·
  2026-07 $1,487 → mean $5,026 (the phone clamps to the slider's $250 step → $5,000).
- ⚠ **A month is only usable once its statements reach the end of the month.** An upload
  cut on the 23rd is not a cheap month, it is an unfinished one, and BOTH consumers
  replace projection with the actual — so a partial month silently claims you lived on a
  fraction of your real costs. v7 attaches `complete`/`lastDay`/`days` per month from
  `monthly_coverage()`; `gastosSync()` skips incomplete months (falling back to modelled
  spend) and mobile's `gastosAvg()` averages the last three COMPLETE months, naming what
  it skipped. 2026-06 is the live example: 140 rows, last one on the 23rd.
  - Coverage is measured over EVERY transaction in the month, not the category subset —
    "no groceries in the last week" is not the same as "the statement was cut short".
  - Slack is 3 days (`COVERAGE_SLACK_DAYS`), so a quiet month-end weekend still counts.
  - Rows are FLAGGED, not dropped: dropping them would have changed the response shape
    under the copy of the desktop already deployed on Pages. Both clients filter.
  - `monthly_coverage()` is SECURITY DEFINER, EXECUTE revoked from `public`, `anon` AND
    `authenticated`. ⚠ Supabase's default privileges grant EXECUTE to anon/authenticated
    *directly*, so `REVOKE ... FROM PUBLIC` alone leaves `has_function_privilege('anon',…)`
    true. Name all three roles, then check.
- **Uncategorized outflows COUNT as monthly expenses** (user's call — nobody files every
  transaction, so dropping them understated the baseline by whatever was forgotten)
  **unless the vendor has a precedent**, in which case the owner's own past decision
  applies. All of it lives in `monthly_actuals_agg()`; v9 of the function just reshapes.
  - ⚠ **Never classify a row from its text.** An earlier version held back rows that
    "obviously" were not consumption (a supplier run, a transfer to an investment vehicle,
    a card bill). That is this code inventing a category the owner never assigned, which
    is exactly what it must not do. Every category comes from a row filed by hand.
  - **Vendor identity** = the 11-digit CUIT in `raw_desc` when present, else `merchant`.
    Covers 83% of untagged rows. Nothing else is a stable key.
  - **Precedent is RECENCY-weighted**: dominant category among that vendor's last FIVE
    filed rows, ties to the newest. ⚠ Frequency alone gets it backwards for anyone whose
    role changed — CUIT 20274569736 has 53 old `Mocoreta` rows, 14 `El Dorado`, 7 `Arcos`
    and 110 recent `Carhué obra`; most-frequent still resolves him to a project he left
    in 2024, and no single category reaches an 80% share.
  - Effect on 2026-07 (212 rows, 115 untagged): $7,504 routed out as project labour,
    $1,481 folded in as living costs, $11,090 left with no precedent at all — of which
    $10,000 is one untagged "Transfer to Lucord strategic". Tag that row in Gastos and
    precedent handles it and every future one.
  - Reported per month as `unfiled` / `unfiledN` / `inferredOut` / `unknown`, shown in the
    phone caption and the desktop badge tooltip. Never silent.
  - Doing the whole aggregation in SQL also retires the PostgREST 1000-row hazard for this
    path — there is no `.select()` to truncate any more.
- `.in('cat', cats)` is **case-sensitive**. It currently matches (0 rows lost), because the
  strings in `settings.groups` match the stored case exactly. Renaming a category in one
  place and not the other will silently drop it from the baseline — check both.
- ⚠ Both actuals functions are deployed `verify_jwt: false` **on purpose**. With it enabled
  the gateway rejects the CORS preflight `OPTIONS` (no Authorization header) before the
  function's own CORS handler runs, so the browser call fails. Do not "harden" this.

## Market outlook — `market-outlook`
A forward-looking base return built from a PRICE, not a forecast: the 10-yr TIPS real
yield from the US Treasury's keyless XML feed, plus `S.erp` (equity premium, default 4.5)
plus `S.inflationRate`. Cached a month in `localStorage['futuro-outlook']`.
- ⚠ **It proposes; it never writes.** `applyOutlook()` runs only on a click, and stamps
  `S.yieldSource` with the reading, the premium and the inflation used. IBKR auto-applies
  because a balance is a FACT; a forward return is an OPINION, and MAP §1 gives one number
  one owner.
- ⚠ **Writes `S.yieldRate`, never a `yieldCurve`.** A curve value is a realized path and
  is drag-exempt, so a forecast routed through it would skip the mean→median correction —
  1.13%/yr at σ=15%, ≈1.4× overstated wealth over 30 years, presenting as good news. It
  does *shift* an existing curve by the delta, exactly as typing in the return box does.
- ⚠ **Every term is ARITHMETIC**, matching what `getYield` expects. A geometric premium
  would be penalised twice.
- **No sentiment on purpose.** VIX/AAII carry nothing past a few weeks against a 40-year
  plan; refreshing weekly would move the headline for reasons that say nothing about age
  95. Monthly cadence for the same reason.
- Deployed `verify_jwt: false`, same CORS-preflight reason as the actuals functions.
- Untested against the live Treasury feed — the sandbox proxy 403s every market data host.
  `outlook.js` covers the client, `parse.js` the feed parser against a synthetic document.

## IBKR sync — `get-ibkr-liquid`
`ibkrSync()` pulls Net Liquidation Value and writes it to `S.liquidBase`, caching it in
`localStorage['futuro-ibkr-liquid']`. That cache is applied on EVERY load in
`_applyScenarios` — IBKR is treated as the source of truth for current liquid, and the
scenario's saved `liquidBase` is only a fallback.
- The function lives in **gastos** (`SB_URL`), alongside everything else. It was in
  `alphabiotec` and died when that project was paused; repointing `SB_URL` to gastos
  without moving it left the call 404ing, so it was redeployed here. Source of truth for
  the code is `supabase/functions/get-ibkr-liquid/index.ts` in this repo.
- ⚠ Needs the `IBKR_FLEX_TOKEN` secret set **in gastos**. Without it the function returns
  a 500 whose body names the missing secret. `QUERY_ID` is hardcoded (`1510170`).
- `verify_jwt: false`, same CORS-preflight reason as the actuals functions.
- Auto-sync only runs when `localStorage['futuro-ibkr-auto'] === '1'` (the "auto"
  checkbox), then every 4h — the Flex API rate-limits frequent calls.
- A manual click alerts on failure; an auto-sync does not interrupt, but no longer hides
  either — the button turns amber and its tooltip carries the reason plus the age of the
  figure still on screen (`_ibkrWhy` / `_ibkrAge`).
- ⚠ **`ibkrSync` must NOT be gated on `_sb`.** It used to open with `if (!_sb) return;`,
  though the call is a plain `fetch` with the anon key and never touches supabase-js. Any
  failure to load `./index_files/supabase-js@2` therefore made the button return instantly
  and silently: no request, no error, no label change, and nothing in the function logs to
  show for it.
- `QUERY_ID` defaults to `1510170` but is overridable by the `IBKR_QUERY_ID` secret — a
  wrong query id fails as an IBKR error code, which reads like a bad token.

## Supabase security posture (gastos)
- `project_actuals_agg()` is SECURITY DEFINER. EXECUTE is revoked from `PUBLIC`/`anon` —
  the anon key ships in a public repo, so that path let anyone dump spend-by-category.
  ⚠ A role-level `REVOKE ... FROM anon` is a NO-OP while PUBLIC still holds the grant;
  revoke from `PUBLIC`, then re-`GRANT` to `service_role` (the Edge Function path).
- `authenticated` deliberately keeps EXECUTE — a real login, not a public exposure, and
  other clients in this project can't be inspected from here. Lint 0029 stays by choice.
- `upwork_staging` has RLS on with no policy = deny-all except service_role. That is the
  correct state for a service-role-only staging table; lint 0008 is a false positive here.
