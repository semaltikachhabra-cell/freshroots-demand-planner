# Components Map: Freshroots Demand Planner

Structure: Trigger → Input → Context → Processing → AI → Output.

| Stage | What it is here | Where it lives |
|---|---|---|
| **1. Trigger** | Raghav opens the planner at the start of each cycle (today monthly, designed to run weekly). The cycle starts when the SAP export arrives. He uploads new CSVs, or uses the ones already saved. There is no automatic schedule yet. | Browser, "Data files" card |
| **2. Input** | Four SAP-style exports: weekly sales per SKU (`weekly_sales.csv`), current stock per SKU (`current_inventory.csv`), the SKU master (perishability, standard reorder qty, distributor) and the distributor master. Plus the festival calendar (`calendar.csv`). | Seed CSVs in `data/`; uploads saved in Supabase `datasets` |
| **3. Context** | Raghav's documented rules, held as settings: high-demand if the last 4 weeks are more than 20% above the 12-week average (reorder 1.5×); stockout risk under 6 weeks of cover (reorder now); overstock over 14 weeks (pause); festival months Oct, Nov, Mar get +25% demand; perishable SKUs use a 3-4 week window. Plus the standard reorder quantity per SKU. | `engine.js` defaults, editable in "Rules and data" |
| **4. Processing** | For each of the 15 SKUs: take the 12-week average and the last-4-week average, apply the festival uplift, compute weeks of cover, run the checks, choose the action (reorder now / reorder / pause / no action) and the quantity. Rule conflicts and thin data are routed to "Needs Raghav" instead of guessed. | `engine.js` (`analyse`), tested by `scripts/test.js` |
| **5. AI** | **None, by design.** Raghav's logic is deterministic and covers 80-85% of decisions, so rules give the same answer every time and can be audited. An LLM would add cost and variance without adding accuracy. A possible future use is plain-language explanations of flagged SKUs, never the decision itself. | n/a |
| **6. Output** | A ranked recommendation list with a "Why?" explanation per SKU; Raghav's approve / override / reject choice per line; draft purchase orders grouped by distributor (CSV export); a decision audit trail and run history. | Browser UI; Supabase `decisions`, `decision_log`, `runs` |

## Where the human is
- **Automated:** pulling the numbers together, applying the rules, ranking, drafting the order lines.
- **Human (Raghav):** reviewing every action, handling the 15-20% judgment cases (new launches, unusual distributor behaviour, one-off events), approving or overriding quantities.
- **Human (procurement):** entering the approved draft into Zoho Inventory. The tool never places an order, so accountability stays with a person.

## Flow
```
Raghav / SAP export (CSV)
        │  upload
        ▼
 Supabase: datasets ──────────┐
                              ▼
 Rules (Raghav's logic) ──► Rules engine (engine.js, in the browser)
                              │
                              ▼
              Recommendations + "Why?" + exceptions
                              │
                  Raghav: approve / override / reject
                              │
          ┌───────────────────┼─────────────────────┐
          ▼                   ▼                     ▼
 Supabase: decisions    decision_log (audit)   Draft PO CSV by distributor
                                                      │
                                       Procurement enters in Zoho (human)
```

## Platform
- **Front end:** static HTML/JS on Vercel (https://freshroots-demand-planner-tau.vercel.app), auto-deployed from GitHub.
- **Database:** Supabase Postgres, project `freshroots-demand-planner` (ap-south-1), row-level security on.
- **Code:** https://github.com/semaltikachhabra-cell/freshroots-demand-planner

## Open gaps
- No login: anyone with the URL can read and write datasets and decisions.
- No live SAP or Zoho connection; the SAP step is a CSV export.
- The weekly trigger is manual.
