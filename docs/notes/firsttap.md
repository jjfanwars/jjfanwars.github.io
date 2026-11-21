# Firsttap (`firsttap/`)

Product site for Firsttap, the Family Hub's refill engine turned into a product for Australian allied-health clinics (not a game). Renamed from Wellbooked on 21 Nov 2026 ("Well Booked" is a Melbourne NDIS marketing business).

- **Live:** https://firsttap.aiautomationvic.com (Cloudflare Worker `firsttap-site`, custom domain on the aiautomationvic.com zone). GitHub Pages also serves `firsttap/index.html`, but the form only works on the worker.
- **Files:** `firsttap/index.html` (the whole page: hero with an animated diary + iPhone refill loop, how it works, savings calculator, features with Refill core and Plus add-ons, practice software, privacy, pricing, FAQ, early-access form) and `firsttap/worker.js` (serves the page, `POST /api/lead`).
- **Lead form:** `/api/lead` checks origin, size, honeypot `website`, 5 per IP per hour (KV `rl:`), stores `lead:<ts>:<id>` in KV `LEADS` (namespace `firsttap-leads`) and emails via the `LEAD_MAIL` send_email binding. `LEAD_FROM`/`LEAD_TO` are plain-text bindings set in Cloudflare at deploy; never put the addresses in the repo.
- **Deploy:** PUT the script with metadata `main_module: worker.js` and the four bindings (KV id, send_email destination copied from Cloudflare, LEAD_FROM, LEAD_TO); parts `worker.js` (application/javascript+module) and `index.html` (text/plain). Domain via `PUT /accounts/{id}/workers/domains`.
- **Positioning:** Refill (automatic refills, reminders with "can't make it", fees waived on refill, monthly report) at A$129/clinic/month up to 8 practitioners (+$12 each, solo $39); Plus adds the booking finder, inbox, referrals, Ask, booking buttons at A$249 (+$20). Calculator cost uses the same formula. Stats strip cites BMJ Open 2025/2020; "7 of 10" comes from the 21 Nov research table in the plan. Clear rules pick who's offered a slot (not AI). Billing stays in the practice software. Launching with Halaxy and Cliniko. Australian-hosted data.
- **Plan:** `docs/plans/firsttap.md`.
