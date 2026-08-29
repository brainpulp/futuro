# Futuro — the map

Read this before changing anything that touches money. It exists because the same three
mistakes keep recurring: counting one sum twice, mixing two units, and comparing two
different spans of time. Each section below is a place to check a change against.

CLAUDE.md holds the *history* — which bugs happened and why. This holds the *structure* —
what is true right now, and what must stay true.

---

## 1. Layers, and who owns which number

Money enters the system at the left and is only ever transformed rightward. Nothing
downstream may re-derive a number an upstream layer already owns.

```
  GASTOS (Postgres)          EDGE FUNCTIONS            ENGINE (index.html)      CLIENTS
  ────────────────           ──────────────            ───────────────────      ───────
  transactions ─┬─► monthly_actuals_agg() ──► monthly-actuals ─► _gastosActuals ─┬─► desktop UI
                │   (living costs/mo)                                            │
                ├─► project_actuals_agg() ──► project-actuals ─► _projectActuals ─┤
                │   (spend per project tag)                                       │
                └─► monthly_coverage()   ──►  (completeness)                      │
                                                                                  │
  IBKR Flex ────────────────► get-ibkr-liquid ────────► S.liquidBase ─────────────┤
                                                                                  │
  futuro_state (scenarios) ◄──────── PostgREST ──────► S / SCENARIOS ─────────────┴─► mobile.html
                                                                                      (iframe: engineonly=1)
```

| Number | Sole owner | Everyone else |
|---|---|---|
| Current liquid | IBKR (`get-ibkr-liquid`) → `S.liquidBase` | reads; the scenario's saved value is only a fallback |
| What a project has cost so far | `project_actuals_agg()` | never re-counted from expense items |
| What living costs *were* in a past month | `monthly_actuals_agg()` | replaces the model for that month, does not add to it |
| What anything *will* cost | the scenario (`S`) | Gastos never projects |
| How a row is categorized | the owner, by hand, in Gastos | ⚠ no code may classify a row from its text |
| The projection itself | `runSim()` in index.html | mobile.html drives the same engine in a hidden iframe; it never re-implements it |
| The withdrawal rate | `wrAgg(records)`, once | the card and every ledger row feed it their own months. Two derivations of one percentage is how a headline and a ledger come to disagree — `wr.js` asserts they match |
| Whether spending adapts to the market | `S.flexOn`, overridable per run by `opts.flex` | the scenario holds the answer and the rule (`flexFloorPct`/`guardBand`/`guardStep`); an explicit `opts.flex` still wins, which is what keeps both readings computable side by side over one seed |
| The expected market return | the scenario (`S.yieldRate`) | `market-outlook` **proposes** and records provenance in `S.yieldSource`; it never writes on its own. IBKR auto-applies because a balance is a fact — a forward return is an opinion |

**The engine-only trap.** `mobile.html` loads `index.html?engineonly=1`, which skips
`loadScenarios()` and all sync. Anything the *simulation* reads but the engine-only path
skips must be injected explicitly (`win.eval`) before the first `simulate()`.
`_projectActuals` is the live example — without it, installments re-spend budgets that
Gastos shows were spent years ago.

---

## 2. One month, in order

`runSim()` walks month by month. **Order is load-bearing** — the market return is earned
on the balance *after* asset transactions and *before* income and expenses land.

| # | Step | Touches |
|---|---|---|
| 1 | Property carrying value: appreciate, **or** interpolate `_basis → salePrice` | `iliq` |
| 2 | Property sale → `liq += netOfSellCosts(cv)`, `sold = true` | `liq` ↑ `iliq` ↓ |
| 3 | Deal asset activation (future capital trigger fires) | `iliq` ↑ |
| 4 | Deal asset: appreciate, **or** interpolate `basis → manualPrice` | `iliq` |
| 5 | Deal exit → snap `cv = manualPrice`, `liq += net`, record in `_preYieldExits` | `liq` ↑ `iliq` ↓ |
| 6 | **Market compounding** `liq *= 1 + _liqMonthlyRate(liq, yld)` → `mktGain` | `liq` |
| 7 | Base spend: `expenseCurve[age]` ?? `getMonthly(age) × f`, then `× expMultiplier` | — |
| 8 | **Gastos override** (past months only): actual *replaces* base+trips | — |
| 9 | Itemised expenses: oneoff / monthly / annual / installments / trips | `exp` |
| 10 | Incomes | `inc` |
| 11 | Deal cashflows — `inc += credit − _preYieldExits[d.id]` | `inc`, `exp` |
| 12 | Property tax on carrying value | `exp` |
| 13 | **Guardrail cut** (only when adapting): subtract `cuttable × (1 − flexMult)` | `exp` ↓ |
| 14 | `liq += inc − exp`; track the minimum; push the monthly record | `liq` |

**Step 13 is off unless asked for.** `runSim()` spends the plan regardless of the market,
which measures a refusal to adapt rather than a risk of ruin — nobody keeps drawing the
same amount after a 40% crash. `S.flexOn`, or `runSim(_, _, {flex:true})`, turns on
guardrails: once a year, compare the withdrawal rate just achieved against **the rate the
plan itself draws at that age**, and cut or restore discretionary spending by a step.

⚠ Two other references were tried and both ratchet the cuts to zero and never lift them.
Against the *opening* rate: a drawdown plan's rate rises every year by design, so it cuts
forever even in a healthy market. Against the plan's *wealth path*: cutting your spending
does not move you closer to a baseline that never had the crash, so there is no feedback.
Against the plan's own rate at that age, cutting immediately lowers your own rate — that
feedback is what gives the rule an equilibrium.

⚠ **The reference is built WITHOUT the crash stress test** (`_planWR` zeroes `crashYears`
and restores it). `crashYears` is a specified "what if", not what the plan expects; left
in the reference the plan *expects* the crash, is therefore never behind schedule, and
switching adaptation on while stress-testing a −35% start changes nothing at all — the
one case the feature exists for.

⚠ **The toggle cannot move an unstressed deterministic line, and that is not a bug.** With
no crash set, the drawn projection *is* the plan, so it never falls behind itself. What
adaptation reacts to is a market that differs from the assumption: the 150 sampled ones,
and the crash years. So the toggle changes the success rate, the haze and the worst-tenth
line, and leaves the solid curve alone unless a stress test is set. The phone's switch
says so in its own label, because otherwise it reads as broken.

**Not cuttable, ever:** the floor (`flexFloorPct` of base living cost), installments and
deal capital (contractual), and property tax (a bill). Cuttable: base living above the
floor, trips, and expenses explicitly marked `flex: true`.

**Comparing two Monte Carlos requires one seed.** `runMonteCarlo(n, {seed})` — fixed and
adaptive runs must sample the *same* markets. Unseeded, the ±3pp sampling error at 150
paths is enough to report that adapting did worse than refusing to, which is impossible.

**Report the AVERAGE give-up, not the deepest cut.** Over thirty years nearly every path
dips far enough below plan at some point to cut everything, so "deepest cut" saturates at
100% and says nothing (`flexAvgMult` vs `flexMinMult`).

Steps 5 and 11 are one transaction seen twice. The subtraction in 11 is what stops it
being counted twice — sale proceeds are credited pre-yield so they earn that month's
return, then removed from the main-loop credit.

**The start year is a partial loop.** It runs from the *current* calendar month to
December, not from January. Any test asserting on a fixed early month in the start year
breaks silently once the calendar passes it — assert on December.

⚠ **Step 8 is unreachable for a plan that starts this year, and that is correct.** The
partial loop never looks up a Gastos actual, and the main loop opens at `sa + 1`, so the
earliest month it ever visits is January of `startYear + 1`. The branch needs
`_simYM < _currentYM`, so it only fires when `startYear` is a *past* year. The months of
the start year before today are skipped on purpose: `liquidBase` is the current portfolio
value and already reflects them, so spending them again would double-count against IBKR.
The desktop badge still reports how many months loaded — that count is real, it simply
does not reach the projection for a current-year plan. Do not "fix" this by wiring the
actuals into the partial loop.

---

## 3. Conservation laws

Check a change against these before believing it.

**Net worth.** For any month: `Δ(liq + iliq) = inc − exp + mktGain`.
At a sale, `liq` gains exactly what `iliq` loses, so `Δ = 0`. Guarded by T12a/T12b/T21.

**A sold asset leaves both totals.** `props.filter(p => !p.sold)` must appear in *both*
monthly pushes and the yearly row. A frozen carrying value counted forever overstates net
worth after every sale.

**A project budget is the whole project.** `budget` (or `installTotal`) includes what has
already been spent. Future spend is therefore `budget − _projActual(cat)`, spread over
`installN − slotAtStart` remaining payments. Never count whole payment-sized chunks:
`floor(spent / perPayment)` discards the part-payment and spends it twice.

**Payment labels count the remaining run.** "11 of 11" describes money already spent at a
payment size no longer being charged. The remaining payments cover only the remaining
budget, so they number 1..N of what is left.

---

## 4. Where the same money can get counted twice

Every entry here is a live guard. Removing one reintroduces a bug that has already shipped.

| Two sources for one sum | What stops the double count |
|---|---|
| Gastos actual for a past month **and** the itemised expenses inside it | items with a `gastosCategory` are skipped when an actual exists |
| Budget already spent **and** future installments | `_effInstall` re-bases the money: `budget − _projActual(cat)` over the slots still scheduled |
| Deal exit credited pre-yield **and** in the main loop | `_preYieldExits[d.id]` subtracted at step 11 |
| A one-off before today **and** `liquidBase` | past one-offs are never deducted; IBKR's figure already reflects them |
| Unfiled project labour **and** the project budget | vendor precedent routes it to the owner's own category, out of living costs |
| A credit-card bill **and** the purchases on it | ⚠ nothing — both count if the bill is untagged. Tag it in Gastos |
| Elapsed time **and** payments actually made | `slotAtStart` re-bases `slot` to the sim's first month (`_installNum`) |
| An untagged Gastos row **and** a scenario item with no `gastosCategory` | ⚠ nothing — the skip at step 9 only covers items that *have* a category. Latent: step 8 cannot fire for a current-year plan. It becomes live the moment `startYear` is a past year |

---

## 5. Units and scope — the two silent mismatches

**Nominal vs inflated.** Everything is entered in today's money.

| Inflated by `f` | Left nominal |
|---|---|
| base spend, trips | one-off items |
| recurring (`monthly` / `annual`) expenses | installments |
| recurring incomes — *symmetrically*, T16b | deal capital and returns |

The nominal ones are contractual amounts fixed at a date. Expenses and incomes must be
treated identically; asymmetry there is a bug, not a modelling choice.

`f = (1 + inflationRate)^(_partFrac + (age − startAge − 1) + mo/12)`, recomputed every
month. It is anchored to `_partFrac` so the partial first year and the main loop share one
continuous timeline and nothing resets at the year boundary. At 3% a $5,000/mo plan spends
$6,786/mo at age 67 and $9,120/mo at 77; a recurring income of $1,000 becomes $1,357 and
$1,824 over the same span. At 0% every figure stays flat. So the answer to "does spending
keep up with the loss of value" is yes, by construction, for everything except the
contractual items above.

⚠ **A baked `expenseCurve` REPLACES `getMonthly(age) × f`; it does not multiply it.** The
curve already carries inflation, which is why moving the inflation slider calls
`rebakeExpenseCurve()` against `S.expenseAnchor`. A scenario with a curve therefore does
not respond to the inflation rate the way a flat `monthlyExpenses` does — it is re-baked
instead. Multiplying a curve by `f` would apply inflation twice.

⚠ **Every figure on screen is NOMINAL.** "$13.3M at 87" is money of that year, not today's.
`buildChartData` computes a `real` series but no chart consumes it, so there is no
inflation-adjusted view anywhere in either app. The market return is nominal too, so the
two are consistent — 7% return against 3% inflation is ~4% real — but nothing on screen
says so.

**Whole-plan vs windowed.** The three head tiles measure the entire plan. The chart can be
clipped to 5/10/20 years. A trough at 95 under a 57–77 view is not a contradiction, and
the UI must say so — tiles print their age, the chart prints its span. Reported as a bug
three times before it was labelled.

**The withdrawal rate is ONE year, not a lifetime average.** The card reads the first plan
year only (`recs.filter(m => m.year === recs[0].year)`) — the current one. Numerator is
`spending − income` for that year; sale proceeds are *not* income, since selling a house
converts illiquid to liquid rather than drawing on savings. Denominators are the balances
at the **start** of the year, taken from the preceding month. Other years are not averaged
in and are not hidden either: every ledger row carries its own rate at year, quarter or
single-entry grain, through the same `wrAgg`.

⚠ **"Of everything" is not comparable to the 4% rule.** That rule is about a liquid
portfolio; putting property in the denominator makes the rate look lower than what you can
actually spend. It answers "how much of this depends on selling something", nothing more.
And the 4% figure applies to the first year only — after that it measures spending against
a portfolio that has moved.

**Annualising vs one-time.** The withdrawal rate annualises so a month and a year are
comparable — but scaling a LUMP is a category error. The plan's first year is partial (the
sim opens at the current month), so a car bought once in a five-month stub, scaled by 12/5,
reads as a car bought every five months forever: 24% where the truth is 13%. `wrAgg`
annualises the recurring part only and adds one-offs at face value. Over a full 12 months
the two are identical; only the stub year differs.

**Monthly vs yearly.** The chart plots `d.monthly`, so ages are fractional and points are
matched by proximity, never equality. `minLiq`/`minAge`/`minMo` are monthly; "net worth at
end" reads the last *monthly* record. The yearly roll-up differs from the curve's
right-hand end, so mixing them makes a tile disagree with the line beneath it.

**Arithmetic vs geometric is a unit, and mixing them is silent.** `S.yieldRate` is an
*arithmetic* expected return: `getYield` subtracts σ²/2 from it to get the median path.
Anything fed into it must be arithmetic too — the market outlook's equity premium is
labelled as such for this reason. Hand it a geometric figure and the drag is applied to a
number that already has it, penalising twice.

⚠ The mirror of that is worse. A `yieldCurve` value is a *realized path* and is exempt
from drag by design, so routing a forecast through the curve skips the correction
entirely: at σ=15% that is 1.13%/yr, compounding to about **1.4× overstated wealth over 30
years**, and it presents as good news. The market outlook therefore writes `yieldRate` and
never builds a curve. It does *shift* an existing curve by the delta — same as typing in
the return box, and a re-centred path is still a path.

**Volatility drag applies to the flat rate only.** A per-age `yieldCurve` value is a
realized path whose own ups and downs already drag compounding below the arithmetic mean;
subtracting σ²/2 on top double-penalizes. The Monte Carlo suppresses drag entirely
(`_mcActive`) because its spread already produces the median.

---

## 6. Silent-failure register

Failures that look like correct output. Each one shipped.

| Symptom | Cause |
|---|---|
| A total that is quietly two-thirds short | PostgREST caps a select at 1000 rows and says nothing. Page explicitly, or aggregate in SQL |
| A cheap-looking recent month | statements uploaded only to the 23rd. `complete` / `lastDay` / `days` from `monthly_coverage()` |
| Sync appears to work, data is stale | `sbLoad()` hangs → 8s deadline, then local data |
| A stale IBKR figure | auto-sync only `console.warn`s. Click "↓ IBKR" to see the error |
| An empty scenario list on the device | `beforeunload` savers running under `engineonly=1`, where `SCENARIOS` is `[]` |
| Living costs missing whole categories | `xfer` means "paid by bank transfer", not "internal movement" |
| A permission that looks revoked | `REVOKE … FROM anon` is a no-op while PUBLIC holds the grant, **and** Supabase grants EXECUTE to anon/authenticated directly. Name all three, then check `has_function_privilege` |
| A UI edit that does nothing | editing the function that doesn't render (`_dealCapBlock` vs `_renderDealSubItem`), or a one-off dated before the sim's opening month |

---

## 7. Before saying a number is right

1. Run `_selfTest()` — 52/52, no exceptions.
2. Name the layer that owns the number. If two layers compute it, one is wrong.
3. Walk it through §2 in order. Did it land before or after the market return?
4. Check it against §3. Does `Δ(liq + iliq)` still hold at every transaction?
5. Check §4. Is there a second path to the same money?
6. Check §5. Same units? Same span of time? Monthly or yearly?
7. If the number comes from Gastos: is the month complete, and how much of it is unfiled?
