// Small checks of individual rules. Run with: node tests/rules-test.mjs
import { createGame, step, EMPTY_INPUT, getFocus } from '../src/sim.js';
import { OPPOSITE, SIDES } from '../src/data.js';
import { TUNING } from '../src/tuning.js';

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const run = (state, inputs, ticks = 1) => { for (let i = 0; i < ticks; i++) step(state, inputs); };
const idle = [EMPTY_INPUT, EMPTY_INPUT];

// Hiding the briefcase puts it (and its items) in the furniture, and searching gets them back.
{
  const s = createGame({ seed: 42 });
  const me = s.spies[0];
  const room = s.embassy.rooms[me.room];
  const f = room.furniture.map((id) => s.embassy.furniture[id]).find((x) => !x.fixture);
  me.hasCase = true; me.items = ['key', 'plans'];
  me.x = f.x; me.z = f.z + 0.03;
  check('focus is the furniture', getFocus(s, me)?.id === f.id);
  run(s, [{ ...EMPTY_INPUT, hide: true }, EMPTY_INPUT]);
  run(s, idle, 30);
  check('hiding empties your hands', !me.hasCase && me.items.length === 0);
  check('furniture holds case and items', f.contents.some((c) => c.t === 'case') && f.contents.filter((c) => c.t === 'item').length === 2);
  run(s, [{ ...EMPTY_INPUT, act: true }, EMPTY_INPUT]);
  run(s, idle, 40);
  check('searching takes them back', me.hasCase && me.items.length === 2);
}

// Bread crumbs: going through a door lays one, coming back eats it.
{
  const s = createGame({ seed: 7 });
  const me = s.spies[0];
  const room = s.embassy.rooms[me.room];
  const side = SIDES.find((x) => room.doors[x] !== undefined && !s.embassy.doors[room.doors[x]].exit);
  const walk = { n: [0.5, 0.03, 0, -1], s: [0.5, 0.97, 0, 1], w: [0.04, 0.45, -1, 0], e: [0.96, 0.45, 1, 0] };
  const go = (sd) => { const [x, z, mx, mz] = walk[sd]; me.x = x; me.z = z; me.doorCd = 0; run(s, [{ ...EMPTY_INPUT, mx, mz }, EMPTY_INPUT]); };
  const start = me.room;
  go(side);
  check('a crumb is laid', me.room !== start && me.trail.length === 1 && me.trail[0] === OPPOSITE[side]);
  go(OPPOSITE[side]);
  check('going back eats it', me.room === start && me.trail.length === 0);
}

// The trap's owner scores and laughs when the rival springs it.
{
  const s = createGame({ seed: 3 });
  const [me, cpu] = s.spies;
  const room = s.embassy.rooms[cpu.room];
  const f = room.furniture.map((id) => s.embassy.furniture[id]).find((x) => !x.fixture);
  f.trap = { type: 'bomb', owner: 0 };
  cpu.x = f.x; cpu.z = f.z + 0.03;
  const before = me.score;
  run(s, [EMPTY_INPUT, { ...EMPTY_INPUT, act: true }]);
  run(s, idle, 40);
  check('rival was caught', cpu.state === 'dead');
  check('owner got points', me.score === before + TUNING.score.trapSprung);
  check('owner is laughing', me.laughT > 0);
}

// Swinging in a fight turns you to face the rival.
{
  const s = createGame({ seed: 5 });
  s.truce = false;
  const [me, cpu] = s.spies;
  me.x = 0.5; cpu.x = 0.6; me.z = cpu.z = 0.5; me.face = -1;
  run(s, [{ ...EMPTY_INPUT, jab: true }, EMPTY_INPUT]);
  check('auto-faces the rival', me.face === 1);
}

// Walking up the screen shows the spy's back, walking down his front, sideways his side.
{
  const s = createGame({ seed: 5 });
  const me = s.spies[0];
  me.x = 0.5; me.z = 0.5;
  run(s, [{ ...EMPTY_INPUT, mz: -1 }, EMPTY_INPUT], 5);
  check('walking up shows the back', me.view === 'back');
  run(s, idle, 5);
  check('standing still keeps the view', me.view === 'back');
  run(s, [{ ...EMPTY_INPUT, mz: 1 }, EMPTY_INPUT], 5);
  check('walking down shows the front', me.view === 'front');
  run(s, [{ ...EMPTY_INPUT, mx: 1, mz: 1 }, EMPTY_INPUT], 5);
  check('a diagonal shows the side', me.view === 'side' && me.face === 1);
  run(s, [{ ...EMPTY_INPUT, mz: 1 }, EMPTY_INPUT], 5);
  run(s, [{ ...EMPTY_INPUT, jab: true }, EMPTY_INPUT]);
  check('swinging turns side on', me.view === 'side');
}

process.exit(failed ? 1 : 0);
