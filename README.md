# Double Agents (working title)

A browser game in the spirit of the classic 1984 Commodore 64 game *Spy vs Spy*.
Two rival spies search an embassy for hidden items, set traps for each other, and race to escape first.

All art, sound and characters in this project are original. The game itself is drawn in code and
its sound effects are synthesised; the front menu's title picture and logo, and both music tracks
(menu and in-game), were made for this project by Steven with Gemini and Suno. Music and effects
volumes are set under Settings on the front menu. No assets from the original game are used. This is a
non-commercial fan project.
The two fonts in `assets/fonts/` are free fonts from Google Fonts, with their licences alongside
(Black Ops One: SIL Open Font License; Special Elite: Apache 2.0).

**Play:** https://featurepiece.github.io/spy-vs-spy/ (once GitHub Pages is switched on, see below)

## What's in this first version

- Player vs computer, split screen: you (Scarlet) on top, the computer (Cobalt) below.
  Each half is a security monitor, as if you're watching the spies on camera; the
  picture drops to static when a spy changes room. On phones only your own half is shown, with touch controls.
- A front menu (arrow keys, Enter, or tap) with the two computer spies playing on the monitors behind it.
  Its title pictures are placeholders until real art arrives: see `docs/ART-SPECS.md`.
- Random embassies of 6, 13 or 20 rooms with 7, 12 or 15 minutes on the clock.
- Four items plus the briefcase. Without the briefcase you can carry only one thing.
- Five traps (bomb, spring, bucket on a door, gun on a door, time bomb), four remedies in wall fixtures.
- Club fights when you meet: quick jab or slow heavy smash. A knockout hides the loser's items in that room.
- The gadget panel: clock, strength, trap buttons, map, items and remedy.
- Bread-crumb arrows under the room show the way back through the last 9 rooms (levels 1 and 2).
- When your trap catches the rival you score and your spy stops to laugh.
- Three computer skill levels.
- Keyboard, gamepad and touch.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move. Walk into a doorway to go through |
| Space / E | Search furniture, or set the trap you're holding |
| 1–5, Q | Pick a trap (again to put it away), Q cycles |
| H | Hide your briefcase or item in nearby furniture |
| J / Z | Jab |
| K / X | Heavy smash |
| M / Tab | Map (−70 points, clock runs 4× faster) |
| N, Esc | Music, pause |

## Which rules come from the original, and which are ours

Facts from the original come from the First Star manual text and C64 footage (see the Embassy
Dossier research page). Everything tagged `[ours]` in `src/tuning.js` is our own choice and
open to tuning. The main ones:

- Setting a trap costs 3 seconds of clock (the original's cost is unknown).
- Trap counts: 2, 3 or 4 of each type per spy by level (the C64 gives a total, not a split).
- A remedy is used up when it saves you.
- Both spies start in the same room (as in the original), with a truce until one leaves.
- Losing a fight costs the same 7 s + 20 s as a trap (the manual says it costs time, not how much).
- The map drains the clock 4× faster (footage shows "several times").
- Your own traps show a small marker in your view only.
- Escape bonus: 500 points plus 5 per second left.
- 50 points to a trap's owner when the rival sets it off (the manual awards points but doesn't say how many).
- The laugh lasts 2.2 s; bread crumbs are switched off on level 3.
- The ending scene: the winner's half becomes an airfield and they fly off, with score and rank,
  while the loser's half goes blank (as in the original). The artwork, timings, rank names and
  score thresholds are ours; the original's rank list isn't known. If nobody escapes, both halves
  show "Out of time".
- All computer opponent behaviour.

## Running it locally

Any static file server works, for example `npm run serve`, then open http://localhost:8123.
Opening `index.html` straight from disk won't work because browsers block ES modules on `file://`.

Tests:

- `npm test` runs rule checks, then plays 30 computer-vs-computer games headless and fails on crashes or games that never end.
- `npm run test:browser` (needs `npm i -D playwright` and the server running) loads the game in
  Chromium on desktop and phone sizes, plays two full games with `?autoplay&speed=8` through the ending and back to the menu, and fails on console errors.

## Switching on GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)**.
The game appears at https://featurepiece.github.io/spy-vs-spy/ a minute or two later.

## Planned

- Online player vs player between two computers, through a small real-time server.
  The game rules already run separately from the screen so a server can run them; see `docs/ARCHITECTURE.md`.
