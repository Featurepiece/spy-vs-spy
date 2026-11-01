// Online play server. The Worker sends each /match/<code> connection to the
// Durable Object for that code. The object is the referee: it runs the real
// game rules (src/sim.js) and tells each browser only what its player may see.
// The messages are described in docs/ARCHITECTURE.md.

import { DurableObject } from 'cloudflare:workers';
import { createGame, step, DT, EMPTY_INPUT, SPY_NAMES } from '../../src/sim.js';
import { TUNING } from '../../src/tuning.js';

const SNAPSHOT_EVERY = 3; // ticks: 60 Hz game, 20 Hz snapshots
const MAX_CATCH_UP = 10; // most steps run in one timer callback after a stall
const COUNTDOWN = 3; // seconds after both press Ready
const REJOIN_SECONDS = 60; // how long a dropped player has to come back
const SCREENS = ['both', 'rivalOff', 'one'];
const NAME_MAX = 12;
const BUTTONS = ['act', 'jab', 'heavy', 'map', 'hide'];

// Pages allowed to connect. Anything else (another site embedding us) is refused.
const ORIGINS = [/^https:\/\/featurepiece\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/match\/([A-Z]{4})(\/stats)?$/);
    if (!m) return new Response('Double Agents server', { status: 404 });
    const origin = request.headers.get('Origin');
    if (origin && !ORIGINS.some((re) => re.test(origin))) return new Response('Not allowed', { status: 403 });
    return env.MATCH.get(env.MATCH.idFromName(m[1])).fetch(request);
  },
};

export class Match extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // One record per seat: Scarlet (0, whoever created the game) and Cobalt (1).
    this.seats = [null, null];
    this.settings = { level: 0, screens: 'both' };
    this.phase = 'lobby'; // lobby | countdown | play | over
    this.state = null;
    this.inputs = [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }];
    this.timer = null;
    this.countdownAt = 0;
    this.pausedFor = null; // seat we're waiting on after a dropout
    this.pausedUntil = 0;
    this.stats = { started: 0, ticks: 0, callbacks: 0, maxSteps: 0, maxGapMs: 0, snapshots: 0, lastAt: 0 };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/stats')) return Response.json(this.statsReport());
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    // A plain (not hibernating) socket: the match lives in memory while anyone is connected.
    server.accept();
    server.addEventListener('message', (e) => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- messages from browsers ----------

  onMessage(ws, data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') return this.hello(ws, m);
    const seat = this.seats.findIndex((s) => s && s.ws === ws);
    if (seat < 0) return;
    const me = this.seats[seat];
    switch (m.t) {
      case 'in': return this.takeInput(seat, m);
      case 'name':
        me.name = cleanName(m.name, seat);
        return this.sendLobby();
      case 'settings':
        // Only the creator chooses the embassy and the screens, and only in the lobby.
        if (seat !== 0 || this.phase !== 'lobby') return;
        if (Number.isInteger(m.level) && m.level >= 0 && m.level < TUNING.levels.length) this.settings.level = m.level;
        if (SCREENS.includes(m.screens)) this.settings.screens = m.screens;
        for (const s of this.seats) if (s) s.ready = false;
        return this.sendLobby();
      case 'ready':
        if (this.phase !== 'lobby' && this.phase !== 'countdown') return;
        me.ready = !!m.on;
        return this.checkReady();
      case 'rematch':
        if (this.phase !== 'over') return;
        this.phase = 'lobby';
        this.state = null;
        for (const s of this.seats) if (s) s.ready = false;
        return this.sendLobby();
      case 'leave':
        return this.leave(seat);
      case 'ping':
        return;
    }
  }

  hello(ws, m) {
    const token = typeof m.token === 'string' ? m.token.slice(0, 64) : '';
    // Coming back after a dropout, or a second tab with the same token: take the seat over.
    let seat = token ? this.seats.findIndex((s) => s && s.token === token) : -1;
    if (seat < 0) {
      if (m.create && this.seats.some(Boolean)) return send(ws, { t: 'error', code: 'taken', text: 'That code is already in use.' });
      if (!m.create && !this.seats[0]) return send(ws, { t: 'error', code: 'nogame', text: 'No game with that code. Check the letters with your friend.' });
      seat = this.seats.findIndex((s) => !s);
      if (seat < 0 || (this.phase !== 'lobby')) return send(ws, { t: 'error', code: 'full', text: 'That game already has two spies.' });
      this.seats[seat] = { token, name: cleanName(m.name, seat), ready: false, ws: null, goneAt: 0 };
    }
    const s = this.seats[seat];
    if (s.ws && s.ws !== ws) { send(s.ws, { t: 'error', code: 'replaced', text: 'You joined from another window.' }); safeClose(s.ws); }
    s.ws = ws;
    s.goneAt = 0;
    send(ws, { t: 'welcome', you: seat });
    if (this.state) {
      send(ws, this.startMessage(seat));
      if (this.pausedFor === seat) this.resume();
    }
    this.sendLobby();
    this.ensureTimer();
  }

  takeInput(seat, m) {
    if (this.phase !== 'play') return;
    const cur = this.inputs[seat];
    if (m.mx !== undefined) cur.mx = clamp1(m.mx);
    if (m.mz !== undefined) cur.mz = clamp1(m.mz);
    // Button presses are kept until the next step uses them, so a quick tap is never lost.
    for (const k of BUTTONS) if (m[k]) cur[k] = true;
    if (Number.isInteger(m.trap) && m.trap >= 0 && m.trap <= 5) cur.trap = m.trap;
  }

  onClose(ws) {
    const seat = this.seats.findIndex((s) => s && s.ws === ws);
    if (seat < 0) return;
    const s = this.seats[seat];
    s.ws = null;
    s.goneAt = Date.now();
    if (this.phase === 'play') {
      this.pausedFor = seat;
      this.pausedUntil = Date.now() + REJOIN_SECONDS * 1000;
      this.broadcast({ t: 'pause', waiting: seat, seconds: REJOIN_SECONDS });
    } else if (this.phase !== 'over') {
      // In the lobby a closed window frees the seat, unless it's the creator,
      // who keeps the code: a refresh shouldn't lose the game.
      if (seat === 1) this.seats[1] = null;
      if (this.phase === 'countdown') this.phase = 'lobby';
      for (const x of this.seats) if (x) x.ready = false;
    }
    this.sendLobby();
  }

  leave(seat) {
    const s = this.seats[seat];
    if (this.phase === 'play') this.forfeit(seat);
    safeClose(s.ws);
    this.seats[seat] = null;
    if (seat === 0 && this.seats[1]) {
      // The creator left: the game is over for both.
      send(this.seats[1].ws, { t: 'error', code: 'closed', text: `${s.name} closed the game.` });
      safeClose(this.seats[1].ws);
      this.seats[1] = null;
    }
    if (this.phase !== 'over') this.phase = 'lobby';
    this.sendLobby();
  }

  // ---------- lobby ----------

  lobbyMessage(seat) {
    return {
      t: 'lobby',
      you: seat,
      phase: this.phase,
      settings: this.settings,
      countdown: this.phase === 'countdown' ? Math.max(0, Math.ceil((this.countdownAt - Date.now()) / 1000)) : 0,
      players: this.seats.map((s) => s && { name: s.name, ready: s.ready, here: !!s.ws }),
    };
  }

  sendLobby() {
    this.seats.forEach((s, i) => { if (s && s.ws) send(s.ws, this.lobbyMessage(i)); });
  }

  checkReady() {
    const both = this.seats.every((s) => s && s.ready && s.ws);
    if (both && this.phase === 'lobby') {
      this.phase = 'countdown';
      this.countdownAt = Date.now() + COUNTDOWN * 1000;
    } else if (!both && this.phase === 'countdown') this.phase = 'lobby';
    this.sendLobby();
    this.ensureTimer();
  }

  // ---------- the match ----------

  startMatch() {
    const seed = (Math.random() * 2 ** 31) | 0;
    this.state = createGame({ level: this.settings.level, seed });
    this.state.spies.forEach((spy, i) => { spy.name = this.seats[i].name; });
    this.inputs = [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }];
    this.phase = 'play';
    this.pausedFor = null;
    this.acc = 0;
    Object.assign(this.stats, { started: Date.now(), lastAt: Date.now(), ticks: 0, callbacks: 0, maxSteps: 0, maxGapMs: 0, snapshots: 0 });
    this.seats.forEach((s, i) => { if (s.ws) send(s.ws, this.startMessage(i)); });
  }

  // Everything about the embassy that never changes, sent once per match.
  startMessage(seat) {
    const e = this.state.embassy;
    return {
      t: 'start',
      you: seat,
      level: this.state.level,
      screens: this.settings.screens,
      names: this.state.spies.map((s) => s.name),
      embassy: {
        rooms: e.rooms,
        doors: e.doors.map(({ trap, ...d }) => d),
        furniture: e.furniture.map(({ contents, trap, ...f }) => f),
        startRoom: e.startRoom, exitDoor: e.exitDoor, exitRoom: e.exitRoom, grid: e.grid,
      },
      snap: this.snapshot(seat, []),
    };
  }

  // What one player may know right now. Traps are only ever shown to whoever
  // set them, and furniture contents never leave the server except as "an item
  // is somewhere in this room" for the map. With the rival's monitor off, the
  // rival is only sent while they're in the same room.
  snapshot(seat, events) {
    const st = this.state;
    const me = st.spies[seat];
    const rival = st.spies[1 - seat];
    const hideRival = this.settings.screens !== 'both' && !st.over && rival.room !== me.room;
    const e = st.embassy;
    return {
      t: 'snap',
      tick: st.tick, time: st.t, truce: st.truce, over: st.over, winner: st.winner,
      spies: st.spies.map((s) => (s === rival && hideRival ? hiddenSpy(s) : s)),
      bombs: st.bombs.filter((b) => !hideRival || b.room === me.room),
      doorTraps: e.doors.filter((d) => d.trap && d.trap.owner === seat).map((d) => [d.id, d.trap]),
      furnTraps: e.furniture.filter((f) => f.trap && f.trap.owner === seat).map((f) => [f.id, f.trap]),
      itemFurn: e.furniture.filter((f) => f.contents.some((c) => c.t === 'item')).map((f) => f.id),
      events: hideRival ? events.filter((ev) => ev.spy === seat || ev.room === me.room || (ev.spy === undefined && ev.room === undefined)) : events,
    };
  }

  ensureTimer() {
    const anyone = this.seats.some((s) => s && s.ws);
    if (anyone && !this.timer) {
      this.stats.lastAt = Date.now();
      this.acc = 0;
      this.timer = setInterval(() => this.tick(), 1000 * DT);
    } else if (!anyone && this.timer && this.phase !== 'play') {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick() {
    const now = Date.now();
    const s = this.stats;
    const gap = now - s.lastAt;
    s.lastAt = now;
    if (this.phase === 'countdown' && now >= this.countdownAt) this.startMatch();
    if (this.phase !== 'play') {
      this.cleanUp(now);
      return;
    }
    if (this.pausedFor !== null) {
      if (now >= this.pausedUntil) this.forfeit(this.pausedFor);
      return;
    }
    s.callbacks++;
    s.maxGapMs = Math.max(s.maxGapMs, gap);
    this.acc += gap / 1000;
    let steps = 0;
    const events = [];
    while (this.acc >= DT && steps < MAX_CATCH_UP && this.phase === 'play') {
      this.acc -= DT;
      step(this.state, this.inputs);
      events.push(...this.state.events);
      for (const inp of this.inputs) Object.assign(inp, { act: false, jab: false, heavy: false, trap: 0, map: false, hide: false });
      steps++;
      s.ticks++;
      if (this.state.tick % SNAPSHOT_EVERY === 0 || this.state.over) this.sendSnapshots(events.splice(0));
      if (this.state.over) this.phase = 'over';
    }
    if (this.acc > DT * MAX_CATCH_UP) this.acc = 0; // too far behind: drop the backlog
    s.maxSteps = Math.max(s.maxSteps, steps);
  }

  sendSnapshots(events) {
    this.seats.forEach((seat, i) => { if (seat && seat.ws) send(seat.ws, this.snapshot(i, events)); });
    this.stats.snapshots++;
  }

  resume() {
    this.pausedFor = null;
    this.stats.lastAt = Date.now();
    this.acc = 0;
    this.broadcast({ t: 'resume' });
  }

  // A player didn't come back in time, or left: the other one wins.
  forfeit(seat) {
    this.pausedFor = null;
    this.phase = 'over';
    const winner = 1 - seat;
    this.broadcast({ t: 'forfeit', loser: seat, winner, text: `${this.seats[seat]?.name ?? SPY_NAMES[seat]}'s signal was lost.` });
  }

  // Nobody has been connected for a while: forget the match so the code is free again.
  cleanUp(now) {
    const gone = this.seats.every((s) => !s || (!s.ws && now - s.goneAt > REJOIN_SECONDS * 1000));
    if (gone) {
      this.seats = [null, null];
      this.phase = 'lobby';
      this.state = null;
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  broadcast(msg) {
    for (const s of this.seats) if (s && s.ws) send(s.ws, msg);
  }

  statsReport() {
    const s = this.stats;
    const secs = (Date.now() - s.started) / 1000;
    return { ...s, seconds: secs, ticksPerSecond: s.ticks / secs, phase: this.phase, gameTick: this.state?.tick ?? 0 };
  }
}

function hiddenSpy(s) {
  return { idx: s.idx, name: s.name, room: -1, x: 0, z: 0, state: s.state, hidden: true, items: [], traps: {}, visited: {}, trail: [] };
}

function cleanName(name, seat) {
  const s = String(name ?? '').replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, NAME_MAX);
  return s || SPY_NAMES[seat];
}

function clamp1(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
}

function send(ws, msg) {
  if (!ws) return;
  try { ws.send(JSON.stringify(msg)); } catch { /* socket already closed */ }
}

function safeClose(ws) {
  try { ws?.close(1000, 'bye'); } catch { /* already closed */ }
}
