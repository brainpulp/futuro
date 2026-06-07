# Plan: Deals Migration — Convert Properties/Incomes/Expenses into Deals

**Date:** 2026-06-07  
**Prerequisite:** `2026-06-07-deals-sim-layer.md` completed (deals loop + helpers in place)

## Goals
1. Fix exit-proceeds compounding bug (_dealNetProceeds uses annual, properties use monthly).
2. Migrate all current S.properties/incomes/expenses items into S.deals for all 3 scenarios.
3. Verify sim parity (liq values identical within $1) before persisting.
4. Leave Mocoretá as a property (no toggle needed, no decision to make).

---

## Pre-analysis: Age → Date conversion
- `startAge = 57`, `startYear = 2026`
- Age X → year = 2026 + (X − 57), month = atMonth || rentFromMonth || 1
- Property saleMonth default = 6 (June): `(p.saleMonth || 6)`
- Expense atMonth default = 1 (January)

---

## Task 1 — Fix: _dealCashflow exit uses da.cv (monthly compounding)

**Problem:** `_dealNetProceeds` uses annual compounding `basis × (1+rate)^years` but properties
use monthly compounding `cv × (1 + rate/100/12)^months`. This causes ~$2–3k divergence per
property per sale, failing the parity check.

**Fix:** Pass the deal's `_dealAssets` entry (`da`) into `_dealCashflow` as a 4th parameter.
In the exit block, if `da && da.cv > 0` and `ex.type === 'auto'`, use
`Math.round(da.cv * (1 − sellingCosts))` instead of `_dealNetProceeds`.

**Also:** Restructure the deals loops (partial-year + main) to appreciate `da.cv` BEFORE
calling `_dealCashflow`, so the exit month's cv is fully compounded (same timing as properties).

### Steps

**1a.** Update `_dealCashflow` signature and exit block:

```js
function _dealCashflow(deal, year, mo, da) {   // <-- add da param
  ...
  // ── Exit ──
  if (ex.type !== 'none' && ex.date) {
    const [ey, em] = ex.date.split('-').map(Number);
    if (year === ey && mo === em) {
      let net;
      if (ex.manualPrice != null && ex.manualPrice !== '') {
        net = Number(ex.manualPrice) * (1 - (ex.sellingCosts || 0) / 100);
      } else if (da && da.cv > 0) {
        // Use monthly-compounded cv (already appreciated this month by caller)
        net = Math.round(da.cv * (1 - (ex.sellingCosts || 0) / 100));
      } else {
        net = _dealNetProceeds(deal, ey);  // fallback for deals without _dealAssets entry
      }
      credit += net;
      txns.push({ id: deal.id, arr: 'deals', name: deal.name + ' exit', amount: Math.round(net), type: 'deal-exit' });
    }
  }
```

**1b.** Restructure **partial-year deals loop** (appreciate BEFORE cashflow call):

```js
// ── Deals (partial-year loop) ──
(S.deals || []).filter(d => d.enabled !== false).forEach(d => {
  const da = _dealAssets[d.id];
  // Appreciate first (same timing as properties)
  if (da && !da.sold && da.cv > 0) da.cv *= Math.pow(1 + da.rate / 100, 1/12);
  const { debit, credit, txns: dTxns } = _dealCashflow(d, _startYear, mo, da);
  _itemizedExp += debit;
  inc          += credit;
  dTxns.forEach(t => _txns.push(t));
  const ex = d.exit || {};
  if (ex.type !== 'none' && ex.date) {
    const [ey, em] = ex.date.split('-').map(Number);
    if (_startYear === ey && mo === em && da) da.sold = true;
  }
});
```

**1c.** Restructure **main deals loop** the same way:

```js
// ── Deals (main loop) ──
const _yr = _startYear + (age - sa);
(S.deals || []).filter(d => d.enabled !== false).forEach(d => {
  const da = _dealAssets[d.id];
  // Appreciate first
  if (da && !da.sold && da.cv > 0) da.cv *= Math.pow(1 + da.rate / 100, 1/12);
  const { debit, credit, txns: dTxns } = _dealCashflow(d, _yr, mo, da);
  exp += debit; inc += credit;
  dTxns.forEach(t => _txns.push(t));
  const ex = d.exit || {};
  if (ex.type !== 'none' && ex.date) {
    const [ey, em] = ex.date.split('-').map(Number);
    if (_yr === ey && mo === em && da) da.sold = true;
  }
});
```

**Verify:** `_dealAssets` still used before `_dealCashflow` – no `da` being passed while undefined
(it can be undefined for deals with `exit.type:'none'`, which is fine since the exit block won't fire).

---

## Task 2 — Add `_migrateToDealModel()` to index.html

Add this function just before the closing `</script>` tag (or near toggleDeal).

The function:
1. Snapshots `runSim()` liq values for all simulation output months.
2. Builds 10 deal objects (see Migration Map below).
3. Removes migrated items from S.incomes, S.expenses, S.properties.
4. Runs sim again, compares liq values (must match within $1 at every month).
5. If parity passes: keeps changes, calls `saveActive()` + `lsSave()`, logs "MIGRATION SUCCESS".
6. If parity fails: rolls back (restores original arrays + deals=[]), logs "MIGRATION FAILED" + diff.

### Migration Map

All atAge → year conversion: `year = 2026 + (atAge - 57)`, month = `atMonth || 1`.
Sale: `year = 2026 + (saleAge - 57)`, month = `saleMonth || 6`.
Rent from: `year = 2026 + (rentFromAge - 57)`, month = `rentFromMonth || 1`.

| Deal | capital | returns | exit |
|------|---------|---------|------|
| Canchitas | oneoff $160k '2026-01' | monthly $5k '2027-01'–'2031-12' | none |
| Dorado | none | monthly $5k '2027-01'–'2031-12' | none |
| Arcos | oneoff $50k '2026-01' (obra only) | none | auto '2039-06' basis:600k rate:3 |
| Carhué | oneoff $30k '2026-01' (obra only) | none | auto '2029-06' basis:700k rate:3 |
| Delta | none | monthly $1k '2026-01' untilSale | auto '2100-01' basis:100k rate:3 |
| Luisma | none | none (monthlyRent=0, basis=0 for parity) | auto '2034-06' basis:0 rate:3 |
| Roca S | none | monthly $2k '2026-01' untilSale | auto '2031-06' basis:300k rate:3 |
| Roca L | none | monthly $3k '2026-01' untilSale | auto '2032-06' basis:400k rate:3 |
| Delta 2 | oneoff $50k '2027-01' (obra) | monthly $750 '2026-01' untilSale | auto '2030-06' basis:120k rate:3 |
| New Car | oneoff $70k '2026-01' | none | none (user sets depreciation later) |

**Notes:**
- Properties were already owned at sim start (acquireAge = 57 = startAge) → no purchase debit. Only obra expenses become capital debits.
- Delta: hold=true → use exit.date '2100-01' so it never sells within sim range (age 57-87 = years 2026-2056). Still tracked in iliq via _dealAssets.
- Luisma: value=0 in current data → basis=0, returns.amount=0. Parity is maintained. User updates manually after migration.
- Mocoretá (id:11): stays as property. Not migrated.

**Items removed from arrays:**
- S.incomes: id 3 (Canchitas), id 4 (Dorado)
- S.expenses: id 5 (Canchitas investment), id 6 (Carhué obra), id 7 (Arcos obra), id 8 (New car), id 9 (Delta 2 obra)
- S.properties: id 10 (Arcos), id 12 (Carhué), id 13 (Delta), id 14 (Luisma), id 15 (Roca S), id 16 (Roca L), id 17 (Delta 2)

### Function code

```js
function _migrateToDealModel() {
  // ── 0. Snapshot ──
  const before = runSim();
  const liqBefore = before.monthly.map(m => m.liq);

  // ── 1. Save originals for rollback ──
  const origIncomes    = JSON.parse(JSON.stringify(S.incomes));
  const origExpenses   = JSON.parse(JSON.stringify(S.expenses));
  const origProperties = JSON.parse(JSON.stringify(S.properties));
  const origDeals      = JSON.parse(JSON.stringify(S.deals || []));

  // ── 2. Build deals ──
  const sa = S.startAge || 57;
  const sy = S.startYear || 2026;
  const toYM = (age, mo = 1) => `${sy + (age - sa)}-${String(mo).padStart(2,'0')}`;

  const newDeals = [
    {
      id: 'deal_canchitas', name: 'Canchitas', enabled: true, color: '#f97316',
      capital: { type: 'oneoff', amount: 160000, date: toYM(57, 1) },
      returns: { type: 'monthly', amount: 5000, from: toYM(58, 1), to: toYM(62, 12) },
      exit:    { type: 'none' }
    },
    {
      id: 'deal_dorado', name: 'Dorado', enabled: true, color: '#eab308',
      capital: { type: 'none' },
      returns: { type: 'monthly', amount: 5000, from: toYM(58, 1), to: toYM(62, 12) },
      exit:    { type: 'none' }
    },
    {
      id: 'deal_arcos', name: 'Arcos', enabled: true, color: '#3b82f6',
      capital: { type: 'oneoff', amount: 50000, date: toYM(57, 1) },  // obra only
      returns: { type: 'none' },
      exit:    { type: 'auto', date: toYM(70, 6), basis: 600000, rate: 3, sellingCosts: 0 }
    },
    {
      id: 'deal_carhue', name: 'Carhué', enabled: true, color: '#8b5cf6',
      capital: { type: 'oneoff', amount: 30000, date: toYM(57, 1) },  // obra only
      returns: { type: 'none' },
      exit:    { type: 'auto', date: toYM(60, 6), basis: 700000, rate: 3, sellingCosts: 0 }
    },
    {
      id: 'deal_delta', name: 'Delta', enabled: true, color: '#10b981',
      capital: { type: 'none' },
      returns: { type: 'monthly', amount: 1000, from: toYM(57, 1), untilSale: true },
      exit:    { type: 'auto', date: '2100-01', basis: 100000, rate: 3, sellingCosts: 0 }
    },
    {
      id: 'deal_luisma', name: 'Luisma', enabled: true, color: '#06b6d4',
      capital: { type: 'none' },
      returns: { type: 'none' },    // monthlyRent=0 in current data
      exit:    { type: 'auto', date: toYM(65, 6), basis: 0, rate: 3, sellingCosts: 0 }
    },
    {
      id: 'deal_roca_s', name: 'Roca S', enabled: true, color: '#ec4899',
      capital: { type: 'none' },
      returns: { type: 'monthly', amount: 2000, from: toYM(57, 1), untilSale: true },
      exit:    { type: 'auto', date: toYM(62, 6), basis: 300000, rate: 3, sellingCosts: 0 }
    },
    {
      id: 'deal_roca_l', name: 'Roca L', enabled: true, color: '#f43f5e',
      capital: { type: 'none' },
      returns: { type: 'monthly', amount: 3000, from: toYM(57, 1), untilSale: true },
      exit:    { type: 'auto', date: toYM(63, 6), basis: 400000, rate: 3, sellingCosts: 0 }
    },
    {
      id: 'deal_delta2', name: 'Delta 2', enabled: true, color: '#14b8a6',
      capital: { type: 'oneoff', amount: 50000, date: toYM(58, 1) },  // obra at age 58
      returns: { type: 'monthly', amount: 750, from: toYM(57, 1), untilSale: true },
      exit:    { type: 'auto', date: toYM(61, 6), basis: 120000, rate: 3, sellingCosts: 0 }
    },
    {
      id: 'deal_car', name: 'New Car', enabled: true, color: '#6b7280',
      capital: { type: 'oneoff', amount: 70000, date: toYM(57, 1) },
      returns: { type: 'none' },
      exit:    { type: 'none' }
    }
  ];

  // ── 3. Remove migrated items ──
  const rmInc  = new Set([3, 4]);
  const rmExp  = new Set([5, 6, 7, 8, 9]);
  const rmProp = new Set([10, 12, 13, 14, 15, 16, 17]);

  S.incomes    = S.incomes.filter(x => !rmInc.has(x.id));
  S.expenses   = S.expenses.filter(x => !rmExp.has(x.id));
  S.properties = S.properties.filter(x => !rmProp.has(x.id));
  S.deals      = [...(S.deals || []), ...newDeals];

  // ── 4. Parity check ──
  const after    = runSim();
  const liqAfter = after.monthly.map(m => m.liq);
  const MAX_DIFF = 1;
  const diffs = liqBefore.map((b, i) => Math.abs(b - (liqAfter[i] ?? 0)));
  const maxDiff = Math.max(...diffs);
  const failIdx = diffs.findIndex(d => d > MAX_DIFF);

  if (maxDiff <= MAX_DIFF) {
    // ── 5. Save ──
    saveActive();
    lsSave();
    console.log('%c✅ MIGRATION SUCCESS', 'color:lime;font-weight:bold;font-size:16px');
    console.log(`Max liq diff: $${maxDiff}. Deals added: ${newDeals.length}`);
    console.log('Deals:', S.deals.map(d => d.name));
    go();
  } else {
    // ── 6. Rollback ──
    S.incomes    = origIncomes;
    S.expenses   = origExpenses;
    S.properties = origProperties;
    S.deals      = origDeals;
    console.error('%c❌ MIGRATION FAILED — rolled back', 'color:red;font-weight:bold;font-size:16px');
    const bm = before.monthly[failIdx];
    console.error(`First mismatch at index ${failIdx}: age ${bm?.age} mo ${bm?.mo} — before $${liqBefore[failIdx]} after $${liqAfter[failIdx]} (diff $${diffs[failIdx]})`);
    console.table(
      diffs.map((d,i) => ({ i, age: before.monthly[i]?.age, mo: before.monthly[i]?.mo, before: liqBefore[i], after: liqAfter[i], diff: d }))
           .filter(r => r.diff > 0)
           .slice(0, 20)
    );
  }
}
```

---

## Task 3 — Verify and commit

1. Run `check-futuro` skill.
2. Commit fix + migration function.
3. Open browser, call `_migrateToDealModel()` in console.
4. Verify "MIGRATION SUCCESS" message.
5. Confirm S.deals has 10 items, S.properties has 1 (Mocoretá).
6. Confirm Supabase save happened (check Supabase UI or `await sbLoad()`).
7. Remove `_migrateToDealModel()` from code (or keep for re-run safety — user decides).
8. Final commit.

---

## Risks / Mitigations

| Risk | Mitigation |
|------|-----------|
| Appreciation formula mismatch | Task 1 fix: use da.cv (monthly compounding) in exit block |
| Double-counting if item not removed | `rmInc/rmExp/rmProp` Sets remove all migrated items |
| Luisma basis=0 looks wrong | By design for parity; user updates deal after migration |
| Car has no exit | By design; user adds depreciation rate after migration |
| All 3 scenarios have same data | Migration runs on active scenario; other 2 are identical so same logic applies |

---

## Post-migration manual updates (user does in UI after deals render is built)
- Luisma: set basis=$260k, returns.amount=$X/mo from age 65
- New Car: set exit.rate=-15 (15%/yr depreciation), exit.date
- Review all deal colors and names
