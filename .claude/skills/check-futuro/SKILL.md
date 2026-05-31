# Futuro Code Checker

Thoroughly audit recent changes to `F:\code\futuro\index.html` for correctness bugs before committing.

## When to invoke
Invoke this skill BEFORE every `git commit` on the futuro project.
Also invoke whenever the user says "check", "verify", "does this work", or "any bugs".

## What to check

### 1. Simulation math (`runSim`, `runMonteCarlo`, `getYield`, `getMonthly`)
- `getYield(age)` returns a DECIMAL (already divided by 100). Never divide by 100 again downstream.
- Monthly yield: `Math.pow(1 + yld, 1/12) - 1` where `yld` is the decimal from `getYield`. Verify no extra `/100`.
- Inflation factor `f`: at age=sa+1 mo=1 should be `(1+inf)^(1/12)`. Check formula `(age-sa-1) + mo/12`.
- `liq` mutations: every path that changes `liq` should add/subtract, never multiply by an expense.
- MC saves/restores `S.yieldCurve`, `S.spyPreset`, `S.spyNudge` in a `finally` block. Verify the finally block exists and restores ALL three.
- `_mcParams()` returns `{mean, std}` in % units (e.g. 6.7, not 0.067). Verify `_randn(rng) * std` result is also in %.

### 2. Chart rendering (`msPlugin`, `mcBandPlugin`, `liquidBgPlugin`)
- `x.getPixelForValue(idx)` takes an array INDEX, not the age value. Verify `lbs.indexOf(age)` is used for idx.
- When accessing `data.datasets[N]`, confirm N=0=Liquid, N=1=RealEstate, N=2=Total, N=3=Real.
- `iliqData` must be `data.datasets[1].data` — check every use.
- MC band plugin: age→chartIndex map via `ageIdx[age]` must be built from `ch.data.labels`.

### 3. Persistence (`lsSave`, `_applyScenarios`, `sbLoad`, `sbSave`)
- `lsSave` payload must include `prefs: { yearMode, chartZoom, timeline, mcResult }`.
- `_applyScenarios` must restore all four prefs correctly after loading.
- `sbLoad` fallback: if own row has 0 scenarios, queries most-recent row ordered by `updated_at desc`.
- `sbSave` shows `badge('cloud ✗', 'err')` on error — NOT silently swallowed.
- `saveActive()` only updates the ACTIVE scenario, not all scenarios.

### 4. Timeline (`renderTimeline`, `buildPopoverForm`, `_tlUpd`)
- `_tlUpd` for age fields: if `_yearMode`, must call `readA(num)` to convert year→age before storing.
- Properties shown in PROP row only if `monthlyRent > 0`.
- `xFor(age)` uses `chart.scales.x.getPixelForValue(idx) - ca.left` where idx = `lbs.indexOf(age)`.
- `addItem` for property must use `prop.acquireAge` (not `sa`) as `a0`.

### 5. Year/age toggle (`dispA`, `readA`, `toggleYearMode`)
- `dispA(age)` returns year when `_yearMode`, age otherwise.
- `readA(val)` returns `yearToAge(+val)` when `_yearMode`, `+val` otherwise.
- All age INPUT fields in the UI must use `dispA()` for display and `readA()` on change.
- `body.year-mode` class must be toggled in sync with `_yearMode`.

### 6. Cross-cutting concerns
- No function calls `localStorage.setItem('retiro_*', ...)` — all keys must use `futuro-` prefix.
- `markDirty()` sets `_mcResult.stale = true` AND schedules `_mcAutoTimer` if MC was run.
- `go()` at the end: if `_mcResult !== null && !_mcRunning`, sets `_mcAutoTimer` for 1200ms.
- `lsSave` is called (not just `localStorage.setItem`) whenever a pref changes (yearMode, zoom, timeline, MC result).

## How to audit

1. Read the FULL `runSim` function — trace `liq` through one complete age loop, verify math.
2. Read `getYield` and ALL callers — confirm no double `/100`.
3. Read `_mcParams`, `runMonteCarlo` — confirm units consistency and finally block.
4. Search for every `data.datasets[` reference — confirm index mapping.
5. Read `lsSave` and `_applyScenarios` — confirm prefs roundtrip.
6. Read `buildPopoverForm` — confirm `ageIn()` uses `dispA()`, `_tlUpd` uses `readA()`.
7. Check the last 20 git commits for any regression patterns.

## Output format

Report findings as:
- 🔴 CRITICAL — wrong result, data loss, or silent failure
- 🟡 WARN — likely bug in edge case or missing guard
- 🟢 OK — verified correct

List every CHECK from the sections above with its verdict. If CRITICAL or WARN, show the exact line and the fix.
