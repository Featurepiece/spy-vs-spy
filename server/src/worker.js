// Online play server. The Worker sends each /match/<code> connection to the
// Durable Object for that code; the object runs the real game rules (src/sim.js)
// as the referee. This first version is a test of the game loop, not the
// finished protocol: see docs/ONLINE.md.

import { DurableObject } from 'cloudflare:workers';
import { createGame, step, DT, EMPTY_INPUT } from '../../src/sim.js';

const SNAPSHOT_EVERY = 3; // ticks: 60 Hz game, 20 Hz snapshots
const MAX_CATCH_UP = 10; // most steps run in one timer callback after a stall

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/match\/([A-Z]{4})(\/stats)?$/);
    if (!m) return new Response('Double Agents server', { status: 404 });
    return env.MATCH.get(env.MATCH.idFromName(m[1])).fetch(request);
  },
};

export class Match extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null;
    this.inputs = [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }];
    this.timer = null;
    this.stats = { started: 0, ticks: 0, callbacks: 0, maxSteps: 0, maxGapMs: 0, snapshots: 0, lastAt: 0 };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/stats')) {
      const s = this.stats;
      const secs = (Date.now() - s.started) / 1000;
      return Response.json({ ...s, seconds: secs, ticksPerSecond: s.ticks / secs, gameTick: this.state?.tick ?? 0 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const slot = Number(url.searchParams.get('slot')) === 1 ? 1 : 0;
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [`slot${slot}`]);
    if (!this.state) this.start(Number(url.searchParams.get('seed')) || 1);
    return new Response(null, { status: 101, webSocket: client });
  }

  start(seed) {
    this.state = createGame({ level: 0, seed });
    const now = Date.now();
    Object.assign(this.stats, { started: now, lastAt: now });
    this.acc = 0;
    this.timer = setInterval(() => this.tick(), 1000 * DT);
  }

  tick() {
    const now = Date.now();
    const s = this.stats;
    s.callbacks++;
    s.maxGapMs = Math.max(s.maxGapMs, now - s.lastAt);
    this.acc += (now - s.lastAt) / 1000;
    s.lastAt = now;
    let steps = 0;
    const events = [];
    while (this.acc >= DT && steps < MAX_CATCH_UP) {
      this.acc -= DT;
      step(this.state, this.inputs);
      events.push(...this.state.events);
      // Button presses last one step; movement holds until the player changes it.
      for (const inp of this.inputs) Object.assign(inp, { act: false, jab: false, heavy: false, trap: 0, map: false, hide: false });
      steps++;
      s.ticks++;
      if (this.state.tick % SNAPSHOT_EVERY === 0) this.broadcast(events.splice(0));
    }
    if (this.acc > DT * MAX_CATCH_UP) this.acc = 0; // too far behind: drop the backlog
    s.maxSteps = Math.max(s.maxSteps, steps);
  }

  broadcast(events) {
    const st = this.state;
    const msg = JSON.stringify({
      tick: st.tick,
      spies: st.spies.map((p) => ({ room: p.room, x: p.x, z: p.z, state: p.state, time: p.time })),
      events,
    });
    for (const ws of this.ctx.getWebSockets()) ws.send(msg);
    this.stats.snapshots++;
  }

  webSocketMessage(ws, data) {
    const slot = this.ctx.getTags(ws)[0] === 'slot1' ? 1 : 0;
    let inp;
    try { inp = JSON.parse(data); } catch { return; }
    const cur = this.inputs[slot];
    cur.mx = Math.max(-1, Math.min(1, Number(inp.mx) || 0));
    cur.mz = Math.max(-1, Math.min(1, Number(inp.mz) || 0));
    for (const k of ['act', 'jab', 'heavy', 'map', 'hide']) if (inp[k]) cur[k] = true;
    if (inp.trap) cur.trap = Number(inp.trap) | 0;
  }

  webSocketClose(ws) {
    if (this.ctx.getWebSockets().length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.state = null;
    }
  }
}
