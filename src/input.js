// Turns keyboard, touch and gamepad into the simulation's input frames.
// Button presses are remembered until the next simulation step uses them,
// so a quick tap is never lost between frames.

import { TRAPS } from './data.js';

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  act: ['Space', 'KeyE', 'Enter'],
  jab: ['KeyJ', 'KeyZ'],
  heavy: ['KeyK', 'KeyX'],
  map: ['KeyM', 'Tab'],
  cycle: ['KeyQ'],
  hide: ['KeyH'],
};
const TRAP_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
const DEADZONE = 0.25;

// Button numbers in the browser's "standard" controller layout (W3C Gamepad
// spec). They name positions, not printed letters: `a` is the bottom face
// button whatever the controller calls it.
export const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };

// What the face buttons are called on the controller in use, guessed from the
// USB maker id in its name. Unknown makers get the Xbox letters.
const FACE_LABELS = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', back: 'View', start: 'Menu' },
  playstation: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', back: 'Share', start: 'Options' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', back: '−', start: '+' },
};
function padFamily(id) {
  const s = id.toLowerCase();
  if (/054c|playstation|dualshock|dualsense/.test(s)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox';
}

// Reads every connected controller once per animation frame. All of them
// count as the one local player: in online play each computer has one player,
// and it saves guessing which slot the browser put a controller in.
export class Gamepads {
  constructor() {
    this.prev = new Set();
    this.pressed = new Set(); // buttons that went down since the last poll
    this.held = new Set();
    this.move = [0, 0]; // left stick or D-pad, -1..1
    this.labels = FACE_LABELS.xbox;
    this.active = false; // true while a controller is the last thing used
  }

  poll() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    const held = new Set();
    let mx = 0, mz = 0, used = null;
    for (const pad of pads) {
      pad.buttons.forEach((b, i) => {
        if (!b.pressed) return;
        held.add(i);
        if (!this.prev.has(i)) used = pad;
      });
      const ax = pad.axes[0] ?? 0, az = pad.axes[1] ?? 0;
      if (Math.abs(ax) > DEADZONE && Math.abs(ax) > Math.abs(mx)) mx = ax;
      if (Math.abs(az) > DEADZONE && Math.abs(az) > Math.abs(mz)) mz = az;
      // A firm push on the stick counts as using the controller; a little drift doesn't.
      if (Math.max(Math.abs(ax), Math.abs(az)) > 0.5 && Math.max(...this.move.map(Math.abs)) <= 0.5) used = pad;
    }
    if (held.has(PAD.left)) mx = -1;
    if (held.has(PAD.right)) mx = 1;
    if (held.has(PAD.up)) mz = -1;
    if (held.has(PAD.down)) mz = 1;
    this.pressed = new Set([...held].filter((i) => !this.prev.has(i)));
    this.prev = held;
    this.held = held;
    this.move = [mx, mz];
    if (used) {
      this.active = true;
      this.labels = FACE_LABELS[padFamily(used.id)];
    }
    return this;
  }
}

export class LocalInput {
  constructor() {
    this.held = new Set();
    this.edges = { act: false, jab: false, heavy: false, map: false, cycle: 0, trap: 0, hide: false };
    this.touchVec = [0, 0];
    this.padVec = [0, 0];
    this.enabled = true;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());
  }

  onKey(e, down) {
    if (!this.enabled) return;
    const code = e.code;
    const isGameKey = Object.values(KEYS).some((k) => k.includes(code)) || TRAP_KEYS.includes(code);
    if (!isGameKey) return;
    e.preventDefault();
    if (down) {
      if (!e.repeat) {
        if (KEYS.act.includes(code)) this.edges.act = true;
        if (KEYS.jab.includes(code)) this.edges.jab = true;
        if (KEYS.heavy.includes(code)) this.edges.heavy = true;
        if (KEYS.map.includes(code)) this.edges.map = true;
        if (KEYS.cycle.includes(code)) this.edges.cycle = 1;
        if (KEYS.hide.includes(code)) this.edges.hide = true;
        const t = TRAP_KEYS.indexOf(code);
        if (t >= 0) this.edges.trap = t + 1;
      }
      this.held.add(code);
    } else this.held.delete(code);
  }

  press(name) {
    if (name === 'cycle') this.edges.cycle = 1;
    else if (name in this.edges) this.edges[name] = true;
  }

  isHeld(name) {
    return KEYS[name].some((k) => this.held.has(k));
  }

  // Turns this animation frame's controller state into the same remembered
  // presses the keyboard makes. Called by main.js only while a game is running.
  usePad(pad) {
    const p = pad.pressed;
    if (p.has(PAD.a)) this.edges.act = true;
    if (p.has(PAD.x)) this.edges.jab = true;
    if (p.has(PAD.y)) this.edges.heavy = true;
    if (p.has(PAD.b)) this.edges.hide = true;
    if (p.has(PAD.back)) this.edges.map = true;
    if (p.has(PAD.rb) || p.has(PAD.rt)) this.edges.cycle = 1;
    if (p.has(PAD.lb) || p.has(PAD.lt)) this.edges.cycle = -1;
    this.padVec = pad.move;
  }

  // One input frame for the simulation. Consumes the remembered presses.
  frame(state, spyIdx) {
    const [px, pz] = this.padVec;
    let mx = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    let mz = (this.isHeld('down') ? 1 : 0) - (this.isHeld('up') ? 1 : 0);
    if (!mx && !mz) { mx = px || this.touchVec[0]; mz = pz || this.touchVec[1]; }
    let trap = this.edges.trap;
    if (!trap && this.edges.cycle) trap = cycleTrap(state.spies[spyIdx], this.edges.cycle);
    const f = { mx, mz, act: this.edges.act, jab: this.edges.jab, heavy: this.edges.heavy, trap, map: this.edges.map, hide: this.edges.hide };
    this.edges = { act: false, jab: false, heavy: false, map: false, cycle: 0, trap: 0, hide: false };
    return f;
  }

  clear() {
    this.edges = { act: false, jab: false, heavy: false, map: false, cycle: 0, trap: 0, hide: false };
  }
}

// Next trap type that is still in stock; past the last one, put the trap away.
function cycleTrap(spy, dir) {
  const n = TRAPS.length;
  const cur = spy.armed ? TRAPS.findIndex((t) => t.id === spy.armed) : -1;
  for (let i = 1; i <= n; i++) {
    const j = cur + dir * i;
    if (j < 0 || j >= n) break;
    if (spy.traps[TRAPS[j].id] > 0) return j + 1;
  }
  return cur >= 0 ? cur + 1 : 0; // selecting the armed trap again puts it away
}

// Floating thumbstick: appears wherever the left thumb lands.
export function setupTouch(input, zone, nub, buttons) {
  let id = null, ox = 0, oy = 0;
  const R = 50;
  zone.addEventListener('pointerdown', (e) => {
    id = e.pointerId; ox = e.clientX; oy = e.clientY;
    zone.setPointerCapture(id);
    nub.style.display = 'block';
    nub.style.left = `${ox}px`; nub.style.top = `${oy}px`;
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    input.touchVec = [Math.abs(dx) > 8 ? dx / R : 0, Math.abs(dy) > 8 ? dy / R : 0];
    nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    input.touchVec = [0, 0];
    nub.style.display = 'none';
    nub.style.transform = 'translate(-50%, -50%)';
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  for (const btn of buttons) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.press(btn.dataset.btn);
      btn.classList.add('down');
    });
    const up = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
  }
}
