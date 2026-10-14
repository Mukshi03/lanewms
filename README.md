# Warehouse Management System (LaneWMS)

A browser-based prototype of a third-party logistics (3PL) warehouse and ERP system for a Saudi warehouse operator. It covers the whole flow from inbound receipt to tax invoice. It starts empty: the dashboard's **Get started** checklist walks you through adding a warehouse, bins, a client and items.

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

## Sign-in and administration

Opening the app takes you to `login.html` first. On the first visit four demo accounts are created, one per role, and the sign-in page fills them in with one click.

**Administrators** have full access, and only they can open **Settings**:

- **Settings → Users & access**: create users with their own email and password, change their role, reset passwords, and deactivate or delete accounts. Passwords need at least 8 characters with a letter and a number.
- **Settings → Roles & permissions**: tick which modules and which options inside each module (for example Inbound → ASN, Receiving, GRN) each role can open. Ticking a module ticks all its options. Add custom roles (for example Auditor) starting from an existing role's access.
- **Per-user access**: when creating or editing a user, choose **Same as role** or **Custom access** and tick exactly the modules and options that person can open. Their sidebar, page tabs and dashboard show only what they have been given.
- **Clients & Contracts → Clients**: add, edit and remove clients. A client with stock, open orders, unbilled charges or unpaid invoices cannot be removed until that work is closed. A client with past records is archived (hidden but kept for history and reports, and can be restored). A client with no records is deleted.

Safety checks: an administrator cannot delete or deactivate their own account, and there is always at least one active Administrator. Role changes and deactivations apply to signed-in users straight away. Sessions last 8 hours; with **Keep me signed in** unticked, closing the browser signs you out.

Default role access:

| Role | Modules |
|---|---|
| Administrator | Everything, including Settings |
| Supervisor | All operations and reports; no billing, finance or settings |
| Operator | Inbound, inventory, outbound, returns, VAS, cold chain, labour |
| Finance | Clients, billing, finance and ZATCA, reports |

**This is not security.** The site is static: users, roles and password hashes are saved in each browser's `localStorage`, so users created on one computer do not exist on another, and anyone can read the code. It shows how roles and administration work. For a real team, move sign-in and user storage to a backend, for example Supabase Auth or Firebase Authentication.

## Publishing changes

`index.html` and `login.html` load the CSS and JavaScript with a version number, for example `js/app.js?v=20261014-3`. When you change a CSS or JS file, change that number in both HTML files so browsers fetch the new files instead of using saved copies.

## Data

Records are stored in the browser's `localStorage` (key `lanewms-v2`). Each visitor has their own copy and nothing is sent to a server. Administrators can delete everything with **Settings → Data → Clear all data**; users and roles are kept. Sample records saved by earlier versions are removed automatically.

## Prototype limits

- ZATCA Phase 2 clearance, courier AWBs and temperature sensors are **simulated**. Production needs ZATCA onboarding (CSID), signed UBL XML and the Fatoora API.
- No sign-in or multi-user backend yet.
- Input VAT and cost to serve are not tracked.

## Project structure

```
index.html          App shell
login.html          Sign-in page
css/styles.css      Styles (light and dark themes)
css/login.css       Sign-in page styles
js/auth.js          Users, password hashing, sessions and role access
js/login.js         Sign-in page behaviour
js/app.js           State, business logic, views and event handling
.github/workflows/  GitHub Pages deployment
```
