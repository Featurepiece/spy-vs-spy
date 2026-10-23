// Wires the pieces together: menus, the fixed-step game loop, input, CPU,
// drawing and sound.

import { TUNING } from './tuning.js';
import { createGame, step, DT } from './sim.js';
import { CpuBrain } from './ai.js';
import { Renderer, W, HALF } from './render.js';
import { Audio } from './audio.js';
import { LocalInput, setupTouch } from './input.js';

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

let settings = { level: store.get('da.level', 0), iq: store.get('da.iq', 1) };
let screen = 'title';
let state = null, brain = null, acc = 0, last = performance.now(), overAt = 0;
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
  showOwnTraps: [true, false], // the computer's trap reminders stay hidden from you
};

function layout() {
  const touchOn = isTouch && screen !== 'title';
  $('touch').classList.toggle('on', touchOn);
  const vw = window.innerWidth - 16, vh = window.innerHeight - 16;
  const portrait = vh > vw;
  const reserve = touchOn ? (portrait ? Math.min(260, vh * 0.42) : 118) : 0;
  const h = HALF * viewOpts.views.length;
  const w = Math.min(vw, ((vh - reserve) * W) / h);
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor((w * h) / W)}px`;
  $('wrap').style.justifyContent = reserve ? 'flex-start' : 'center';
  renderer.resize();
}
window.addEventListener('resize', layout);

// ---------- menus ----------

function buildSeg(el, options, key) {
  el.innerHTML = '';
  options.forEach((o, i) => {
    const b = document.createElement('button');
    b.innerHTML = `${o.label}<small>${o.sub}</small>`;
    b.setAttribute('aria-pressed', String(settings[key] === i));
    b.onclick = () => {
      settings[key] = i;
      store.set(`da.${key}`, i);
      [...el.children].forEach((c, j) => c.setAttribute('aria-pressed', String(j === i)));
    };
    el.appendChild(b);
  });
}
buildSeg($('levelSeg'), TUNING.levels.map((l) => ({ label: l.name, sub: `${l.rooms} rooms · ${l.minutes} min` })), 'level');
buildSeg($('iqSeg'), TUNING.cpu.map((c, i) => ({ label: c.name, sub: ['sets few traps', 'a fair fight', 'sneaky and fierce'][i] })), 'iq');

function show(id) {
  for (const o of ['title', 'paused', 'over']) $(o).hidden = o !== id;
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
  if (on && screen === 'play') { screen = 'paused'; show('paused'); audio.stopMusic(); }
  else if (!on && screen === 'paused') { screen = 'play'; show(null); last = performance.now(); if (audio.musicOn) audio.startMusic(); }
}

function toMenu() {
  screen = 'title';
  audio.stopMusic();
  show('title');
  layout();
}

const RANKS = [
  [4000, 'Legend of the Trenchcoat'],
  [2500, 'Master of Disguise'],
  [1200, 'Field Agent'],
  [300, 'Junior Snoop'],
  [-Infinity, 'Desk Clerk'],
];
const rank = (pts) => RANKS.find(([min]) => pts >= min)[1];

function showGameOver() {
  screen = 'over';
  audio.stopMusic();
  const [me, cpu] = state.spies;
  $('overTitle').textContent = state.winner === 0 ? 'You escaped!' : state.winner === 1 ? 'Cobalt got away!' : 'Both planes left without you';
  $('overTitle').style.color = state.winner === 0 ? 'var(--gold)' : 'var(--ink)';
  $('overSub').textContent = state.winner === 0 ? `Rank: ${rank(me.score)}` : state.winner === 1 ? 'Better luck next mission.' : 'Nobody made it out in time.';
  $('overScores').innerHTML = [me, cpu].map((s, i) => `<div><span style="color:${i ? 'var(--blue)' : 'var(--red)'}">${s.name}</span><b>${s.score}</b>${s.items.length}/4 items · caught ${s.deaths}×</div>`).join('');
  show('over');
}

$('startBtn').onclick = startGame;
$('againBtn').onclick = startGame;
$('menuBtn').onclick = toMenu;
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
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (screen === 'play') pause(true);
    else if (screen === 'paused') pause(false);
  }
  if (e.code === 'KeyN') {
    audio.toggleMusic();
    if (audio.musicOn && screen === 'play') audio.startMusic();
    musicLabel();
  }
  if (e.code === 'Enter' && (screen === 'title' || screen === 'over')) {
    e.preventDefault();
    startGame();
  }
});
window.addEventListener('pointerdown', () => audio.unlock());
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

setupTouch(input, $('stickzone'), $('nub'), [...document.querySelectorAll('#pad button')]);

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
      if (state.over && !overAt) overAt = now + 1600;
    }
    if (overAt && now >= overAt) showGameOver();
  }
  if (state) renderer.draw(state, screen === 'play' ? dt : 0, viewOpts);
  window.__game = { state, screen }; // handy for tests and debugging
  requestAnimationFrame(frame);
}

layout();
show('title');
musicLabel();
requestAnimationFrame(frame);
