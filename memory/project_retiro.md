# Futuro — Project Memory

## What this is
Single-file HTML/JS retirement net-worth projector.
- File: `F:\code\futuro\index.html` (~7600 lines)
- GitHub: https://github.com/brainpulp/futuro
- Live: https://brainpulp.github.io/futuro/
- No build step. Edit `index.html` directly, push to `main`, GitHub Pages auto-deploys.

## Global state
- `S` — active scenario: `incomes[]`, `expenses[]`, `deals[]`, `properties[]`, `crises[]`
- `_selfTest()` — 18 assertions; always run before pushing
- `renderAll()` → `renderCurve(); renderInc(); renderExp(); renderProjectBudgets(); renderDeals()`

## UI Structure (as of 2026-06-07, commit 3b47d49)

### Section order (left panel)
Outgoing → Incoming → Deals → Budget (Budget is last)

### Flat lists
- `#all-inc-list` — all income items, flat (no sub-headings). Filters `dealId`-linked items.
- `#all-exp-list` — all expense items, flat (no sub-headings). Filters `dealId`-linked items.

### Deal cards
- Collapsed → `<span class="deal-name-t">` (text display)
- Expanded → `<input class="deal-name-i">` (rename in place)
- Linked incomes/expenses shown inside expanded deal card

### Assets section
- Removed. Standalone properties auto-migrate to Deals in `_applyScenarios()`.

### Expense chart
- Vertical multiplier wheel removed. Horizontal slider only.

## Auto-migrations (in `_applyScenarios`, before `saveActive()`)
1. `S.summerTrip` / `S.winterTrip` → regular annual expenses (`exp_summer`, `exp_winter`)
2. Standalone properties (no `dealId`) → Deal cards (`deal_prop_<id>`)
Both are idempotent (check before creating).

## Key invariants
- Every income/expense linked to a deal has a `dealId` field
- `renderInc()` / `renderExp()` filter out `dealId`-linked items (those render in the deal card)
- `_selfTest()` must pass 18/18 before any push

## Local dev
```
node save-server.js       # port 3001, save scenarios.json + IBKR proxy
npx http-server . -p 8765 # serve app
```

## Deploy
```
git add index.html && git commit -m "..." && git push
```
Always update `CLAUDE.md` and this file after significant changes, then commit both.

## History
- 2026-06-07: UI refactor (commit 3b47d49) — flat lists, budget last, no assets section, deal expand-to-rename, removed vertical exp multiplier wheel
- 2026-05-19: Moved to `F:\code\futuro\` (out of Google Drive — Drive sync corrupts git index)
