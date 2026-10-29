// Wires the pieces together: menus, the fixed-step game loop, input, CPU,
// drawing and sound.

import { TUNING } from './tuning.js';
import { createGame, step, DT } from './sim.js';
import { CpuBrain } from './ai.js';
import { Renderer, CANVAS_W, SLOT_H } from './render.js';
import { Audio } from './audio.js';
import { LocalInput, Gamepads, PAD, setupTouch } from './input.js';
import { setupTitle } from './title.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const audio = new Audio();
const input = new LocalInput();
const pads = new Gamepads();

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// Test hooks: ?autoplay lets a computer brain play Scarlet too; ?speed=N runs N times faster.
const params = new URLSearchParams(location.search);
const autoplay = params.has('autoplay');
const speed = Math.max(1, Number(params.get('speed')) || 1);
let playerBrain = null;

let settings = { level: store.get('da.level', 0), iq: store.get('da.iq', 1) };
let screen = 'title';
let state = null, brain = null, acc = 0, last = performance.now(), overAt = 0, endT = 0;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

// ---------- layout ----------

const viewOpts = {
  // On touch screens only your own half is shown, so it can be bigger.
  views: isTouch ? [0] : [0, 1],
  hints: [true, false],
  labels: ['YOU', 'CPU'],
  showOwnTraps: [true, false], // the computer's trap reminders stay hidden from you
};

// The button names in on-screen hints follow whatever was used last:
// keyboard, touch or controller.
function setHintLabels() {
  if (pads.active) {
    const L = pads.labels;
    Object.assign(viewOpts, { keyLabels: [false, false], actKey: L.a, fightKeys: `${L.x} / ${L.y}`, hideKey: L.b, mapKey: L.back, continueText: `Press ${L.a} to return to the menu` });
  } else {
    Object.assign(viewOpts, {
      keyLabels: [!isTouch, false],
      actKey: isTouch ? 'Use' : 'Space',
      fightKeys: isTouch ? 'Jab / Smash' : 'J / K',
      hideKey: isTouch ? 'Hide' : 'H',
      mapKey: isTouch ? 'Map' : 'M',
      continueText: isTouch ? 'Tap to return to the menu' : 'Press Enter to return to the menu',
    });
  }
  title.setHint(pads.active ? pads.labels : null);
}

function layout() {
  // A phone or tablet with a controller plugged in doesn't need the touch buttons.
  const touchOn = isTouch && screen !== 'title' && !pads.active;
  $('touch').classList.toggle('on', touchOn);
  const vw = window.innerWidth - 16, vh = window.innerHeight - 16;
  const portrait = vh > vw;
  const reserve = touchOn ? (portrait ? Math.min(260, vh * 0.42) : 118) : 0;
  const h = SLOT_H * viewOpts.views.length;
  const w = Math.min(vw, ((vh - reserve) * CANVAS_W) / h);
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor((w * h) / CANVAS_W)}px`;
  $('wrap').style.justifyContent = reserve ? 'flex-start' : 'center';
  renderer.resize();
}
window.addEventListener('resize', layout);

// ---------- menus ----------

const title = setupTitle({
  settings,
  save: (key, v) => store.set(`da.${key}`, v),
  onStart: () => startGame(),
  isTouch,
});

// Attract mode: behind the front menu the monitors show two computer spies playing.
const demoOpts = { ...viewOpts, hints: [false, false], keyLabels: [false, false], labels: [null, null], showOwnTraps: [false, false] };
let demo = null;
function newDemo() {
  const seed = (Math.random() * 2 ** 31) | 0;
  demo = { state: createGame({ level: 0, cpuIq: 1, seed }), brains: [new CpuBrain(0, 1, seed ^ 0x2468ace), new CpuBrain(1, 1, seed ^ 0x13579b)], acc: 0 };
  renderer.fx = [];
}
function runDemo(dt) {
  if (!demo || demo.state.over) newDemo();
  demo.acc += dt;
  while (demo.acc >= DT) {
    demo.acc -= DT;
    const st = demo.state;
    step(st, [demo.brains[0].think(st), demo.brains[1].think(st)]);
    demo.brains.forEach((b) => b.observe(st, st.events));
    renderer.handleEvents(st, st.events);
  }
  renderer.draw(demo.state, dt, demoOpts);
}

function show(id) {
  for (const o of ['title', 'paused']) $(o).hidden = o !== id;
}

// The pause card: arrows (or a controller) move between Resume and Quit.
const pauseBtns = [$('resumeBtn'), $('quitBtn')];
let pauseSel = 0;
function pauseRefresh() { pauseBtns.forEach((b, i) => b.classList.toggle('sel', i === pauseSel)); }
function pauseKey(code) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(code)) { pauseSel = 1 - pauseSel; pauseRefresh(); }
  else if (code === 'Enter' || code === 'Space') pauseBtns[pauseSel].click();
  else if (code === 'Escape' || code === 'KeyP') pause(false);
}

function startGame() {
  audio.unlock();
  const seed = (Math.random() * 2 ** 31) | 0;
  state = createGame({ level: settings.level, cpuIq: settings.iq, seed });
  brain = new CpuBrain(1, settings.iq, seed ^ 0x5bd1e995);
  playerBrain = autoplay ? new CpuBrain(0, 2, seed ^ 0x1234567) : null;
  renderer.fx = [];
  renderer.views.forEach((v) => Object.assign(v, { shake: 0, fade: 0, lastRoom: null, msg: null, msgT: 0, flash: 0 }));
  renderer.views[0].msg = 'Find the four items and the briefcase!';
  renderer.views[0].msgT = 4;
  input.clear();
  acc = 0;
  overAt = 0;
  screen = 'play';
  show(null);
  layout();
  if (audio.musicOn) audio.startMusic();
}

function pause(on) {
  if (on && screen === 'play') { screen = 'paused'; pauseSel = 0; pauseRefresh(); show('paused'); audio.stopMusic(); }
  else if (!on && screen === 'paused') { screen = 'play'; show(null); last = performance.now(); if (audio.musicOn) audio.startMusic(); }
}

function toMenu() {
  titleMusic.currentTime = 0;
  screen = 'title';
  audio.stopMusic();
  title.reset();
  newDemo();
  show('title');
  layout();
}

// The ending: the winner's half becomes an airfield and they fly off, then back to the menu.
function startEnding() {
  screen = 'ending';
  endT = 0;
  audio.stopMusic();
  audio.ending(state.winner === null ? null : state.winner === 0, TUNING.ending);
  layout();
}

function endingSkip() {
  if (screen === 'ending' && endT > TUNING.ending.continueAt) toMenu();
}

$('resumeBtn').onclick = () => pause(false);
$('quitBtn').onclick = toMenu;
$('pauseBtn').onclick = () => (screen === 'play' ? pause(true) : pause(false));
const musicLabel = () => ($('musicBtn').textContent = audio.musicOn ? '♪ Music' : '♪ Off');
$('musicBtn').onclick = () => {
  audio.unlock();
  audio.toggleMusic();
  if (audio.musicOn && screen === 'play') audio.startMusic();
  musicLabel();
};

window.addEventListener('keydown', (e) => {
  audio.unlock();
  usedKeysOrTouch();
  if (screen === 'ending') {
    if (['Enter', 'Space', 'Escape'].includes(e.code)) { e.preventDefault(); endingSkip(); }
    return;
  }
  if (screen === 'paused') {
    if (!e.repeat) pauseKey(e.code);
    if (['Enter', 'Space'].includes(e.code)) e.preventDefault();
  } else if (screen === 'play' && (e.code === 'Escape' || e.code === 'KeyP')) pause(true);
  if (e.code === 'KeyN') {
    audio.toggleMusic();
    if (audio.musicOn && screen === 'play') audio.startMusic();
    musicLabel();
  }
  if (screen === 'title') {
    title.onKey(e.code);
    return;
  }
});
window.addEventListener('pointerdown', () => { audio.unlock(); usedKeysOrTouch(); endingSkip(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
// Pause if the controller drops out (flat battery, cable pulled) mid-game.
window.addEventListener('gamepaddisconnected', () => { if (pads.active) pause(true); });

function usedKeysOrTouch() {
  if (!pads.active) return;
  pads.active = false;
  setHintLabels();
  layout();
}

// ---------- controller ----------

// Menus get the controller as if it were arrow keys plus Enter and Escape, so
// they share the keyboard code. Holding a direction repeats, like a held key.
const REPEAT_FIRST = 0.4, REPEAT_EVERY = 0.15;
let navDir = null, navT = 0;
function padDirection(pad, dt) {
  const [x, z] = pad.move;
  const dir = Math.max(Math.abs(x), Math.abs(z)) < 0.5 ? null
    : Math.abs(x) > Math.abs(z) ? (x < 0 ? 'ArrowLeft' : 'ArrowRight') : (z < 0 ? 'ArrowUp' : 'ArrowDown');
  if (dir !== navDir) { navDir = dir; navT = REPEAT_FIRST; return dir; }
  if (!dir) return null;
  navT -= dt;
  if (navT > 0) return null;
  navT = REPEAT_EVERY;
  return dir;
}

function handlePad(dt) {
  const wasActive = pads.active;
  const labels = pads.labels;
  const pad = pads.poll();
  const p = pad.pressed;
  if (pad.active !== wasActive || pad.labels !== labels) { setHintLabels(); layout(); }
  if (p.size) { interacted = true; audio.unlock(); }
  const dir = padDirection(pad, dt);
  if (screen === 'play') {
    input.usePad(pad);
    if (p.has(PAD.start)) pause(true);
  } else if (screen === 'paused') {
    if (dir) pauseKey(dir);
    if (p.has(PAD.a)) pauseKey('Enter');
    else if (p.has(PAD.start) || p.has(PAD.b)) pause(false);
  } else if (screen === 'title') {
    if (dir) title.onKey(dir);
    if (p.has(PAD.a) || p.has(PAD.start)) title.onKey('Enter');
    else if (p.has(PAD.b)) title.onKey('Escape');
  } else if (screen === 'ending') {
    if (p.has(PAD.a) || p.has(PAD.b) || p.has(PAD.start)) endingSkip();
  }
}

setupTouch(input, $('stickzone'), $('nub'), [...document.querySelectorAll('#pad button')]);

// ---------- title music ----------

// Steven's theme (made with Suno) plays on the front menu only. Browsers won't
// start sound before the first key press or tap, so it waits for one.
const titleMusic = document.createElement('audio');
titleMusic.src = 'assets/music/title-theme.mp3';
titleMusic.loop = true;
titleMusic.volume = 0.5;
titleMusic.preload = 'auto';
let interacted = false;
function updateTitleMusic() {
  const want = interacted && screen === 'title' && audio.musicOn;
  if (want && titleMusic.paused) titleMusic.play().catch(() => { interacted = false; });
  else if (!want && !titleMusic.paused) titleMusic.pause();
}
for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => { interacted = true; });

// ---------- loop ----------


function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  handlePad(dt);
  if (screen === 'play') {
    acc += dt * speed;
    while (acc >= DT) {
      acc -= DT;
      const inputs = [playerBrain ? playerBrain.think(state) : input.frame(state, 0), brain.think(state)];
      step(state, inputs);
      brain.observe(state, state.events);
      if (playerBrain) playerBrain.observe(state, state.events);
      renderer.handleEvents(state, state.events);
      for (const e of state.events) audio.play(e, state, 0);
      if (state.over && !overAt) overAt = now + TUNING.ending.delay * 1000;
    }
    if (overAt && now >= overAt) startEnding();
  }
  if (screen === 'ending') {
    endT += dt;
    if (endT > TUNING.ending.autoReturn) toMenu();
  }
  if (screen === 'title') runDemo(dt);
  else if (state && screen === 'ending') {
    // On phones only one half is shown, so show the winner's airfield.
    const views = viewOpts.views.length === 1 ? [state.winner ?? 0] : viewOpts.views;
    renderer.draw(state, dt, { ...viewOpts, views, ending: { t: endT } });
  } else if (state) renderer.draw(state, screen === 'play' ? dt : 0, viewOpts);
  updateTitleMusic();
  window.__game = { state, screen, titleMusic: !titleMusic.paused }; // handy for tests and debugging
  requestAnimationFrame(frame);
}

setHintLabels();
layout();
show('title');
musicLabel();
requestAnimationFrame(frame);
