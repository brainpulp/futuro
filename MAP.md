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
| 13 | `liq += inc − exp`; track the minimum; push the monthly record | `liq` |

Steps 5 and 11 are one transaction seen twice. The subtraction in 11 is what stops it
being counted twice — sale proceeds are credited pre-yield so they earn that month's
return, then removed from the main-loop credit.

**The start year is a partial loop.** It runs from the *current* calendar month to
December, not from January. Any test asserting on a fixed early month in the start year
breaks silently once the calendar passes it — assert on December.

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

**Whole-plan vs windowed.** The three head tiles measure the entire plan. The chart can be
clipped to 5/10/20 years. A trough at 95 under a 57–77 view is not a contradiction, and
the UI must say so — tiles print their age, the chart prints its span. Reported as a bug
three times before it was labelled.

**Monthly vs yearly.** The chart plots `d.monthly`, so ages are fractional and points are
matched by proximity, never equality. `minLiq`/`minAge`/`minMo` are monthly; "net worth at
end" reads the last *monthly* record. The yearly roll-up differs from the curve's
right-hand end, so mixing them makes a tile disagree with the line beneath it.

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
