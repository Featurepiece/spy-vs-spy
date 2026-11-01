# How the code is put together

No build step and no libraries: plain ES modules that run straight from GitHub Pages.

| File | Job |
| --- | --- |
| `src/tuning.js` | Every feel, timing and scoring number, each tagged `[manual]`, `[seen]` or `[ours]` |
| `src/data.js` | Items, traps, remedies, furniture kinds, door positions |
| `src/embassy.js` | Random embassy: rooms on a grid, doors, furniture, fixtures, hidden items, exit |
| `src/sim.js` | The game rules. Pure: no screen, keyboard or sound |
| `src/ai.js` | The computer spy. Produces the same input frames a player does |
| `src/render.js` | Canvas drawing: security monitors, rooms, spies, effects, gadget panel, map |
| `src/audio.js` | WebAudio sound effects, all synthesised (music tracks are files in `assets/music/`, played from `main.js`) |
| `src/input.js` | Keyboard, gamepad and touch to input frames |
| `src/title.js` | The front menu and its placeholder title art |
| `src/art.js` | Which optional picture files exist (see `docs/ART-SPECS.md`) |
| `src/main.js` | Menus, the attract-mode demo behind the menu, and the fixed-step loop |

## The simulation contract

```
state = createGame({ level, cpuIq, seed })
step(state, [inputForSpy0, inputForSpy1])   // advances 1/60 s
state.events                                 // what happened this step (sounds, effects, messages)
```

An input frame is `{ mx, mz, act, jab, heavy, trap, map }`: a movement direction plus
one-step button presses. All randomness comes from the seeded generator stored in
`state.rng`, so the same seed and the same inputs give the same game.

## Online play

The server is the referee. `server/src/worker.js` is a Cloudflare Worker (free plan) with one
Durable Object per four-letter game code. It imports `src/sim.js` unchanged and runs `step` 60
times a second; the browsers only send input and draw what they're told.

| File | Job |
| --- | --- |
| `server/src/worker.js` | Lobby, the 60 Hz loop, snapshots, dropouts and rejoin |
| `src/online.js` | The browser's connection: sends input, rebuilds a drawable state from snapshots, smooths spy movement |
| `src/lobby.js` | The online menu and briefing room (name, create/join, code and invite link, embassy, screens, Ready) |
| `src/online-config.js` | The server's address. `?server=ws://127.0.0.1:8787` overrides it for testing |

Messages are JSON over one WebSocket:

- Browser to server: `hello {create, name, token}`, `name`, `settings {level, screens}` (creator only),
  `ready {on}`, `in {mx, mz, act, jab, heavy, map, hide, trap}` (only what changed), `rematch`, `leave`, `ping`.
- Server to browser: `welcome {you}`, `lobby {players, settings, phase, countdown}`, `start` (the
  embassy layout, once per match), `snap` (20 a second), `pause`, `resume`, `forfeit`, `error`.

What each player is sent: furniture contents never leave the server except as "an item is in this
furniture" for the map; traps are only sent to whoever set them. With **Rival's monitor off** or
**One big monitor**, the rival (and their events) are only sent while they're in your room.
The creator plays Scarlet and picks the embassy and the screens, which apply to both players.
`token` is a random id kept in the browser, so reopening the invite link after a dropout gets your
spy back; the game waits 60 s for a dropped player, then the other one wins.

Running it locally: `cd server && npm ci && npx wrangler dev`, serve the game, and open it with
`?server=ws://127.0.0.1:8787`. Tests: `server/test/loop-test.mjs` (the loop keeps up with 60 Hz),
`server/test/match-test.mjs` (the protocol), `tests/online-test.mjs` (two browsers play each other).
`.github/workflows/deploy-server.yml` puts the server live when it changes on main, once the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets exist.
