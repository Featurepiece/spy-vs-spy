// The computer-controlled spy. It produces the same input frames a player
// would, and only uses what it could fairly know: what it has seen while
// searching, its own traps, and the visible exit. It never peeks at the
// player's traps or at furniture it hasn't searched.
//
// All of this behaviour is our own design; no source we found describes how
// the original's computer opponent thinks.

import { TUNING } from './tuning.js';
import { TRAPS, FIXTURES, DOOR_ANCHOR, SIDES } from './data.js';
import { roomDistances } from './embassy.js';
import { EMPTY_INPUT, DT, getFocus, inCombat, hasAllItems, rivalOf, inReach } from './sim.js';

const DOOR_APPROACH = { n: [0.5, 0.1], s: [0.5, 0.9], w: [0.1, 0.45], e: [0.9, 0.45] };
const DOOR_BEYOND = { n: [0.5, -0.2], s: [0.5, 1.2], w: [-0.2, 0.45], e: [1.2, 0.45] };

export class CpuBrain {
  constructor(idx, iq, seed = 12345) {
    this.idx = idx;
    this.p = TUNING.cpu[iq];
    this.seed = seed;
    this.known = {}; // furniture id -> array of contents as last seen
    this.goal = null;
    this.pending = []; // queued input frames (for multi-step actions like setting a trap)
    this.pause = 0;
    this.attackCd = 0;
    this.fightPlan = null; // 'fight' | 'flee', decided when the spies meet
    this.lastRoom = null;
    this.lastAction = null;
    this.hitBy = {}; // trap types that have caught us
    this.remedyDecided = {};
    this.stuckT = 0;
    this.lastPos = [0, 0];
    this.lootRoom = null;
    this.wasAlive = true;
    this.huntT = 0;
    this.fightT = 0;
  }

  rand() {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Called with the events of each step so the brain can learn from them.
  observe(state, events) {
    for (const e of events) {
      if (e.type === 'trap' && e.spy === this.idx) this.hitBy[e.trap] = (this.hitBy[e.trap] || 0) + 1;
      if (e.type === 'ko') {
        // Loot is hidden somewhere in that room: forget what we knew about it.
        const room = state.embassy.rooms[state.spies[e.spy].room];
        for (const fid of room.furniture) delete this.known[fid];
        this.lootRoom = room.id;
      }
      if (e.type === 'door' && e.spy === this.idx) this.onEnterRoom(state);
    }
  }

  think(state) {
    const me = state.spies[this.idx];
    if (me.state !== 'alive') {
      this.goal = null;
      this.pending.length = 0;
      this.wasAlive = false;
      return EMPTY_INPUT;
    }
    if (!this.wasAlive) {
      this.wasAlive = true;
      this.pause = 0.3;
    }

    // Finished a search: remember what is left inside.
    if (this.lastAction && this.lastAction.kind === 'search' && !me.action) this.onSearchDone(state, me, this.lastAction.fid);
    this.lastAction = me.action ? { ...me.action } : null;

    if (this.pending.length) return this.pending.shift();
    if (me.mapOpen) return { ...EMPTY_INPUT, map: true };
    if (me.action || me.stun > 0) return EMPTY_INPUT;

    if (inCombat(state, me)) return this.fight(state, me);
    this.fightPlan = null;

    if (this.pause > 0) {
      this.pause -= DT;
      return EMPTY_INPUT;
    }

    // A ticking bomb in the room: get out.
    if (state.bombs.some((b) => b.room === me.room)) return this.leaveRoom(state, me);

    if (hasAllItems(me)) return this.goToExit(state, me);

    const remedy = this.maybeRemedy(state, me);
    if (remedy) return remedy;

    if ((!this.goal || !this.goalValid(state)) && !(this.huntT > 0)) this.goal = this.chooseGoal(state, me);
    if (!this.goal && this.huntT > 0) {
      // Searched everywhere: the rival must have what we need, so go and take it [ours].
      this.huntT -= DT;
      const rival = rivalOf(state, me);
      if (rival.state === 'alive' && rival.room !== me.room) return this.travel(state, me, rival.room);
    }
    if (!this.goal) return this.wander(me);

    const f = state.embassy.furniture[this.goal.fid];
    if (f.room !== me.room) return this.travel(state, me, f.room);
    if (inReach(me, f.x, f.z)) {
      const focus = getFocus(state, me);
      if (focus && focus.type === 'furniture' && focus.id === f.id) return { ...EMPTY_INPUT, act: true };
    }
    return this.steer(me, f.x, f.z + 0.04);
  }

  onEnterRoom(state) {
    const me = state.spies[this.idx];
    const room = state.embassy.rooms[me.room];
    this.remedyDecided = {};
    // Sometimes rig the door we just came through, if there is another way out [ours].
    const rival = rivalOf(state, me);
    const otherWays = SIDES.filter((s) => room.doors[s] !== undefined && !state.embassy.doors[room.doors[s]].exit).length;
    if (rival.room === me.room || otherWays < 2) return;
    const doorTraps = TRAPS.map((t, i) => [t, i]).filter(([t]) => t.on === 'door' && me.traps[t.id] > 0);
    if (doorTraps.length && this.rand() < this.p.doorTrapChance) {
      const [, i] = doorTraps[Math.floor(this.rand() * doorTraps.length)];
      this.pending.push({ ...EMPTY_INPUT, trap: i + 1 }, EMPTY_INPUT, { ...EMPTY_INPUT, act: true });
    }
  }

  onSearchDone(state, me, fid) {
    const f = state.embassy.furniture[fid];
    if (me.state !== 'alive') return;
    this.known[fid] = f.contents.map((c) => ({ ...c }));
    this.goal = null;
    if (this.lootRoom === f.room && !state.embassy.rooms[f.room].furniture.some((id) => this.known[id] === undefined)) this.lootRoom = null;
    this.pause = this.rand() * this.p.dawdle * 2;
    // Leave a nasty surprise in furniture we've emptied [ours].
    if (!f.fixture && !f.trap && f.contents.length === 0 && this.rand() < this.p.trapChance) {
      const options = TRAPS.map((t, i) => [t, i]).filter(([t]) => t.on === 'furniture' && me.traps[t.id] > 0);
      if (options.length) {
        const [, i] = options[Math.floor(this.rand() * options.length)];
        this.pending.push({ ...EMPTY_INPUT, trap: i + 1 }, EMPTY_INPUT, { ...EMPTY_INPUT, act: true });
      }
    }
  }

  want(me, thing) {
    if (thing.t === 'case') return me.hasCase ? 0 : 3;
    if (me.items.includes(thing.k)) return 0;
    if (me.hasCase) return 3;
    return me.items.length === 0 ? 2 : 0; // swapping one item for another gets us nowhere
  }

  chooseGoal(state, me) {
    const dist = this.distancesFrom(state, me.room);
    let best = null, bestScore = -Infinity;
    for (const f of state.embassy.furniture) {
      if (f.fixture) continue;
      if (f.trap && f.trap.owner === this.idx) continue; // we know where our own traps are
      let value;
      const known = this.known[f.id];
      if (known === undefined) value = f.room === this.lootRoom ? 2.5 : 1;
      else value = known.reduce((m, c) => Math.max(m, this.want(me, c)), 0);
      if (value <= 0) continue;
      const d = dist[f.room];
      if (d === Infinity) continue;
      const cost = d * 1.6 + (f.room === me.room ? Math.hypot(me.x - f.x, me.z - f.z) : 0.5);
      const score = value * 4 - cost + this.rand() * 0.5;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    if (!best) {
      // Everything searched and nothing useful: the rival must have moved things. Look again.
      this.known = {};
      this.huntT = 40;
      return null;
    }
    return { fid: best.id };
  }

  goalValid(state) {
    const f = state.embassy.furniture[this.goal.fid];
    return !(f.trap && f.trap.owner === this.idx);
  }

  maybeRemedy(state, me) {
    if (me.remedy || (!me.hasCase && me.items.length)) return null;
    const room = state.embassy.rooms[me.room];
    for (const fid of room.furniture) {
      const f = state.embassy.furniture[fid];
      if (!f.fixture || (f.trap && f.trap.owner === this.idx)) continue;
      if (this.remedyDecided[fid] === undefined) {
        const remedy = FIXTURES[f.fixture].remedy;
        const caughtBy = TRAPS.find((t) => t.remedy === remedy && this.hitBy[t.id]);
        this.remedyDecided[fid] = this.rand() < this.p.remedyChance * (caughtBy ? 1.5 : 1);
      }
      if (!this.remedyDecided[fid]) continue;
      if (inReach(me, f.x, f.z)) {
        const focus = getFocus(state, me);
        if (focus && focus.id === fid) {
          this.remedyDecided[fid] = false;
          return { ...EMPTY_INPUT, act: true };
        }
      }
      return this.steer(me, f.x, f.z + 0.03);
    }
    return null;
  }

  distancesFrom(state, room) {
    const { rooms, doors } = state.embassy;
    return roomDistances(rooms, doors, room, (d) => d.trap && d.trap.owner === this.idx);
  }

  // Walk towards a room, one door at a time, avoiding doors we rigged ourselves when possible.
  travel(state, me, targetRoom) {
    const { rooms, doors } = state.embassy;
    let dist = roomDistances(rooms, doors, targetRoom, (d) => d.trap && d.trap.owner === this.idx);
    if (dist[me.room] === Infinity) dist = roomDistances(rooms, doors, targetRoom);
    const room = rooms[me.room];
    let side = null;
    for (const s of SIDES) {
      const d = room.doors[s];
      if (d === undefined || doors[d].exit) continue;
      const other = doors[d].rooms[0] === me.room ? doors[d].rooms[1] : doors[d].rooms[0];
      if (dist[other] === dist[me.room] - 1 && (!side || !(doors[room.doors[side]].trap && doors[room.doors[side]].trap.owner === this.idx))) side = s;
    }
    if (!side) return this.wander(me);
    return this.goThroughDoor(me, side);
  }

  goThroughDoor(me, side) {
    const [ax, az] = DOOR_APPROACH[side];
    const aligned = side === 'n' || side === 's' ? Math.abs(me.x - 0.5) < 0.05 : Math.abs(me.z - 0.45) < 0.08;
    const close = side === 'n' ? me.z < 0.25 : side === 's' ? me.z > 0.75 : side === 'w' ? me.x < 0.3 : me.x > 0.7;
    if (aligned && close) return this.steer(me, ...DOOR_BEYOND[side]);
    return this.steer(me, ax, az);
  }

  goToExit(state, me) {
    const exit = state.embassy.doors[state.embassy.exitDoor];
    if (me.room !== exit.rooms[0]) return this.travel(state, me, exit.rooms[0]);
    return this.goThroughDoor(me, exit.sides[0]);
  }

  leaveRoom(state, me) {
    const room = state.embassy.rooms[me.room];
    let best = null, bestD = Infinity;
    for (const s of SIDES) {
      const d = room.doors[s];
      if (d === undefined) continue;
      const door = state.embassy.doors[d];
      if (door.exit && !hasAllItems(me)) continue;
      if (door.trap && door.trap.owner === this.idx) continue;
      const [x, z] = DOOR_ANCHOR[s];
      const dd = Math.hypot(me.x - x, me.z - z);
      if (dd < bestD) { bestD = dd; best = s; }
    }
    if (!best) return this.wander(me);
    return this.goThroughDoor(me, best);
  }

  fight(state, me) {
    const rival = rivalOf(state, me);
    if (hasAllItems(me)) {
      const exit = state.embassy.doors[state.embassy.exitDoor];
      if (exit.rooms[0] === me.room) return this.goThroughDoor(me, exit.sides[0]);
    }
    if (!this.fightPlan && this.huntT > 0) {
      this.fightPlan = 'fight';
      this.huntT = 0;
      this.attackCd = this.p.reaction;
      this.fightT = 0;
    }
    if (!this.fightPlan) {
      this.fightPlan = me.hp >= rival.hp && this.rand() < this.p.aggression + 0.2 ? 'fight' : this.rand() < this.p.aggression ? 'fight' : 'flee';
      this.attackCd = this.p.reaction;
      this.fightT = 0;
    }
    if (me.hp <= 2 && rival.hp > me.hp && this.rand() < 0.01) this.fightPlan = 'flee';
    if (this.fightPlan === 'flee') return this.leaveRoom(state, me);

    this.attackCd -= DT;
    const dx = rival.x - me.x, dz = rival.z - me.z;
    const face = dx >= 0 ? 1 : -1;
    // Step back from a telegraphed heavy blow, if quick enough to read it.
    if (rival.action && rival.action.kind === 'heavy' && rival.action.t > this.p.reaction * 0.6 && Math.abs(dx) < 0.16 && this.rand() < this.p.aggression) {
      return { ...EMPTY_INPUT, mx: -face, mz: 0 };
    }
    const wantDx = 0.085;
    const adx = Math.abs(dx);
    const facing = me.face === face || adx < 0.02;
    const inRange = adx < TUNING.combat.jab.range * 0.95 && Math.abs(dz) < TUNING.combat.reachZ * 0.7;
    if (inRange && facing && this.attackCd <= 0) {
      this.attackCd = this.p.reaction + this.rand() * 0.35;
      this.fightT = 0;
      const heavy = rival.stun > 0 || this.rand() < 0.25;
      return { ...EMPTY_INPUT, jab: !heavy, heavy };
    }
    // A fight going nowhere: give up and run [ours].
    this.fightT = (this.fightT || 0) + DT;
    if (this.fightT > 8) this.fightPlan = 'flee';
    let mx = 0;
    if (adx > wantDx) mx = face;
    else if (adx < 0.035) mx = -face;
    else if (me.face !== face) mx = face * 0.2;
    const mz = Math.abs(dz) > 0.03 ? Math.sign(dz) : 0;
    return { ...EMPTY_INPUT, mx, mz };
  }

  wander(me) {
    return this.steer(me, 0.5, 0.6);
  }

  steer(me, tx, tz) {
    const dx = tx - me.x, dz = tz - me.z;
    const mx = Math.abs(dx) < 0.01 ? 0 : Math.max(-1, Math.min(1, dx * 12));
    const mz = Math.abs(dz) < 0.015 ? 0 : Math.max(-1, Math.min(1, dz * 8));
    // Unstick if we haven't moved for a while.
    const moved = Math.hypot(me.x - this.lastPos[0], me.z - this.lastPos[1]);
    this.lastPos = [me.x, me.z];
    if ((mx || mz) && moved < 0.0005) this.stuckT += DT;
    else this.stuckT = 0;
    if (this.stuckT > 1.5) {
      this.stuckT = 0;
      this.goal = null;
      return { ...EMPTY_INPUT, mx: this.rand() * 2 - 1, mz: this.rand() * 2 - 1 };
    }
    return { ...EMPTY_INPUT, mx, mz };
  }
}

