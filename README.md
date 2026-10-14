# Gray Lane 3PL ERP (LaneWMS)

A browser-based prototype of a third-party logistics (3PL) warehouse and ERP system for a Saudi warehouse operator. It covers the whole flow from inbound receipt to tax invoice, with sample data for four clients across Jeddah and Riyadh warehouses.

No build step, no backend and no dependencies: plain HTML, CSS and JavaScript.

## Modules

| Area | What it does |
|---|---|
| Clients & contracts | Clients, per-client rate cards, FEFO/FIFO pick rules, portal users |
| Master data | Items (with variants, unit conversions and opening stock), warehouses, bins, vehicles and drivers, reason codes |
| Orders (OMS) | Outbound orders, CSV-style import, backorders |
| Inbound | ASNs, dock appointments, receiving with GRN variance, putaway tasks |
| Inventory | Pallet (LPN) stock, transfers, cycle counts, stock ledger, batch and expiry |
| Outbound | Allocation (FEFO/FIFO), pick lists, dispatch, delivery notes and POD |
| Returns, VAS, cold chain | RMAs, value-added work orders, temperature zones |
| Labour, space | Task board, productivity, space availability and bookings |
| Transport, shipping | Trip planning with POD, courier booking (simulated AWB) |
| 3PL billing | Automatic service charges, daily storage capture, billing run |
| Finance & ZATCA | Tax invoices (15% VAT), payments, simulated ZATCA clearance, ageing, VAT summary |
| Reports | Stock balance, throughput, client revenue, SLA |

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
npx http-server -p 8765
```

Then open http://localhost:8765.

## Deploy on GitHub Pages

1. Push this repository to GitHub on the `main` branch.
2. In the repository, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` checks the JavaScript and publishes the site on every push to `main`. The address appears on the workflow run, usually `https://<user>.github.io/<repo>/`.

## Data

All records are sample data stored in the browser's `localStorage` (key `lanewms-v1`). Each visitor gets their own copy and nothing is sent to a server. Use **Settings → Data → Reset** to reload fresh sample data.

## Prototype limits

- ZATCA Phase 2 clearance, courier AWBs and temperature sensors are **simulated**. Production needs ZATCA onboarding (CSID), signed UBL XML and the Fatoora API.
- No sign-in or multi-user backend yet.
- Input VAT and cost to serve are not tracked.

## Project structure

```
index.html          App shell
css/styles.css      Styles (light and dark themes)
js/app.js           State, business logic, views and event handling
.github/workflows/  GitHub Pages deployment
```
