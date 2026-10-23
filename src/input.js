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

export class LocalInput {
  constructor() {
    this.held = new Set();
    this.edges = { act: false, jab: false, heavy: false, map: false, cycle: 0, trap: 0, hide: false };
    this.touchVec = [0, 0];
    this.padPrev = [];
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

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return [0, 0];
    const b = pad.buttons.map((x) => x.pressed);
    const edge = (i) => b[i] && !this.padPrev[i];
    if (edge(0)) this.edges.act = true;
    if (edge(2)) this.edges.jab = true;
    if (edge(3)) this.edges.heavy = true;
    if (edge(1)) this.edges.hide = true;
    if (edge(8)) this.edges.map = true;
    if (edge(5)) this.edges.cycle = 1;
    if (edge(4)) this.edges.cycle = -1;
    this.padPrev = b;
    let mx = Math.abs(pad.axes[0]) > DEADZONE ? pad.axes[0] : 0;
    let mz = Math.abs(pad.axes[1]) > DEADZONE ? pad.axes[1] : 0;
    if (b[14]) mx = -1;
    if (b[15]) mx = 1;
    if (b[12]) mz = -1;
    if (b[13]) mz = 1;
    return [mx, mz];
  }

  // One input frame for the simulation. Consumes the remembered presses.
  frame(state, spyIdx) {
    const [px, pz] = this.pollPad();
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
