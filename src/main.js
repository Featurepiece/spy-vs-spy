// Wires the pieces together: menus, the fixed-step game loop, input, CPU,
// drawing and sound.

import { TUNING } from './tuning.js';
import { createGame, step, DT } from './sim.js';
import { CpuBrain } from './ai.js';
import { Renderer, CANVAS_W, SLOT_H } from './render.js';
import { Audio } from './audio.js';
import { LocalInput, setupTouch } from './input.js';
import { setupTitle } from './title.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const audio = new Audio();
const input = new LocalInput();

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// Test hooks: ?autoplay lets a computer brain play Scarlet too; ?speed=N runs N times faster.
const params = new URLSearchParams(location.search);
const autoplay = params.has('autoplay');
const speed = Math.max(1, Number(params.get('speed')) || 1);
let playerBrain = null;

let settings = { level: store.get('da.level', 0), iq: store.get('da.iq', 1), music: store.get('da.music', 7), sfx: store.get('da.sfx', 8), musicOn: store.get('da.musicOn', true) };
audio.setSfxVolume(settings.sfx);
let screen = 'title';
let state = null, brain = null, acc = 0, last = performance.now(), overAt = 0, endT = 0;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

// ---------- layout ----------

const viewOpts = {
  // On touch screens only your own half is shown, so it can be bigger.
  views: isTouch ? [0] : [0, 1],
  hints: [true, false],
  keyLabels: [!isTouch, false],
  labels: ['YOU', 'CPU'],
  actKey: isTouch ? 'Use' : 'Space',
  fightKeys: isTouch ? 'Jab / Smash' : 'J / K',
  hideKey: isTouch ? 'Hide' : 'H',
  continueText: isTouch ? 'Tap to return to the menu' : 'Press Enter to return to the menu',
  showOwnTraps: [true, false], // the computer's trap reminders stay hidden from you
};

function layout() {
  const touchOn = isTouch && screen !== 'title';
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
  // A short sound so you can hear the new effects volume.
  onChange: (key) => { if (key === 'sfx') { audio.unlock(); audio.setSfxVolume(settings.sfx); audio.play({ type: 'pickup', spy: 0 }, { spies: [{}] }, 0); } },
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
  gameMusic.currentTime = 0;
}

function pause(on) {
  if (on && screen === 'play') { screen = 'paused'; show('paused'); }
  else if (!on && screen === 'paused') { screen = 'play'; show(null); last = performance.now(); }
}

function toMenu() {
  titleMusic.currentTime = 0;
  screen = 'title';
  title.reset();
  newDemo();
  show('title');
  layout();
}

// The ending: the winner's half becomes an airfield and they fly off, then back to the menu.
function startEnding() {
  screen = 'ending';
  endT = 0;
  audio.ending(state.winner === null ? null : state.winner === 0, TUNING.ending);
  layout();
}

function endingSkip() {
  if (screen === 'ending' && endT > TUNING.ending.continueAt) toMenu();
}

$('resumeBtn').onclick = () => pause(false);
$('quitBtn').onclick = toMenu;
$('pauseBtn').onclick = () => (screen === 'play' ? pause(true) : pause(false));
const musicLabel = () => ($('musicBtn').textContent = settings.musicOn ? '♪ Music' : '♪ Off');
function toggleMusic() {
  settings.musicOn = !settings.musicOn;
  store.set('da.musicOn', settings.musicOn);
  musicLabel();
}
$('musicBtn').onclick = toggleMusic;

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (screen === 'ending') {
    if (['Enter', 'Space', 'Escape'].includes(e.code)) { e.preventDefault(); endingSkip(); }
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (screen === 'play') pause(true);
    else if (screen === 'paused') pause(false);
  }
  if (e.code === 'KeyN') toggleMusic();
  if (screen === 'title') {
    title.onKey(e.code);
    return;
  }
});
window.addEventListener('pointerdown', () => { audio.unlock(); endingSkip(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

setupTouch(input, $('stickzone'), $('nub'), [...document.querySelectorAll('#pad button')]);

// ---------- music ----------

// Steven's tracks (made with Suno), used exactly as supplied: one for the front
// menu, one during play. Pausing or the ending stops the game track; it starts
// again from the top each mission. Browsers won't start sound before the first
// key press or tap, so both wait for one.
function track(src) {
  const a = document.createElement('audio');
  a.src = src;
  a.loop = true;
  a.preload = 'auto';
  return a;
}
const titleMusic = track('assets/music/title-theme.mp3');
const gameMusic = track('assets/music/game-theme.mp3');
let interacted = false;
function updateMusic() {
  const vol = settings.musicOn ? (settings.music / 10) ** 2 : 0;
  const want = !interacted || vol === 0 ? null : screen === 'title' ? titleMusic : screen === 'play' ? gameMusic : null;
  for (const m of [titleMusic, gameMusic]) {
    m.volume = vol;
    if (m === want && m.paused) m.play().catch(() => { interacted = false; });
    else if (m !== want && !m.paused) m.pause();
  }
}
for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => { interacted = true; });

// ---------- loop ----------


function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
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
  updateMusic();
  window.__game = { state, screen, settings, titleMusic: !titleMusic.paused, gameMusic: !gameMusic.paused }; // handy for tests and debugging
  requestAnimationFrame(frame);
}

layout();
show('title');
musicLabel();
requestAnimationFrame(frame);
