# Surf Coast Family Hub (`hub/`, `hub2/`, `hub3/`, `hub4/`)

A website for a family wellbeing hub in Jan Juc (not a game). There are four takes; `hub4/` is the one in progress.

## hub4
- One page: a sticky `#stage` scroll scene (`#scene` is 620vh) that pencils in and then watercolours a sunset at Jan Juc as you scroll, followed by the content sections.
- The scene is built from data in the script:
  - `FILLS` `[d, colour, layer, t0, t1, scribble angle, width, kind]`. Kinds: `glit`; `band` (a 20px stroke clipped to the cliff); `band2` (a fill clipped to the cliff); `trunk`.
  - `LINES` `[d, layer, t0, t1, width, opacity, clip?]`.
  - The times are scroll progress from 0 to 1.
- The owner likes this art style (the cliff on the left, open sea with the sun, the beach with the family, dunes with a fence in front). A full redraw from the beach photos was rejected, so keep the style and only refine.
- Cliffs follow the owner's Jan Juc photos:
  - The face is steep and stepped (`CLIFF`, `LEDGES`), with a shaded side (`SHADE`) and thin layered bands that dip gently (`STRATA`).
  - Scrub caps the top (`bumps`/`band` along `CLIFF_TOP`), with a scrub strip at the base (`BASE`). There are houses and tea-trees (`TREES`) on top.
  - Bird Rock is a flat-topped stack on a rock platform (`ROCK`, `SHELF`).
  - In the distance, flat-topped cliffs run towards Bells (`HEAD`, `HEAD_FACE`).
- No kelp. The opening is a muted dusk gradient on `#stage`, not white paper, and the colours are slightly muted. The phone view is centred on x 880 so the sun stays in frame.

## familyhub/ (booking finder, live booking demo, Hub dashboard)
- Pages for the demo site (familyhub.aiautomationvic.com, served by the Cloudflare Worker `surfcoast-family-hub`; its source is not in this repo). Built from `familyhub/src/` by `familyhub/build.py`: `python3 build.py` writes preview pages (styles and photos load from the demo site, noindex) and `python3 build.py live` writes drop-in copies with relative links to `familyhub/live/`. Edit `src/`, never the built files. The worker serves the `live/` build at /book (replacing the old book page), /manage, /admin and /hub-core.js (deployed 20 Nov 2026 by downloading the worker's modules, patching and re-uploading them with the secrets kept). Redeploy the same way after rebuilding `live/`. That deploy also moved every page to the Halaxy address (16 Princes Tce, Jan Juc VIC 3228), fixed Ellie to $170, added Maddy at $200 to the fees table and calculator, and updated the Medicare footnote to the regular-GP rule. `src/shell.html` is the site's header/footer shell (copied from its book.html).
- `hub-core.js` (shared): practitioner data `P` (`live` = books through the hub, `leave:1` hides someone, demo `days/hours/len`), and a DEMO backend `HUB.api` in localStorage (`scfh-demo-v2`): seeded availability (`baseTaken`), bookings, waitlist, offers, SMS log, activity feed, settings, demo clock skew. Its API shape is what a real Worker + Halaxy API would serve.
- Refill engine: `slotFreed` (skips if under `minNotice`, "ask me first" mode, quiet hours) → `sendRound` texts the top `batch` matching waitlist people (practitioner, weekday, am/pm, oldest first, weekly cap, never the person who cancelled) → `claim` (first tap wins; a waitlist entry with `moveToken` gets their existing booking moved earlier and their old slot is offered on, a refill chain) → `tick` expires rounds and sends the next.
- `book.html`: guided finder (who → need → plan/how → results). Live practitioners show next free times, a "soonest" banner, a booking sheet (auto-picks the Medicare/private/telehealth service, .ics download, manage link, "text me if sooner"), and waitlist sign-up. Others keep link-outs. `manage.html`: move or cancel (late-cancel warning, reasons). `admin.html`: stats, spots being refilled, mock phones with tap-to-claim and Reply YES, "Everyone taps at once" race, skip time, coming-up list with Cancel, activity, waitlist, settings.
- Fees, appointment types (`svc`, Halaxy names so bookings land on the right service) and weekly working times (`sched`, `openFrom` = booked out until) come from each practitioner's public Halaxy page, read 20 Nov 2026. Halaxy has Ellie at $170 (the site says $190) and Maddy at $200. Adi's Preparing for Parenthood couple sessions ($245, or $365 for 90 min) and Adi/Hannah's eating disorder treatment are bookable. Assessment fees are not published anywhere ("ask us for a quote"). Melissa is on maternity leave; Michelle Joseph is online only until early 2027. Art therapy stays (Adi only removed play therapy, sleep and settling, and the music group). The finder shows Lifeline, PANDA and Kids Helpline. Address follows Halaxy (the owner's call): 16 Princes Tce, Jan Juc VIC 3228 (Jan Juc Village); fees follow Halaxy too. Child bookings ask for a parent name and the child's first name.
- Going live needs: Adi's practitioners in one Halaxy practice group with the API subscription, a Worker (webhook for cancellations, slots via `Appointment/$find`, create appointment, SMS provider), AU-hosted storage for the waitlist, and a privacy notice update.

### Dashboard data tools and Ask Claude (20 Nov 2026)
- Waitlist card: search, practitioner filter, click a row for the person panel (details, staff note, offers, texts, remove), CSV export (warns that it holds health info). Records card: tabs for online bookings, refill offers and texts, with export.
- Ask Claude: side panel in the dashboard. It posts `{messages, data}` to `/api/hub/ask` on the worker, which streams plain text back. Source: `familyhub/worker/hub-ask.mjs`, bundled with the Anthropic SDK by esbuild (`npx esbuild hub-ask.mjs --bundle --format=esm --platform=browser --minify --outfile=hub-ask.js`) and uploaded as a module next to the worker's `index.js` (which calls `hubAsk` before the brief handlers). Model `claude-opus-5-5`, effort low, server-side refusal fallbacks on. Uses the worker's existing `ANTHROPIC_API_KEY` secret; per-IP limit of 80 questions a day in the `TEXT` KV; CORS allows the demo site, GitHub Pages and localhost.
- Privacy by design: `api.snapshot()` in hub-core.js swaps every client name for a stable token like `[C1a2b]` and leaves out phones, emails, notes and children's names (phone patterns are scrubbed from activity lines too). The panel swaps tokens back to names on screen, and names typed in a question are tokenised before sending. When live, the worker should build the snapshot server-side the same way.
- Privacy page `privacy.html` (draft for the owner's client to review): APPs + Health Records Act 2001 (Vic), overseas disclosure, retention, access, complaints (OAIC, HCC Vic, Ahpra). Booking and waitlist consent boxes link to it; footer link on the booking pages.

### Ahpra advertising pass (20 Nov 2026)
Edited the demo site copy (in the worker) and booking copy to fit Ahpra's advertising rules (National Law s133 and Board guidelines): removed the "best massage ever" testimonial, "safe and effective", acupuncture claims (natural labour induction, "heal itself", treating anxiety/depression, "food as medicine"), the Myobrace jaw-growth claim, osteopathy "can help ... babies"; replaced "specialises/specialised/Specialist Training/expert" with interest/focus wording; Melinda's title is "Clinical Psychologist" (no "Child Psychologist"); Medicare plan wording now says regular GP. Still to check with the owner's client: that each "Clinical Psychologist" holds the area of practice endorsement on the Ahpra register.

### Booking front end, round 2 (20 Nov 2026)
- **Engine (hub-core.js, store `scfh-demo-v3`):**
  - Reminders: `remindTick` texts every appointment in the next `remindHrs` (48) with confirm (`sfch.au/r/`) and can't-make-it (`sfch.au/x/`) links. Made-up Halaxy clients auto-confirm over a few hours. `api.confirmAppt` and `api.cantMake` handle the links; can't-make-it cancels and refills.
  - Cancellation policy settings: `policyHrs`, `lateFee` (full/half/none), `card` (new/all/off). Late cancels record `b.lateFee`, and the fee is waived when the time is refilled (`o.bid`).
  - Duration-aware refill: `gapLen` (to the next taken slot, 90 min after the day's last slot, cap 120) and `w.len` per waitlister. Too-short matches are logged ("Not offered ... the gap is 60 min").
  - Waitlist check-ins: `freshTick` sends a "still keen?" text (`sfch.au/k/`) after `freshDays`. No reply in `freshGrace` days sets `w.paused`. `api.keep` and `api.unpause`.
  - Recurring bookings: `seriesPlan` (same weekday and time, nearest free time that week if taken), `api.bookSeries` and `api.cancelSeries`.
  - Referrals (`S.referrals`): `api.refer` (online form), `invite` texts a booking link (`sfch.au/b/`, opens `book.html#ref=`), `inviteReferral`, `updateReferral`, `attachPlan`. Plans uploaded at booking create a referral record too.
  - Practitioner prefs `S.pp` (refill auto/ask/off, series on/off) through `api.prefs`.
  - `api.report(days)` combines seeded sample history (`history()`, 4 weeks) with live demo events. `snapshot()` now also sends referrals (no reason, date of birth or file names), reminders and a 4-week summary to Ask Claude.
- **Booking page (book.js):**
  - `#p=<pid>` goes straight to one practitioner. The team and services pages and the "choose someone yourself" grid now link there instead of Halaxy.
  - `#ref=<tok>` opens a referral link, prefilled and limited to the chosen practitioners.
  - `?embed=1` hides the site chrome for the widget.
  - The booking sheet has: meeting type (Hub/video/phone, which sets the Halaxy service), regular sessions (weekly or fortnightly, 4/6/10), the Mental Health Treatment Plan (upload, GP will send, bring it), the cancellation policy and agreement, and a demo card on file for new clients.
  - The done screen has Apple/Google/Outlook/.ics calendar links (all sessions in the .ics), telehealth instructions and plan status.
- **Manage page:** join video, plan upload, the free-cancel deadline, the session list for a series, "can't make it" (this session or the rest of the series), late-fee warning, calendar links, and "text me if earlier".
- **Dashboard:**
  - Header links: Report, Practitioner view, SOP.
  - Phones show the three most recent conversations, and every link in them works.
  - New Reminders card (confirmed, no reply, can't make it; call list).
  - New Referrals inbox (send booking link and pick a practitioner for Psychology Team referrals, resend, plan received, detail drawer with the reason, staff only).
  - Coming up shows reminder, video, series and no-plan tags, with demo clock skip buttons.
  - Settings are grouped and include reminders, policy, card, check-ins, series and referral auto-link. Records gain Referrals and Reminders tabs.
- **New pages (build.py; worker routes added):**
  - `refer.html`: online referral form for GPs. `?staff=1` logs fax and email referrals. The worker's referrals page has a "Send a referral online" card.
  - `report.html`: last 7 days or 4 weeks, with KPIs, a weekly stacked bar chart (refilled #00897B and not refilled #C0663A, both validated), insights, a per-practitioner table, waitlist, referrals and texts. Print and CSV.
  - `practitioner.html`: one practitioner's own week, KPIs, referrals, waitlist, preferences and their website booking button.
  - `sop.html`: front-desk SOP (draft for the owner's client).
  - `widget.js`: `<script src=".../widget.js" data-practitioner="hannah" data-label="Book with Hannah" async>` adds a shadow-DOM button that opens `book.html?embed=1#p=` in an overlay.
- **Privacy page:** adds reminders, referrals and plans, card handled by the payment provider, telehealth, and a "Decisions made automatically" section (APP 1.7, from 10 Dec 2026).
- **Deploy (20 Nov):**
  - The worker had outside edits to the home page scene at 10:43 UTC (`index.html`, cliff and scrub images, `theme.css`), so the deploy was rebuilt on a fresh download of the live modules. Always re-download first.
  - New modules: `hub-refer.html`, `hub-report.html`, `hub-practitioner.html`, `hub-sop.html` and `hub-widget.js.txt`.

### Inbox (20 Nov 2026)
- **Engine (hub-core.js, store `scfh-demo-v4`):**
  - `S.inbox` threads collect texts, emails, voicemail (with transcripts), missed calls and website enquiries. `inbound(d)` matches the sender by phone or email to bookings, waitlist, referrals and (demo) Halaxy clients in the next week (`fakePhone`).
  - `classify` uses keyword rules to set a topic. `RISK` flags safety concerns: the thread is marked urgent and gets an automatic safety reply with 000, Lifeline and PANDA. Apostrophes can be ’ or '.
  - Automatic replies (setting `autoReply` 'admin'): running late with an appointment today (and tells the practitioner), missed-call text, after-hours reply. Nothing else is sent without a person.
  - Group messages: `groupList` (practitioner's day, week, waitlist, one person), `api.bulk(g,text,{cancel})`. The "practitioner unwell" option cancels without refill (`doCancel(...,noRefill)`) and blocks the day (`S.blocked`, slot state 'blocked').
  - Seeded with five threads (`seedInbox`). `api.simulate(kind)` creates demo arrivals.
  - The snapshot sends Ask Claude inbox counts and topics only, never message text.
- **inbox.html / inbox.js / inbox.css:**
  - Two panes (tabs Needs reply, Urgent, Waiting on client, Done, All; search).
  - Each thread shows match chips and an urgent banner (Claude drafting is disabled on urgent threads), then messages and voicemail cards.
  - Actions: call, log a call, cancel their appointment, add to waitlist. Staff note.
  - Composer: text or email, templates with [BOOK_LINK]/[MANAGE_LINK]/[FEES_LINK], "Draft with Claude", SMS segment count, Send or Send and mark done.
  - The "New message" drawer does group sends with a preview.
  - The dashboard has an Inbox card, a nav badge and Inbox settings.
- **Claude drafts:**
  - `POST /api/hub/draft` lives in `worker/hub-ask.mjs` (same bundle as Ask, `hubDraft`). It uses structured output (`output_config.format` json_schema: topic, summary, urgent, reply, staffNote), effort low, 120 a day per IP.
  - The client sends the conversation with the name replaced by [CLIENT] and phones and emails replaced by [phone]/[email], plus public facts: team, usual start times, fees, next free times, policy, and what's known about this client.
  - The prompt treats message text as data (tested against an injection attempt) and never gives clinical advice.
- **Contact page:** `src/enquiry.js` (worker route `/hub-enquiry.js`, plus hub-core on `contact.html`) sends the enquiry form into the inbox instead of opening the visitor's email app.
- **Docs:** the privacy page covers messages kept, Claude's two uses, and urgent flagging. SOP section 17 covers the inbox and group messages.
- **Live needs:** an SMS provider with inbound webhooks and a registered sender ID, an inbound email address, and a phone provider for missed calls and voicemail transcripts (for example forwarding the Hub number). Message storage hosted in Australia.

### Intake forms, payments, and a full test pass (20 Nov 2026)
- **Store and seeding:** store `scfh-demo-v5`. `seedPay` adds four past hub bookings: a paid session with a Medicare claim, a declined card, a late cancel and a no-show (fees to decide).
- **Intake forms:**
  - New clients (`needsIntake`: first visit, referral, or a new person booked from the waitlist) get `b.intake={tok,status}` and a text with `sfch.au/i/<tok>`. The reminder repeats the link until the form is done.
  - `intake.html` (`intake.js`) saves as it goes (`api.saveIntake`). It covers details, a child section (parental responsibility, court orders), emergency contact, GP and sharing, Medicare (check-digit validated) and health fund, card on file, a "before you come" note (practitioner only), telehealth location, consents and a typed signature.
  - The practitioner view reads intakes from "New clients coming up". The dashboard shows intake tags.
- **Payments:**
  - Ledger `S.pay` (kinds deposit, session, late, noshow, refund, medicare; statuses paid, due, failed, refunded, claimed, void). Cards live in `S.cards` by phone; demo cards ending 0002 decline.
  - `billTick` charges the session (less any deposit) when it ends, and lodges the Medicare claim (`REBATE` map).
  - No card or a declined card means a `sfch.au/p/` payment link (`pay.html`, which also shows receipts).
  - Deposit setting: none, $50 or full fee. The deposit is refunded on an on-time cancel and kept towards a late fee.
  - `feesToDecide`, `chargeFee`, `waiveFee`, `markNoShow`, `refund`, `payLink`, `markPaid`, `resendPay`.
  - A refill waives the late fee, and refunds it if it was already charged (a due fee becomes void).
  - The dashboard Payments card covers fees to decide, outstanding and recent payments with refunds, plus a Records "Payments" tab. The practitioner view has "Your payments" and "Recent sessions" with a mark no-show button. The report has a Payments card. The manage page has payments and finished-session views.
- **Storage caps:** `trim()` in `save()` caps offers at 300, threads at 200 (100 messages each) and mail at 200, prunes old cancelled bookings beyond 1500, and recovers if storage is full.
- **Tests (scripts in the scratchpad, not the repo):**
  - Engine fuzz with invariants: no double bookings, `taken` consistent, one live offer per slot, one winner per filled offer, nothing booked into blocked days, no session charged twice, refunds recorded, waived fees not kept. 20+ seeds and a 12,000-op run all came out clean; state stayed at 2.2 MB.
  - Browser sweep of 18 pages at 1280, 768 and 360 wide: page errors, horizontal overflow, axe WCAG A/AA serious and critical issues, script-injection canaries in every name and message field.
  - 21-step end-to-end journeys, live on desktop and phone.
  - Worker endpoint abuse: method, bad JSON, empty, wrong role, evil origin, 450 KB body.
  - Link check of 107 internal links.
- **Bugs found and fixed:**
  - A winner re-tapping their claim link was told "too late".
  - Sick-day cancels left live refill offers claimable into the blocked day.
  - `reschedule` accepted cancelled bookings.
  - A late fee charged and then the time refilled kept both flags.
  - Referral links prefilled the last person's typed details.
  - Past and no-show bookings showed as upcoming on the manage page.
  - Records tabs had invalid ARIA.
  - Scroll areas weren't keyboard focusable.
  - Contrast was under AA in a few places: phone timestamps and links, the risk tag, teal links on tinted panels.
  - Overflow on the practitioner view at 360 wide.
- **Known limits, for when it goes live:**
  - The `/api/hub/*` endpoints accept requests with no Origin (curl), limited only per IP. Live needs staff sign-in.
  - Demo state is per browser, so two tabs can race. Live claims must go through the server transaction plus Halaxy's `fail-on-double-booking`.
