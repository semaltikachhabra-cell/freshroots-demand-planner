# Freshroots Demand Planner

Built for Case 01, Problem 1 (Demand Planning) of Deepa's 90-Day Mandate.

**Outcome:** after this runs, Raghav's forecast no longer takes two days of manual SAP/Excel work and is no longer 3-4 weeks stale. He reviews a ready recommendation list instead, which targets the ₹28-34L/quarter lost to stockouts and overstock. Baseline: 2 working days per monthly cycle.

**What it does:** reads the SAP exports (weekly sales, current inventory, SKU master, calendar), applies Raghav's documented rules to every SKU, and shows a recommendation with its reasoning. Raghav approves, overrides or rejects each line. Approved lines become a draft PO per distributor (CSV).

**What it deliberately does not do (the Cut):** place purchase orders, or decide cases the rules cannot cover. Anything it cannot classify goes to "Needs Raghav": under 12 weeks of history, missing inventory, no sales, or conflicting rules (high demand and overstock at once).

## Rules (Raghav's four, plus perishables)
| Rule | Result |
|---|---|
| Last 4 wks > 20% above 12-wk average | High-demand: reorder at 1.5x standard qty |
| Stock < 6 wks of average weekly sales | Stockout risk: reorder immediately |
| Stock > 14 wks | Overstock risk: pause next order |
| Festival month (Oct, Nov, Mar, from calendar.csv) | +25% demand uplift before the cover checks |
| High-perishability SKU | Window is 3-4 weeks instead of 6-14 |

Interpretation calls (editable in "Rules and data"):
- The 12-week window includes the latest 4 weeks.
- The festival uplift is applied to average weekly demand for the cover checks. The 20% trend test uses actual sales.
- Order of precedence: conflict goes to Raghav, then stockout, then overstock, then high-demand.

## Run
```
node scripts/test.js          # rule tests against the seed data
python3 -m http.server 8000   # then open http://localhost:8000
```
Or open `index.html` directly: data is bundled in `data.js` (rebuild with `node scripts/embed-data.js` after editing `data/*.csv`).

Deploy: static site, no build step. Push to GitHub and import into Vercel.

## Seed data results (as of 2026-10-19, festival month)
Reorder now: SKU011 bread 500, SKU004 almond milk 150, SKU013 peanut butter 120, SKU001 mango drink 750 (1.5x), SKU003 brown rice 300. Pause: SKU006 quinoa (22 wks cover), SKU007 coconut water (4.1 wks, perishable max 4). Other 8 SKUs: no action.

## Not built
- Live SAP/Zoho connection (uses the CSV export the IT team confirmed is possible).
- Detection of the 15-20% judgment cases (new launches, unusual distributor behaviour, one-off events). Raghav handles these through override.
- A shared database: decisions are saved in the browser only.
