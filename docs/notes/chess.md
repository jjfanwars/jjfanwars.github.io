# jjchess (`chess/index.html`, live at /chess, 26 Nov 2026)

1v1 chess, each player on their own computer. Single file, no build.

- **Network:** reuses the jjfanwars relay `Room` Durable Object (`/room/CODE`, no worker changes). Host creates a 5-letter code (`?host=CODE`), guest joins with `?r=CODE`. Host sends `{c:'meta', open:false}` so chess rooms stay out of the jjfanwars Join list. Host is authoritative: guest sends `{t:'mv'|'resign'|'draw'|'again'|'hi'}`, host replies with the full `{t:'state', moves, hc, res, names, draw}`. Host saves the game in localStorage `jc-g-CODE`, so a host reload resumes. Rematch swaps colours. The first guest to say `hi` takes the seat (`Net.gid`, relay id, saved); other guests only watch (`Net.watch`) and their messages are ignored.
- **Rules:** full legal move gen (castling, en passant, promotion, mate/stalemate, 50-move, threefold, insufficient material). Perft-checked (start pos to depth 4, Kiwipete to depth 3). Results are `{win:'w'|'b'|'', why}` and worded per viewer.
- **View:** `View` keeps one element per piece and slides it with CSS transforms (`sync` animates a move, rebuilds on mismatch). Click-to-move and drag-and-drop (pointer events), legal dots, last move, check glow, captured pieces + material, 4 board themes (`jc-theme`), synth move/capture/check sounds (`Snd`). Pass-and-play mode too.
- **Pieces:** `chess/pieces/*.svg`, cburnett set from Lichess (CC BY-SA 3.0, credited in the footer).
- Test hook `window.__CH`.
