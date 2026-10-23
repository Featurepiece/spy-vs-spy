# How the code is put together

No build step and no libraries: plain ES modules that run straight from GitHub Pages.

| File | Job |
| --- | --- |
| `src/tuning.js` | Every feel, timing and scoring number, each tagged `[manual]`, `[seen]` or `[ours]` |
| `src/data.js` | Items, traps, remedies, furniture kinds, door positions |
| `src/embassy.js` | Random embassy: rooms on a grid, doors, furniture, fixtures, hidden items, exit |
| `src/sim.js` | The game rules. Pure: no screen, keyboard or sound |
| `src/ai.js` | The computer spy. Produces the same input frames a player does |
| `src/render.js` | Canvas drawing: rooms, spies, effects, gadget panel, map |
| `src/audio.js` | WebAudio sound effects and music, all synthesised |
| `src/input.js` | Keyboard, gamepad and touch to input frames |
| `src/main.js` | Menus and the fixed-step loop |

## The simulation contract

```
state = createGame({ level, cpuIq, seed })
step(state, [inputForSpy0, inputForSpy1])   // advances 1/60 s
state.events                                 // what happened this step (sounds, effects, messages)
```

An input frame is `{ mx, mz, act, jab, heavy, trap, map }`: a movement direction plus
one-step button presses. All randomness comes from the seeded generator stored in
`state.rng`, so the same seed and the same inputs give the same game.

## Adding online play (next step, not built yet)

The plan is an authoritative server:

1. A small Node server (WebSocket) imports `src/sim.js` unchanged and runs `step` at 60 Hz for each match.
2. Each browser sends its input frames; the server applies them to its spy.
3. The server sends each player a snapshot of their own view at maybe 20 Hz: their spy, their room,
   the rival only when in the same room, their own traps. Hidden things (rival's traps, unsearched
   furniture) never leave the server, so nobody can cheat by reading network traffic.
4. The browser draws the latest snapshot, interpolating spy positions between snapshots, and plays the events.

What needs adding for that: a `viewFor(state, spyIdx)` function that strips hidden information,
a lobby (create a room code, share it with your friend), and a host for the server. The client
code already treats the player's input and the CPU's input the same way, so the CPU brain gets
swapped for "inputs from the network".
