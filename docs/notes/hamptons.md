# Hamptons Cabinetry (client website mockups)

Not a game. Homepage concepts for Hamptons Cabinetry, a cabinet maker in Belmont, Geelong (VIC). Public business details only: email hello@hamptonscabinetry.com.au, Instagram @hamptonscabinetry, Facebook page "Hamptons Cabinetry". Their domain hamptonscabinetry.com.au answered 503 on 20 Nov 2026, so ask before assuming where the real site will be hosted.

## Live
- https://hamptons.aiautomationvic.com/ (index), `/1` Heritage, `/2` Atelier, `/3` Showroom, `/4` Monogram. All `noindex`.
- Served by the Cloudflare Worker `hamptons-mockups` (custom domain on the aiautomationvic.com zone). The Worker embeds every file as a module: Cloudflare's static-assets upload fails through the cloud session's proxy, so don't switch to `[assets]`.
- Design canvas (private, claude.ai artifact): https://claude.ai/artifact/LDX7yiSxTpkNQhGrjmNAju. Its artboards are the same files as `hamptons/src/*.dc.html`.

## Files (`hamptons/`)
- `src/*.dc.html`: one artboard per concept (Main = 1 Heritage, Atelier = 2, Showroom = 3, Monogram = 4); `src/canvas.json` is the canvas index. Images in them point at the canvas's `/_blob/<id>` uploads; `build.py` maps those ids to `assets/` (the `BLOBS` table: add a line when you upload a new image to the canvas).
- `pages/index.html`: the chooser page at `/`.
- `assets/`: photos cropped from the owner's screenshots of the client's Facebook (about 1180 px wide, soft at full width), logo variants made from the client's logo (`mark-cream.png`, `mark-brown.png` = transparent marks, `badge.png` = round badge), and material swatches `sw-*.jpg` cropped from the job photos.
- Deploy: `cd hamptons && python3 build.py && CLOUDFLARE_API_TOKEN=dummy CLOUDFLARE_ACCOUNT_ID=<account> npx wrangler@3 deploy` (the proxy injects the real token). `build/` is ignored.

## Copy rules
- Real facts only. Placeholders: `[PHONE]`, `[ABN]`; Facebook links are `#` until we have the page URL.
- Claims to confirm with the client: they install themselves, they come out to measure up, written quotes, laminate tops, laundries, wine fridge housings.
- The featured-project quote is the client's own Facebook caption.
- No AI-slop lines (researched real cabinet-maker sites: plain, specific, first person). Impeccable rules applied: no kicker labels above headings, no decorative section numbers, themed selection/focus/scrollbars, phone menu is a `<details class="hc-menu">` dropdown (`.hc-links` hide under 760 px).

## Still needed from the client
Full-size photos and the original logo file, phone, ABN, Facebook URL, services list, hosting/domain.
