// The browser's side of online play. The server (server/src/worker.js) runs the
// game; this sends our spy's input and turns the server's snapshots back into a
// game state the renderer can draw, smoothing the spies between snapshots.

import { SERVER_URL } from './online-config.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they look like 1 and 0
const SNAP_MS = 50; // the server sends 20 snapshots a second
const PING_MS = 20000;

export function serverUrl() {
  const p = new URLSearchParams(location.search).get('server');
  return p || SERVER_URL;
}

export function newCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return s;
}

export function cleanCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

// The invite link: the game's own address with ?join=CODE.
export function inviteLink(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  const keep = new URLSearchParams(location.search).get('server');
  if (keep) u.searchParams.set('server', keep);
  u.searchParams.set('join', code);
  return u.toString();
}

function browserToken() {
  try {
    let t = localStorage.getItem('da.online.token');
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('da.online.token', t);
    }
    return t;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export class OnlineGame {
  constructor({ code, create, name, on }) {
    this.code = code;
    this.on = on; // callbacks: lobby, start, snap, pause, resume, forfeit, error, closed
    this.you = null;
    this.state = null;
    this.screens = 'both';
    this.prev = null; // the snapshot before the latest, for smoothing
    this.cur = null;
    this.curAt = 0;
    this.sent = {};
    this.closedByUs = false;
    this.ws = new WebSocket(`${serverUrl().replace(/\/$/, '')}/match/${code}`);
    this.ws.onopen = () => this.send({ t: 'hello', create, name, token: browserToken() });
    this.ws.onmessage = (m) => this.receive(JSON.parse(m.data));
    this.ws.onclose = () => { clearInterval(this.pinger); if (!this.closedByUs) this.on.closed?.(); };
    this.ws.onerror = () => {};
    this.pinger = setInterval(() => this.send({ t: 'ping' }), PING_MS);
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.pinger);
    try { this.send({ t: 'leave' }); this.ws.close(); } catch { /* already closed */ }
  }

  receive(m) {
    switch (m.t) {
      case 'welcome': this.you = m.you; break;
      case 'lobby': this.you = m.you; this.on.lobby?.(m); break;
      case 'start': this.begin(m); break;
      case 'snap': this.apply(m); break;
      case 'pause': this.on.pause?.(m); break;
      case 'resume': this.on.resume?.(m); break;
      case 'forfeit': this.on.forfeit?.(m); break;
      case 'error': this.on.error?.(m); break;
    }
  }

  begin(m) {
    this.you = m.you;
    this.screens = m.screens;
    const embassy = m.embassy;
    for (const d of embassy.doors) d.trap = null;
    for (const f of embassy.furniture) { f.trap = null; f.contents = []; }
    this.state = { t: 0, tick: 0, level: m.level, embassy, spies: [], bombs: [], events: [], truce: true, over: false, winner: null, hitstop: 0 };
    this.prev = this.cur = null;
    this.sent = {};
    this.apply(m.snap, true);
    this.on.start?.(m);
  }

  // Fold one snapshot into the state, and hand its events to the game.
  apply(snap, first = false) {
    const st = this.state;
    if (!st) return;
    this.prev = first ? snap : this.cur;
    this.cur = snap;
    this.curAt = performance.now();
    Object.assign(st, { t: snap.time, tick: snap.tick, truce: snap.truce, over: snap.over, winner: snap.winner, bombs: snap.bombs });
    st.spies = snap.spies.map((s) => ({ ...s }));
    const { doors, furniture } = st.embassy;
    for (const d of doors) d.trap = null;
    for (const f of furniture) { f.trap = null; f.contents = []; }
    for (const [id, trap] of snap.doorTraps) doors[id].trap = trap;
    for (const [id, trap] of snap.furnTraps) furniture[id].trap = trap;
    for (const id of snap.itemFurn) furniture[id].contents = [{ t: 'item' }];
    st.events = snap.events;
    if (!first) this.on.snap?.(st, snap.events);
  }

  // Spy positions for drawing this frame: part way from the previous snapshot
  // to the latest, so 20 updates a second still look smooth at 60 frames.
  smoothed() {
    const st = this.state;
    if (!st || !this.prev || !this.cur) return st;
    const k = Math.min(1, (performance.now() - this.curAt) / SNAP_MS);
    st.spies.forEach((s, i) => {
      const a = this.prev.spies[i], b = this.cur.spies[i];
      if (!a || a.room !== b.room || a.hidden || b.hidden) return;
      s.x = a.x + (b.x - a.x) * k;
      s.z = a.z + (b.z - a.z) * k;
      if (typeof a.walk === 'number') s.walk = a.walk + (b.walk - a.walk) * k;
    });
    return st;
  }

  // Send our input only when it changes, so the free plan's message allowance
  // lasts: movement is rounded to a quarter, and button presses go at once.
  sendInput(f) {
    const q = (v) => Math.round(v * 4) / 4;
    const msg = {};
    const mx = q(f.mx), mz = q(f.mz);
    if (mx !== this.sent.mx || mz !== this.sent.mz) { msg.mx = mx; msg.mz = mz; this.sent.mx = mx; this.sent.mz = mz; }
    for (const k of ['act', 'jab', 'heavy', 'map', 'hide']) if (f[k]) msg[k] = true;
    if (f.trap) msg.trap = f.trap;
    if (Object.keys(msg).length) this.send({ t: 'in', ...msg });
  }
}
