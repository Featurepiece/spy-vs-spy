// The game simulation. It has no knowledge of the screen, keyboard or sound:
// it takes one input frame per spy, advances a fixed time step, and records
// events (sounds, effects, messages) for whoever is watching.
//
// Keeping it pure like this is what lets online play be added later: a small
// server can run this same file, feed it both players' inputs, and send each
// player the state of their own spy's view.

import { TUNING } from './tuning.js';
import { ITEMS, TRAPS, TRAP_BY_ID, FIXTURES, DOOR_ANCHOR, DOOR_ARRIVE, DOOR_APERTURE, SIDES, OPPOSITE } from './data.js';
import { generateEmbassy } from './embassy.js';
import { rngPick } from './rng.js';

export const DT = 1 / TUNING.tickRate;
const X_MIN = 0.04, X_MAX = 0.96, Z_MIN = 0.03, Z_MAX = 0.97;

export const EMPTY_INPUT = Object.freeze({ mx: 0, mz: 0, act: false, jab: false, heavy: false, trap: 0, map: false });

export const SPY_NAMES = ['Scarlet', 'Cobalt'];

export function createGame({ level = 0, cpuIq = 1, seed = (Math.random() * 2 ** 31) | 0 } = {}) {
  const cfg = TUNING.levels[level];
  const rng = { seed };
  const embassy = generateEmbassy(rng, cfg);
  const startX = [0.35, 0.65];
  const spies = [0, 1].map((idx) => ({
    idx,
    name: SPY_NAMES[idx],
    room: embassy.startRoom,
    x: startX[idx],
    z: 0.6,
    vx: 0,
    vz: 0,
    face: idx === 0 ? 1 : -1,
    state: 'alive', // alive | dead | out | escaped
    stateT: 0,
    hp: TUNING.combat.maxHp,
    lastHit: -99,
    regenT: 0,
    time: cfg.minutes * 60,
    score: 0,
    hasCase: false,
    items: [],
    remedy: null,
    traps: Object.fromEntries(TRAPS.map((t) => [t.id, t.id === 'timebomb' ? Math.max(1, cfg.trapsEach - 1) : cfg.trapsEach])),
    armed: null,
    action: null,
    stun: 0,
    invuln: 0,
    doorCd: 0,
    mapOpen: false,
    visited: { [embassy.startRoom]: true },
    walk: 0,
    deaths: 0,
    escapeT: 0,
    laughT: 0, // seconds left of gloating after our trap caught the rival
  }));
  return {
    t: 0,
    tick: 0,
    level,
    cpuIq,
    rng,
    seed,
    embassy,
    spies,
    bombs: [],
    events: [],
    hitstop: 0,
    // Both spies start in the same room [seen]. To stop that becoming an instant
    // brawl, there is a truce until one of them leaves the room [ours].
    truce: true,
    over: false,
    winner: null,
  };
}

// ---------- helpers other modules use ----------

export function rivalOf(state, spy) {
  return state.spies[1 - spy.idx];
}

export function inPlay(spy) {
  return spy.state === 'alive' || spy.state === 'dead';
}

// Both spies are alive in the same room: no searching, traps or map [manual].
export function inCombat(state, spy) {
  if (state.truce) return false;
  const r = rivalOf(state, spy);
  return spy.state === 'alive' && r.state === 'alive' && r.room === spy.room;
}

export function hasAllItems(spy) {
  return ITEMS.every((k) => spy.items.includes(k));
}

export function carryingCount(spy) {
  return spy.items.length + (spy.remedy ? 1 : 0);
}

export function inReach(spy, x, z) {
  const dx = (spy.x - x) / TUNING.reach.x;
  const dz = (spy.z - z) / TUNING.reach.z;
  return dx * dx + dz * dz <= 1;
}

// What the spy would use if they pressed the action button now.
export function getFocus(state, spy) {
  const room = state.embassy.rooms[spy.room];
  const armed = spy.armed ? TRAP_BY_ID[spy.armed] : null;
  if (armed && armed.on === 'floor') return { type: 'floor' };
  let best = null, bestD = Infinity;
  const consider = (target, x, z) => {
    if (!inReach(spy, x, z)) return;
    const d = Math.hypot(spy.x - x, (spy.z - z) * 0.6);
    if (d < bestD) { best = target; bestD = d; }
  };
  if (!armed || armed.on === 'furniture') {
    for (const fid of room.furniture) {
      const f = state.embassy.furniture[fid];
      consider({ type: 'furniture', id: fid }, f.x, f.z);
    }
  }
  if (armed && armed.on === 'door') {
    for (const s of SIDES) {
      const d = room.doors[s];
      if (d === undefined) continue;
      const [x, z] = DOOR_ANCHOR[s];
      consider({ type: 'door', id: d, side: s }, x, z);
    }
  }
  return best;
}

function emit(state, type, data = {}) {
  state.events.push({ type, t: state.t, ...data });
}

function msg(state, spy, text) {
  emit(state, 'msg', { spy: spy.idx, text });
}

function addScore(state, spy, pts, label) {
  spy.score += pts;
  emit(state, 'score', { spy: spy.idx, pts, label, room: spy.room, x: spy.x, z: spy.z });
}

// ---------- the step ----------

export function step(state, inputs) {
  state.events.length = 0;
  if (state.over) return state;
  state.tick++;
  if (state.hitstop > 0) {
    state.hitstop -= DT;
    return state;
  }
  state.t += DT;
  const [a, b] = state.spies;

  if (state.truce && state.spies.some((s) => s.room !== state.embassy.startRoom)) state.truce = false;
  for (const spy of state.spies) {
    updateTimers(state, spy);
  }
  for (const spy of state.spies) {
    if (spy.state === 'alive') handleInput(state, spy, inputs[spy.idx] || EMPTY_INPUT);
  }
  for (const spy of state.spies) {
    if (spy.state === 'alive') updateAction(state, spy);
  }
  updateBombs(state);

  // Meeting the rival drops an armed trap back into stock and closes the map [ours, following the manual's no-traps-in-combat rule].
  if (!state.truce && a.state === 'alive' && b.state === 'alive' && a.room === b.room) {
    for (const s of state.spies) {
      if (s.armed) s.armed = null;
      if (s.mapOpen) s.mapOpen = false;
    }
  }

  checkGameOver(state);
  return state;
}

function updateTimers(state, spy) {
  if (spy.state === 'escaped' || spy.state === 'out') return;
  const drain = spy.mapOpen ? TUNING.time.mapDrain : 1;
  const before = spy.time;
  spy.time -= DT * drain;
  const warn = TUNING.time.lowTimeWarn;
  if (spy.time < warn && Math.floor(before) !== Math.floor(spy.time) && spy.time > 0) emit(state, 'lowtime', { spy: spy.idx });
  if (spy.time <= 0) {
    spy.time = 0;
    spy.state = 'out';
    spy.mapOpen = false;
    spy.action = null;
    emit(state, 'timeout', { spy: spy.idx });
    msg(state, spy, 'Out of time! The plane left without you.');
    return;
  }
  if (spy.stun > 0) spy.stun -= DT;
  if (spy.laughT > 0) spy.laughT -= DT;
  if (spy.invuln > 0) spy.invuln -= DT;
  if (spy.doorCd > 0) spy.doorCd -= DT;
  if (spy.state === 'dead') {
    spy.stateT -= DT;
    if (spy.stateT <= 0) {
      spy.state = 'alive';
      spy.hp = TUNING.combat.maxHp;
      spy.invuln = TUNING.combat.respawnInvuln;
      emit(state, 'respawn', { spy: spy.idx });
    }
    return;
  }
  // Strength comes back slowly when not being hit [manual: strength recovers over time].
  if (spy.hp < TUNING.combat.maxHp && state.t - spy.lastHit > TUNING.combat.regenEvery) {
    spy.regenT += DT;
    if (spy.regenT >= TUNING.combat.regenEvery) {
      spy.regenT = 0;
      spy.hp++;
    }
  } else spy.regenT = 0;
}

function handleInput(state, spy, inp) {
  // Laughing at the rival: the spy stands still until the laugh is over [Steven's memory of the original].
  if (spy.laughT > 0 && !spy.action) {
    spy.vx = spy.vz = 0;
    return;
  }
  const combat = inCombat(state, spy);
  const busy = spy.action || spy.stun > 0;

  // Trapulator: pick a trap (1-5), or the same one again to put it away.
  if (inp.trap && !busy) {
    const trap = TRAPS[inp.trap - 1];
    if (combat) {
      emit(state, 'denied', { spy: spy.idx });
      msg(state, spy, 'No traps while your rival is here!');
    } else if (spy.armed === trap.id) {
      spy.armed = null;
      emit(state, 'ui', { spy: spy.idx });
    } else if (spy.traps[trap.id] <= 0) {
      emit(state, 'denied', { spy: spy.idx });
      msg(state, spy, `No ${trap.name.toLowerCase()}s left`);
    } else {
      spy.armed = trap.id;
      spy.mapOpen = false;
      emit(state, 'ui', { spy: spy.idx });
      msg(state, spy, trap.on === 'door' ? `${trap.name}: set it on a door` : trap.on === 'floor' ? 'Time bomb: drop it anywhere' : `${trap.name}: set it on furniture`);
    }
  }

  if (inp.map && !busy) {
    if (spy.mapOpen) spy.mapOpen = false;
    else if (combat) {
      emit(state, 'denied', { spy: spy.idx });
    } else {
      spy.mapOpen = true;
      spy.armed = null;
      addScore(state, spy, TUNING.score.openMap, 'MAP');
      emit(state, 'map', { spy: spy.idx });
    }
  }

  if (spy.mapOpen) {
    if (inp.act) spy.mapOpen = false;
    spy.vx = spy.vz = 0;
    return;
  }

  if (!busy && (inp.jab || inp.heavy)) {
    spy.action = { kind: inp.heavy ? 'heavy' : 'jab', t: 0, hitDone: false };
    emit(state, 'swing', { spy: spy.idx, heavy: !!inp.heavy });
  } else if (!busy && inp.act) {
    doAction(state, spy, combat);
  }

  move(state, spy, inp);
}

function doAction(state, spy, combat) {
  if (combat) {
    emit(state, 'denied', { spy: spy.idx });
    msg(state, spy, 'Not now, fight or run!');
    return;
  }
  const focus = getFocus(state, spy);
  if (spy.armed) {
    const trap = TRAP_BY_ID[spy.armed];
    if (!focus) {
      emit(state, 'denied', { spy: spy.idx });
      msg(state, spy, trap.on === 'door' ? 'Stand in a doorway to set it' : 'Stand next to furniture to set it');
      return;
    }
    if (focus.type === 'door' && state.embassy.doors[focus.id].trap) {
      msg(state, spy, 'That door is already rigged');
      emit(state, 'denied', { spy: spy.idx });
      return;
    }
    if (focus.type === 'furniture' && state.embassy.furniture[focus.id].trap) {
      msg(state, spy, 'Something is already rigged here');
      emit(state, 'denied', { spy: spy.idx });
      return;
    }
    spy.action = { kind: 'set', t: 0, target: focus, trap: trap.id };
    return;
  }
  if (focus && focus.type === 'furniture') {
    spy.action = { kind: 'search', t: 0, fid: focus.id };
    emit(state, 'search', { spy: spy.idx });
  }
}

function move(state, spy, inp) {
  const m = TUNING.move;
  let mx = inp.mx, mz = inp.mz;
  const slow = spy.action ? (spy.action.kind === 'jab' || spy.action.kind === 'heavy' ? 0.25 : 0) : 1;
  if (spy.stun > 0) { mx = 0; mz = 0; }
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const tx = mx * m.speedX * slow, tz = mz * m.speedZ * slow;
  const kx = (Math.abs(tx) > Math.abs(spy.vx) ? m.accel : m.decel) * DT;
  const kz = (Math.abs(tz) > Math.abs(spy.vz) ? m.accel : m.decel) * DT;
  spy.vx += (tx - spy.vx) * Math.min(1, kx);
  spy.vz += (tz - spy.vz) * Math.min(1, kz);
  if (mx !== 0 && !(spy.action && spy.action.kind !== 'set' && spy.action.kind !== 'search')) spy.face = mx > 0 ? 1 : -1;
  spy.x += spy.vx * DT;
  spy.z += spy.vz * DT;
  if (Math.abs(spy.vx) + Math.abs(spy.vz) > 0.02) spy.walk += DT * 9;

  // Doors: walk into an open doorway to go through.
  if (spy.doorCd <= 0 && spy.stun <= 0) {
    const room = state.embassy.rooms[spy.room];
    for (const s of SIDES) {
      const d = room.doors[s];
      if (d === undefined) continue;
      const ap = DOOR_APERTURE[s];
      const through =
        (s === 'n' && spy.z <= Z_MIN && mz < -0.3 && Math.abs(spy.x - 0.5) < ap) ||
        (s === 's' && spy.z >= Z_MAX && mz > 0.3 && Math.abs(spy.x - 0.5) < ap) ||
        (s === 'w' && spy.x <= X_MIN && mx < -0.3 && Math.abs(spy.z - 0.45) < ap) ||
        (s === 'e' && spy.x >= X_MAX && mx > 0.3 && Math.abs(spy.z - 0.45) < ap);
      if (through) {
        passDoor(state, spy, state.embassy.doors[d], s);
        return;
      }
    }
  }
  clampToRoom(spy);
}

function clampToRoom(spy) {
  spy.x = Math.min(X_MAX, Math.max(X_MIN, spy.x));
  spy.z = Math.min(Z_MAX, Math.max(Z_MIN, spy.z));
}

function passDoor(state, spy, door, side) {
  spy.doorCd = TUNING.move.doorCooldown;
  if (door.trap) {
    const trap = TRAP_BY_ID[door.trap.type];
    if (spy.remedy && spy.remedy === trap.remedy) {
      defuse(state, spy, door.trap, { door: door.id });
      door.trap = null;
    } else {
      const t = door.trap;
      door.trap = null;
      clampToRoom(spy);
      springTrap(state, spy, t, { door: door.id, side });
      return;
    }
  }
  if (door.exit) {
    if (hasAllItems(spy)) {
      spy.state = 'escaped';
      spy.escapeT = state.t;
      const bonus = TUNING.score.escapeBonus + Math.floor(spy.time) * TUNING.score.perSecondLeft;
      addScore(state, spy, bonus, 'ESCAPED');
      emit(state, 'escape', { spy: spy.idx });
      msg(state, spy, 'Off to the airport!');
    } else {
      // The airport guard boots you back in [manual].
      addScore(state, spy, TUNING.score.trapped, 'BOOT');
      const [ax, az] = DOOR_ARRIVE[side];
      spy.x = ax; spy.z = az;
      spy.vx = side === 'w' ? TUNING.guard.knock : side === 'e' ? -TUNING.guard.knock : 0;
      spy.vz = side === 'n' ? TUNING.guard.knock : side === 's' ? -TUNING.guard.knock * 2 : 0;
      spy.stun = TUNING.guard.stun;
      emit(state, 'guard', { spy: spy.idx, room: spy.room, side });
      msg(state, spy, `The guard wants all four items (${spy.items.length}/4)`);
    }
    return;
  }
  const other = door.rooms[0] === spy.room ? door.rooms[1] : door.rooms[0];
  const arriveSide = OPPOSITE[side];
  spy.room = other;
  [spy.x, spy.z] = DOOR_ARRIVE[arriveSide];
  spy.visited[other] = true;
  emit(state, 'door', { spy: spy.idx, room: other });
  const rival = rivalOf(state, spy);
  if (rival.state === 'alive' && rival.room === other) emit(state, 'meet', { spy: spy.idx, room: other });
}

function defuse(state, spy, trap, where) {
  spy.remedy = null; // a remedy is used up when it saves you [ours]
  addScore(state, spy, TUNING.score.defuse, 'DEFUSED');
  emit(state, 'defuse', { spy: spy.idx, trap: trap.type, ...where });
  msg(state, spy, `Phew! Defused a ${TRAP_BY_ID[trap.type].name.toLowerCase()}`);
}

function springTrap(state, spy, trap, where) {
  emit(state, 'trap', { spy: spy.idx, trap: trap.type, owner: trap.owner, room: spy.room, x: spy.x, z: spy.z, ...where });
  const own = trap.owner === spy.idx;
  kill(state, spy, own ? 'Caught by your own trap!' : `Caught by a ${TRAP_BY_ID[trap.type].name.toLowerCase()}!`);
  addScore(state, spy, TUNING.score.trapped, 'TRAPPED');
  if (!own) gloat(state, state.spies[trap.owner]);
}

// The trap's owner has a good laugh at the rival's expense.
function gloat(state, owner) {
  if (owner.state !== 'alive') return;
  owner.laughT = TUNING.laughTime;
  emit(state, 'laugh', { spy: owner.idx, room: owner.room });
}

function kill(state, spy, text) {
  spy.state = 'dead';
  spy.stateT = TUNING.time.deathDown;
  spy.time = Math.max(0.01, spy.time - TUNING.time.deathPenalty);
  spy.action = null;
  spy.mapOpen = false;
  if (spy.armed) spy.armed = null;
  spy.vx = spy.vz = 0;
  spy.laughT = 0;
  spy.deaths++;
  emit(state, 'death', { spy: spy.idx, room: spy.room, x: spy.x, z: spy.z });
  msg(state, spy, text);
}

function updateAction(state, spy) {
  const act = spy.action;
  if (!act) return;
  act.t += DT;
  const c = TUNING.combat;
  if (act.kind === 'search') {
    if (act.t >= TUNING.searchTime) {
      spy.action = null;
      searchFurniture(state, spy, state.embassy.furniture[act.fid]);
    }
  } else if (act.kind === 'set') {
    if (act.t >= 0.35) {
      spy.action = null;
      setTrap(state, spy, act.trap, act.target);
    }
  } else {
    const mv = c[act.kind];
    if (!act.hitDone && act.t >= mv.startup && act.t < mv.startup + mv.active) tryHit(state, spy, act, mv);
    if (act.t >= mv.startup + mv.active + mv.recovery) spy.action = null;
  }
}

function tryHit(state, spy, act, mv) {
  const r = rivalOf(state, spy);
  if (state.truce || r.state !== 'alive' || r.room !== spy.room || r.invuln > 0) return;
  const dx = r.x - spy.x;
  if (Math.abs(dx) > mv.range || Math.abs(r.z - spy.z) > TUNING.combat.reachZ) return;
  if (dx * spy.face < -0.02) return; // rival is behind
  act.hitDone = true;
  r.hp -= mv.dmg;
  r.lastHit = state.t;
  r.stun = TUNING.combat.hitstun;
  r.action = null;
  r.vx = spy.face * mv.knock * 4;
  state.hitstop = mv.hitstop;
  emit(state, 'hit', { spy: r.idx, by: spy.idx, heavy: act.kind === 'heavy', room: r.room, x: r.x, z: r.z });
  if (r.hp <= 0) knockout(state, r, spy);
}

function knockout(state, loser, winner) {
  addScore(state, winner, TUNING.score.winFight, 'KNOCKOUT');
  addScore(state, loser, TUNING.score.loseFight, 'KO');
  // Loser's remedy and armed trap are lost; items and briefcase get hidden in the room [manual].
  const room = state.embassy.rooms[loser.room];
  const spots = room.furniture.map((id) => state.embassy.furniture[id]).filter((f) => !f.fixture);
  const drop = (thing) => rngPick(state.rng, spots).contents.push({ ...thing, lastHolder: loser.idx });
  if (spots.length) {
    for (const k of loser.items) drop({ t: 'item', k });
    if (loser.hasCase) drop({ t: 'case' });
    loser.items = [];
    loser.hasCase = false;
  }
  loser.remedy = null;
  emit(state, 'ko', { spy: loser.idx, by: winner.idx });
  kill(state, loser, 'Knocked out! Your things are hidden somewhere in this room.');
  msg(state, winner, 'Knockout! Search the room for their loot.');
}

function setTrap(state, spy, trapId, target) {
  const trap = TRAP_BY_ID[trapId];
  if (spy.traps[trapId] <= 0) return;
  const t = { type: trapId, owner: spy.idx };
  if (trap.on === 'floor') {
    state.bombs.push({ room: spy.room, x: spy.x, z: spy.z, fuse: TUNING.time.timeBombFuse, owner: spy.idx });
  } else if (target.type === 'door') {
    const door = state.embassy.doors[target.id];
    if (door.trap) return;
    door.trap = t;
  } else {
    const f = state.embassy.furniture[target.id];
    if (f.trap) return;
    f.trap = t;
  }
  spy.traps[trapId]--;
  spy.armed = null;
  spy.time = Math.max(0.01, spy.time - TUNING.time.trapSetCost);
  addScore(state, spy, TUNING.score.setTrap, 'TRAP SET');
  emit(state, 'trapset', { spy: spy.idx, trap: trapId });
}

function searchFurniture(state, spy, f) {
  if (f.trap) {
    const trap = TRAP_BY_ID[f.trap.type];
    if (spy.remedy && spy.remedy === trap.remedy) {
      defuse(state, spy, f.trap, { furniture: f.id });
      f.trap = null;
    } else {
      const t = f.trap;
      f.trap = null;
      springTrap(state, spy, t, { furniture: f.id });
      return;
    }
  }
  if (f.fixture) {
    const remedy = FIXTURES[f.fixture].remedy;
    if (spy.remedy === remedy) {
      msg(state, spy, 'You already have one of these');
    } else if (!spy.hasCase && spy.items.length > 0) {
      msg(state, spy, 'Hands full! Find the briefcase');
      emit(state, 'denied', { spy: spy.idx });
    } else {
      spy.remedy = remedy;
      emit(state, 'pickup', { spy: spy.idx, kind: 'remedy', k: remedy, room: spy.room, x: f.x, z: f.z });
      msg(state, spy, `Took the ${remedyName(remedy)}`);
    }
    return;
  }
  if (!f.contents.length) {
    emit(state, 'empty', { spy: spy.idx });
    msg(state, spy, 'Nothing here');
    return;
  }
  const rivalIdx = 1 - spy.idx;
  let stole = false;
  const took = [];
  const caseIdx = f.contents.findIndex((c) => c.t === 'case');
  if (caseIdx >= 0 && !spy.hasCase) {
    const [c] = f.contents.splice(caseIdx, 1);
    spy.hasCase = true;
    took.push('the briefcase');
    if (c.lastHolder === rivalIdx) stole = true;
  }
  if (spy.hasCase) {
    for (const c of f.contents.filter((c) => c.t === 'item')) {
      spy.items.push(c.k);
      took.push(`the ${c.k}`);
      if (c.lastHolder === rivalIdx) stole = true;
    }
    f.contents = f.contents.filter((c) => c.t !== 'item');
  } else {
    // Without the briefcase you can carry one thing. Finding another swaps it [manual: one at a time].
    const i = f.contents.findIndex((c) => c.t === 'item');
    if (i >= 0) {
      const [c] = f.contents.splice(i, 1);
      if (spy.items.length) {
        const old = spy.items.pop();
        f.contents.push({ t: 'item', k: old, lastHolder: spy.idx });
        msg(state, spy, `Swapped your ${old} for the ${c.k}`);
      } else if (spy.remedy) {
        msg(state, spy, `Dropped the ${remedyName(spy.remedy)} to take the ${c.k}`);
        spy.remedy = null;
      }
      spy.items.push(c.k);
      took.push(`the ${c.k}`);
      if (c.lastHolder === rivalIdx) stole = true;
    }
  }
  if (took.length) {
    emit(state, 'pickup', { spy: spy.idx, kind: 'item', room: spy.room, x: f.x, z: f.z });
    msg(state, spy, `Found ${took.join(' and ')}!`);
    if (stole) addScore(state, spy, TUNING.score.stealItem, 'STOLEN');
    if (hasAllItems(spy)) msg(state, spy, 'All four! Get to the exit!');
  }
}

export function remedyName(k) {
  return { water: 'water bucket', cutters: 'wire cutters', umbrella: 'umbrella', scissors: 'scissors' }[k];
}

function updateBombs(state) {
  for (const b of state.bombs) {
    const before = Math.ceil(b.fuse);
    b.fuse -= DT;
    if (Math.ceil(b.fuse) !== before && b.fuse > 0) emit(state, 'tick', { room: b.room, left: Math.ceil(b.fuse) });
    if (b.fuse <= 0) {
      emit(state, 'explode', { room: b.room, x: b.x, z: b.z });
      for (const spy of state.spies) {
        if (spy.state === 'alive' && spy.room === b.room) {
          kill(state, spy, b.owner === spy.idx ? 'Blown up by your own time bomb!' : 'Blown up by a time bomb!');
          addScore(state, spy, TUNING.score.trapped, 'BOOM');
          if (b.owner !== spy.idx) gloat(state, state.spies[b.owner]);
        }
      }
    }
  }
  state.bombs = state.bombs.filter((b) => b.fuse > 0);
}

function checkGameOver(state) {
  const escaped = state.spies.find((s) => s.state === 'escaped');
  if (escaped) {
    state.over = true;
    state.winner = escaped.idx;
  } else if (state.spies.every((s) => s.state === 'out')) {
    state.over = true;
    state.winner = null;
  }
  if (state.over) emit(state, 'gameover', { winner: state.winner });
}
