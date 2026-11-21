# Firsttap: cancellation refill for Australian allied-health clinics

Product plan (not a game). The Family Hub's refill engine (`familyhub/hub-core.js`) turned into a product other clinics can buy. Site: https://firsttap.aiautomationvic.com (`firsttap/`, notes in `docs/notes/firsttap.md`). Status 21 Nov 2026: site live, early-access form taking enquiries, nothing built server-side yet.

## The product
- **Core (Refill):** when a client cancels, text the best-matched waitlist people; the first to tap is booked straight into the practice software (PMS); everyone else gets "it's been filled". Plus reminders with a "can't make it" link (frees slots two days early), late fees waived automatically when the slot is refilled (nobody else was found doing this), and a monthly "income kept" report.
- **Plus (the rest of the Hub, kept secondary):** booking finder, shared inbox with urgent flagging and AI drafts, GP referrals that turn into bookings, Ask, per-practitioner booking buttons.
- **Rules, not AI, choose who gets offered a slot** (fair, explainable, cheap, fits the APP 1.7 automated-decision transparency rules). Claude only drafts text, with names tokenised, via Amazon Bedrock AU (`au.` inference profiles from ap-southeast-2; verify destination regions with GetInferenceProfile).
- **Billing stays in the PMS.** Firsttap never charges clients.

## Market research (21 Nov 2026, sources in the research run)
- **Native PMS waitlists:** Cliniko, Halaxy, Nookal ("upgraded waitlist" coming soon), Splose, Zanda, Coreplus all stop at a list or manual SMS; staff book by hand. Jane (Thrive plan) notifies and the client self-books first-come. Healthengine auto-SMSes but doesn't hold the slot. HotDoc: no waitlist.
- **Third parties:** WaitOnce (Cliniko, mechanics unpublished), DataFlows (Cliniko, doesn't write the booking back), Replete (auto-books, A$390–790/month, AI-agent bundle), Plexara (done-for-you), and many AI receptionists on Cliniko (Aeva, Lyngo, etc.). Global: Luma Health, Mindbody, Zenoti, Clearwave NextUp.
- **Gap:** cheap, focused, auto-book with the slot held, plus fee waiver on refill.
- **Market:** Ahpra 2024/25 registrants: psychology 50,409, physio 47,761, OT 34,423, chiro 6,770, podiatry 6,210, Chinese medicine 4,898, osteo 3,646 (154k total, growing 1–7% a year). Plus ~7.5k dietitians, ~12k practising counsellors (ACA), 6k+ PACFA, 13k+ speech pathologists. Non-attendance 8–10% at two Queensland public physio clinics (BMJ Open 2025); 19.3% first-session non-attendance in Western Sydney mental health (BMJ Open 2020).

## PMS integrations
| PMS | Access | Cancellation signal | Book | Notes |
|---|---|---|---|---|
| Cliniko | Self-serve API key per user, no fee | No webhooks: poll `updated_at` | `POST /individual_appointments`, `available_times` | 200 req/min per user. Biggest allied-health app directory. Best for scale. |
| Halaxy | Clinic buys API add-on (150 credits/month, ~A$22–33) | Webhooks on Appointment update | `Appointment/$book` with `fail-on-double-booking` | Best API; strong with psychologists; the pilot clinic is on it. |
| Splose | Owner applies for a key | Poll realtime feed | Create and cancel | 60 calls/min |
| Nookal | Professional plan and up | None found | Yes | Building its own waitlist automation |
| Coreplus | Vendor approval to go live | None | Yes | 2 req/s |
| Zanda | Read-only beta, closed | – | No | Not buildable yet |

**Order:** Halaxy first (the pilot clinic and psychologists), Cliniko immediately after (scale, self-serve). Then Splose.

## Stack
- **Cloudflare Workers** (already used) for the API, cron polling and SMS webhooks. Worker placement `aws:ap-southeast-2`.
- **Database: Neon Postgres in Sydney (`aws-ap-southeast-2`) through Hyperdrive**, tenants isolated with Postgres row-level security. Neon publishes SOC 2 Type 2 and ISO 27001 reports. Alternative: PlanetScale Postgres Sydney (from US$5, billed inside Cloudflare). Supabase Sydney only if its Auth is wanted (SOC 2 report only on the US$599 Team plan). Not D1 (no Australian jurisdiction, only a best-effort hint).
- **Claim race:** one Postgres transaction per claim (`SELECT … FOR UPDATE` on the offer) plus the PMS double-booking guard.
- **SMS:** Australian provider with a dedicated reply-able number per clinic. Waitlist offers are commercial messages (Spam Act: consent from joining the list, sender identification, working STOP). Reminders are factual "designated" messages. Since 1 July 2026 unregistered alphanumeric sender IDs show as "Unverified", so use numbers or register IDs.
- **Auth:** staff logins per clinic (Neon + a small auth layer, or Cloudflare Access for staff).

## Pricing (on the site)
- Refill A$129/clinic/month up to 8 practitioners, then A$12 each; solo A$39. Plus A$249/clinic/month, then A$20 each. AUD plus GST, 30-day trial, founding clinics lock prices.
- Why per clinic: per-practitioner A$49 would cost more than the PMS itself (Splose A$32, Nookal ~A$35–38, Cliniko from US$45 solo). Stays well under Replete (A$390–790).

## Build order
1. **Confirm API terms:** Halaxy API add-on for third-party commercial use; Cliniko integration rules (User-Agent vendor name/email, ask about rate limits).
2. **Backend v1 (weeks 1–3):** tenants, practitioners, waitlist, offers, claims in Neon; port `slotFreed`/`sendRound`/`claim`/`tick`/`remindTick` from hub-core to the Worker; Halaxy adapter; SMS provider; staff dashboard (reuse `familyhub/src/admin.*`).
3. **Pilot (weeks 4–7):** the Surf Coast Family Hub with one or two practitioners; measure refills and dollars kept.
4. **Cliniko adapter + self-serve onboarding + Stripe (weeks 8–10).**
5. **Sell:** Geelong/Surf Coast clinics, practice-manager groups, Cliniko connected-apps directory.
6. Plus features later, from the Hub code.

## Risks
- PMS builds it natively (Nookal soon; Jane has it) or changes API terms.
- Crowded on Cliniko (WaitOnce, DataFlows, Replete, AI receptionists).
- Spam Act and sender-ID compliance on every clinic's texts.
- Health information: Privacy Act/APPs, Vic HPP 9 (transfers outside Victoria), contracts with each clinic, cyber insurance.
- Names: "Well Booked" (NDIS marketing, Melbourne), Fullbook and NextUp are taken in the space. Firsttap was clean in a quick check; check auDA WHOIS for firsttap.com.au and IP Australia before buying.
