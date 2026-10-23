// Builds a random embassy: a connected set of rooms on a grid, doors between
// neighbours, furniture, remedy fixtures, the hidden items and one exit.

import { ITEMS, FIXTURES, FURNITURE_KINDS, SIDES, OPPOSITE, SIDE_DELTA, BACK_SLOTS, SIDE_FIXTURE_Z } from './data.js';
import { rngNext, rngInt, rngPick, rngShuffle } from './rng.js';

const EXTRA_DOOR_CHANCE = 0.3; // [ours] chance of an extra loop door between neighbouring rooms

export function generateEmbassy(rng, levelCfg) {
  const [gw, gh] = levelCfg.grid;
  const key = (x, y) => `${x},${y}`;

  // Grow a connected blob of cells.
  const cells = new Map();
  const start = [rngInt(rng, gw), rngInt(rng, gh)];
  cells.set(key(...start), start);
  while (cells.size < levelCfg.rooms) {
    const frontier = [];
    for (const [x, y] of cells.values()) {
      for (const s of SIDES) {
        const [dx, dy] = SIDE_DELTA[s];
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && !cells.has(key(nx, ny))) frontier.push([nx, ny]);
      }
    }
    const c = rngPick(rng, frontier);
    cells.set(key(...c), c);
  }

  const rooms = [];
  const roomAt = new Map();
  for (const [x, y] of cells.values()) {
    const room = { id: rooms.length, gx: x, gy: y, doors: {}, furniture: [], palette: rngInt(rng, 6) };
    rooms.push(room);
    roomAt.set(key(x, y), room);
  }

  // Spanning tree by random depth-first search, then a few extra loops.
  const doors = [];
  const connect = (a, side, b) => {
    const door = { id: doors.length, rooms: [a.id, b.id], sides: [side, OPPOSITE[side]], trap: null, exit: false };
    doors.push(door);
    a.doors[side] = door.id;
    b.doors[OPPOSITE[side]] = door.id;
  };
  const seen = new Set([rooms[0].id]);
  const stack = [rooms[0]];
  while (stack.length) {
    const r = stack[stack.length - 1];
    const options = rngShuffle(rng, SIDES.slice())
      .map((s) => [s, roomAt.get(key(r.gx + SIDE_DELTA[s][0], r.gy + SIDE_DELTA[s][1]))])
      .filter(([, n]) => n && !seen.has(n.id));
    if (!options.length) { stack.pop(); continue; }
    const [s, n] = options[0];
    connect(r, s, n);
    seen.add(n.id);
    stack.push(n);
  }
  for (const r of rooms) {
    for (const s of ['e', 's']) {
      const n = roomAt.get(key(r.gx + SIDE_DELTA[s][0], r.gy + SIDE_DELTA[s][1]));
      if (n && r.doors[s] === undefined && rngNext(rng) < EXTRA_DOOR_CHANCE) connect(r, s, n);
    }
  }

  const startRoom = rngPick(rng, rooms).id;

  // Exit: the farthest room from the start that has a wall with no neighbour.
  const dist = roomDistances(rooms, doors, startRoom);
  const exitCandidates = rooms
    .filter((r) => SIDES.some((s) => r.doors[s] === undefined))
    .sort((a, b) => dist[b.id] - dist[a.id]);
  const exitRoom = exitCandidates[0];
  const freeSides = SIDES.filter((s) => exitRoom.doors[s] === undefined);
  const exitSide = freeSides.includes('s') ? 's' : rngPick(rng, freeSides);
  const exitDoor = { id: doors.length, rooms: [exitRoom.id, null], sides: [exitSide, null], trap: null, exit: true };
  doors.push(exitDoor);
  exitRoom.doors[exitSide] = exitDoor.id;

  // Furniture. Each room gets back-wall slots; fixtures take some of them.
  const furniture = [];
  const add = (room, props) => {
    const f = { id: furniture.length, room: room.id, contents: [], trap: null, fixture: null, ...props };
    furniture.push(f);
    room.furniture.push(f.id);
    return f;
  };

  // Spread fixtures: each kind at least once, more in bigger embassies [ours].
  const perKind = Math.max(1, Math.round(rooms.length / 6));
  const fixturePlan = new Map(rooms.map((r) => [r.id, []]));
  for (const kind of Object.keys(FIXTURES)) {
    const wall = FIXTURES[kind].wall;
    const order = rngShuffle(rng, rooms.slice());
    let placed = 0;
    for (const r of order) {
      if (placed >= perKind) break;
      const plan = fixturePlan.get(r.id);
      if (plan.some((k) => FIXTURES[k].wall === wall && wall !== 'back')) continue;
      if (plan.filter((k) => FIXTURES[k].wall === 'back').length >= 1 && wall === 'back') continue;
      plan.push(kind);
      placed++;
    }
  }

  for (const r of rooms) {
    const slots = rngShuffle(rng, BACK_SLOTS.slice());
    const plan = fixturePlan.get(r.id);
    for (const kind of plan) {
      const wall = FIXTURES[kind].wall;
      if (wall === 'back') add(r, { kind, fixture: kind, x: slots.pop(), z: 0.12, wall });
      else add(r, { kind, fixture: kind, x: wall === 'left' ? 0.06 : 0.94, z: SIDE_FIXTURE_Z, wall });
    }
    const count = Math.min(slots.length, 2 + rngInt(rng, 2));
    for (let i = 0; i < count; i++) add(r, { kind: rngPick(rng, FURNITURE_KINDS), x: slots.pop(), z: 0.12, wall: 'back' });
  }

  // Hide the four items and the briefcase in ordinary furniture, away from the start room [ours].
  const hidingSpots = rngShuffle(rng, furniture.filter((f) => !f.fixture && f.room !== startRoom));
  const things = [...ITEMS.map((k) => ({ t: 'item', k })), { t: 'case' }];
  things.forEach((thing, i) => hidingSpots[i % hidingSpots.length].contents.push({ ...thing, lastHolder: null }));

  return { rooms, doors, furniture, startRoom, exitDoor: exitDoor.id, exitRoom: exitRoom.id, grid: [gw, gh] };
}

// Breadth-first distances (in doors) from one room to every other.
export function roomDistances(rooms, doors, from, blocked = () => false) {
  const dist = rooms.map(() => Infinity);
  dist[from] = 0;
  const q = [from];
  while (q.length) {
    const id = q.shift();
    for (const s of SIDES) {
      const d = rooms[id].doors[s];
      if (d === undefined) continue;
      const door = doors[d];
      if (door.exit || blocked(door)) continue;
      const other = door.rooms[0] === id ? door.rooms[1] : door.rooms[0];
      if (dist[other] === Infinity) {
        dist[other] = dist[id] + 1;
        q.push(other);
      }
    }
  }
  return dist;
}
