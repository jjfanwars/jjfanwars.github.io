# Wellbooked (`wellbooked/`)

Product site for Wellbooked, the Family Hub's refill engine turned into a product for Australian allied-health clinics (not a game). Working name; rename with a find-and-replace.

- **Live:** https://wellbooked.aiautomationvic.com (Cloudflare Worker `wellbooked-site`, custom domain on the aiautomationvic.com zone). GitHub Pages also serves `wellbooked/index.html`, but the form only works on the worker.
- **Files:** `wellbooked/index.html` (the whole page: hero with an animated diary + iPhone refill loop, how it works, savings calculator, features with Refill core and Plus add-ons, practice software, privacy, pricing, FAQ, early-access form) and `wellbooked/worker.js` (serves the page, `POST /api/lead`).
- **Lead form:** `/api/lead` checks origin, size, honeypot `website`, 5 per IP per hour (KV `rl:`), stores `lead:<ts>:<id>` in KV `LEADS` (namespace `wellbooked-leads`) and emails via the `LEAD_MAIL` send_email binding. `LEAD_FROM`/`LEAD_TO` are plain-text bindings set in Cloudflare at deploy; never put the addresses in the repo.
- **Deploy:** PUT the script with metadata `main_module: worker.js` and the four bindings (KV id, send_email destination copied from Cloudflare, LEAD_FROM, LEAD_TO); parts `worker.js` (application/javascript+module) and `index.html` (text/plain). Domain via `PUT /accounts/{id}/workers/domains`.
- **Positioning:** Refill (automatic refills, reminders with "can't make it", fair cancellation fees, monthly report) at $49/practitioner/month; Plus adds the booking finder, inbox, referrals, Ask, booking buttons at $79. Clear rules pick who's offered a slot (not AI). Billing stays in the practice software. Halaxy first, Cliniko next. Australian-hosted data.
- **Plan:** `docs/plans/wellbooked.md`.
