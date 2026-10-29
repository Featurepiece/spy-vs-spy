// Draws the game with plain canvas shapes: no image files. Each half of the
// screen is a security monitor showing one spy's room, with their gadget
// panel beside it.

import { TUNING } from './tuning.js';
import { ITEMS, TRAPS, TRAP_BY_ID } from './data.js';
import { getFocus, inCombat, remedyName } from './sim.js';

export const W = 960, H = 640, HALF = 320, VIEW_W = 720;

// The canvas holds one "slot" per camera: a monitor casing around the 720x320
// room picture, and the gadget beside it. Rooms and panels are drawn in the
// old 960x320 half-screen coordinates and shifted into place.
export const CANVAS_W = 1048, SLOT_H = 374;
const SCREEN_X = 24, SCREEN_Y = 20; // top-left of the room picture inside a slot
const PANEL_DX = 46; // how far right of the screen's edge the gadget panel sits
const SCREEN_R = 16; // rounded corners of the picture tube
const DISPLAY_FONT = '"Black Ops One", system-ui, sans-serif';

// Room projection (half-screen coordinates). See docs/ARCHITECTURE.md.
const CX = 360, BACK_Y = 150, FRONT_Y = 306, BACK_HW = 210, FRONT_HW = 336, TOP_BACK = 44, TOP_FRONT = 14;
const fy = (z) => BACK_Y + (FRONT_Y - BACK_Y) * z;
const fhw = (z) => BACK_HW + (FRONT_HW - BACK_HW) * z;
const fx = (x, z) => CX + (x - 0.5) * 2 * fhw(z);
const fs = (z) => fhw(z) / BACK_HW;
// A point on a side wall at depth z, h pixels (back-wall scale) above the floor.
const wallPt = (side, z, h) => [side === 'w' ? fx(0, z) : fx(1, z), fy(z) - h * fs(z)];

export const SPY_COLORS = [
  { coat: '#d8473f', dark: '#8e1f1a', band: '#f4c64e', ui: '#ff6b5e' },
  { coat: '#3b72dc', dark: '#1b3a7c', band: '#8fe3ff', ui: '#6aa8ff' },
];

const PALETTES = [
  { wall: '#c9b48a', stripe: '#bba577', side: '#a8946c', floor: '#7a5a3a', floor2: '#6b4e32', ceil: '#3a3128' },
  { wall: '#8fb3a5', stripe: '#82a597', side: '#6f9083', floor: '#5f5446', floor2: '#544a3d', ceil: '#27332f' },
  { wall: '#c79a9a', stripe: '#b98c8c', side: '#a37878', floor: '#6e5440', floor2: '#614938', ceil: '#3a2a2a' },
  { wall: '#a7a8cf', stripe: '#999ac1', side: '#8687ab', floor: '#5c5a6a', floor2: '#52505e', ceil: '#2b2b3a' },
  { wall: '#d4c27a', stripe: '#c6b46c', side: '#ad9d5d', floor: '#6d4f36', floor2: '#5f442e', ceil: '#3a3420' },
  { wall: '#9cc0d6', stripe: '#8eb2c8', side: '#7a9bb0', floor: '#5d5249', floor2: '#52483f', ceil: '#26323a' },
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fx = []; // particles and score pops, in floor coordinates
    this.views = [0, 1].map(() => ({ shake: 0, fade: 0, lastRoom: null, msg: null, msgT: 0, flash: 0 }));
    this.time = 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.scale = this.canvas.width / CANVAS_W;
  }

  // Turn simulation events into effects.
  handleEvents(state, events) {
    for (const e of events) {
      const room = e.room ?? (e.spy !== undefined ? state.spies[e.spy].room : null);
      switch (e.type) {
        case 'msg': {
          const v = this.views[e.spy];
          v.msg = e.text; v.msgT = 2.8;
          break;
        }
        case 'score':
          this.fx.push({ kind: 'text', room, x: e.x, z: e.z, h: 90, vy: 34, life: 1.4, max: 1.4, text: `${e.pts > 0 ? '+' : ''}${e.pts} ${e.label}`, color: e.pts > 0 ? '#ffe066' : '#ff7b7b' });
          break;
        case 'hit':
          this.burst(room, e.x, e.z, 50, e.heavy ? 12 : 6, ['#fff', '#ffe066'], 120);
          this.shakeRoom(state, room, e.heavy ? TUNING.juice.shakeHit * 2 : TUNING.juice.shakeHit);
          break;
        case 'trap':
          this.trapFx(state, e);
          break;
        case 'explode':
          this.burst(room, e.x, e.z, 20, 40, ['#ffb000', '#ff5a00', '#444', '#ffe066'], 260);
          this.shakeRoom(state, room, TUNING.juice.shakeBomb * 1.3);
          this.flashRoom(state, room);
          break;
        case 'pickup':
          this.burst(room, e.x, e.z, 60, 14, ['#fff7a8', '#ffe066', '#ffffff'], 90, -60);
          break;
        case 'death':
          this.burst(room, e.x, e.z, 30, 12, ['#ddd', '#bbb', '#fff'], 60, -40);
          break;
        case 'defuse':
          this.burst(room, state.spies[e.spy].x, state.spies[e.spy].z, 60, 10, ['#9effa0', '#fff'], 90, -40);
          break;
        case 'guard':
          this.fx.push({ kind: 'boot', room, side: e.side, life: 0.6, max: 0.6 });
          this.shakeRoom(state, room, 4);
          break;
        case 'meet':
          for (const v of this.views) v.flash = 0.5;
          break;
      }
    }
  }

  trapFx(state, e) {
    const { room, x, z } = e;
    if (e.trap === 'bomb') {
      this.burst(room, x, z, 40, 36, ['#ffb000', '#ff5a00', '#555', '#ffe066'], 240);
      this.shakeRoom(state, room, TUNING.juice.shakeBomb);
      this.flashRoom(state, room);
    } else if (e.trap === 'spring') {
      this.fx.push({ kind: 'spring', room, x, z, life: 0.8, max: 0.8 });
      this.shakeRoom(state, room, 3);
    } else if (e.trap === 'bucket') {
      this.burst(room, x, z, 110, 26, ['#7fd4ff', '#bfeaff', '#3aa0e0'], 80, 40);
      this.fx.push({ kind: 'bucket', room, x, z, life: 0.7, max: 0.7 });
    } else if (e.trap === 'gun') {
      this.burst(room, x, z, 55, 10, ['#fff', '#ffcc00'], 160);
      this.fx.push({ kind: 'bang', room, x, z, life: 0.5, max: 0.5 });
      this.shakeRoom(state, room, 4);
    }
  }

  burst(room, x, z, h, n, colors, speed, lift = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.fx.push({ kind: 'p', room, x, z, h, px: Math.cos(a) * sp, py: Math.sin(a) * sp * 0.8 + lift, life: 0.5 + Math.random() * 0.5, max: 1, color: colors[i % colors.length], size: 2 + Math.random() * 3, ox: 0, oy: 0 });
    }
  }

  shakeRoom(state, room, amt) {
    state.spies.forEach((s, i) => { if (s.room === room) this.views[i].shake = Math.max(this.views[i].shake, amt); });
  }

  flashRoom(state, room) {
    state.spies.forEach((s, i) => { if (s.room === room) this.views[i].flash = Math.max(this.views[i].flash, 0.35); });
  }

  draw(state, dt, opts) {
    this.time += dt;
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, SLOT_H * 2);
    bg.addColorStop(0, '#1b2742'); bg.addColorStop(1, '#121a2e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, SLOT_H * 2);

    for (const f of this.fx) {
      f.life -= dt;
      if (f.kind === 'p') { f.ox += f.px * dt; f.oy += f.py * dt; f.py += 260 * dt; }
      if (f.kind === 'text') f.h += f.vy * dt;
    }
    this.fx = this.fx.filter((f) => f.life > 0);

    const order = opts.views; // which spy each half shows, top first
    order.forEach((spyIdx, half) => {
      if (spyIdx === null) return;
      ctx.save();
      ctx.translate(0, half * SLOT_H);
      this.drawGadgetBody(spyIdx);
      ctx.save();
      ctx.translate(SCREEN_X, SCREEN_Y);
      this.drawHalf(state, spyIdx, dt, opts);
      this.drawGlass(spyIdx);
      ctx.restore();
      this.drawMonitor(state, spyIdx);
      ctx.restore();
    });
  }

  // ---------- the security monitors ----------

  // The casing goes on last, so anything that spills past the picture (screen
  // shake, effects) is hidden behind the bezel.
  drawMonitor(state, viewer) {
    const ctx = this.ctx;
    const x = 6, y = 6, w = VIEW_W + 36, h = HALF + 56;
    const sx = SCREEN_X, sy = SCREEN_Y;
    const shell = ctx.createLinearGradient(0, y, 0, y + h);
    shell.addColorStop(0, '#7a8293'); shell.addColorStop(0.08, '#5d6575'); shell.addColorStop(1, '#3d4350');
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, 22);
    roundRectPath(ctx, sx, sy, VIEW_W, HALF, SCREEN_R);
    ctx.fillStyle = shell;
    ctx.fill('evenodd');
    // Dark inner bezel ring around the glass
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#16181d';
    roundRect(ctx, sx - 3, sy - 3, VIEW_W + 6, HALF + 6, SCREEN_R + 3); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 21); ctx.stroke();
    // Name plate under the screen
    const col = SPY_COLORS[viewer];
    const name = state ? state.spies[viewer].name.toUpperCase() : '';
    const py = sy + HALF + 8, pw = 220, px = x + w / 2 - pw / 2;
    ctx.fillStyle = '#1c1f26';
    roundRect(ctx, px, py, pw, 20, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    roundRect(ctx, px + 0.5, py + 0.5, pw - 1, 19, 4); ctx.stroke();
    ctx.font = `14px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col.ui;
    ctx.fillText(`CAM ${viewer + 1} · ${name}`, px + pw / 2, py + 11);
    // Screws, power light and two knobs
    ctx.fillStyle = '#2a2e37';
    for (const [cx, cy] of [[x + 12, y + 12], [x + w - 12, y + 12], [x + 12, y + h - 12], [x + w - 12, y + h - 12]]) {
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#5dff7a';
    ctx.shadowColor = '#5dff7a'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x + w - 40, py + 10, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    for (const kx of [x + 40, x + 66]) {
      ctx.fillStyle = '#23262d';
      ctx.beginPath(); ctx.arc(kx, py + 10, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8d95a5'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(kx, py + 10); ctx.lineTo(kx + 5, py + 5); ctx.stroke();
    }
    ctx.restore();
  }

  // Scanlines, a darker rim, a soft reflection and the camera caption, over the picture.
  drawGlass(viewer) {
    const ctx = this.ctx;
    if (!this.scanlines) {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 3;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,0.13)';
      g.fillRect(0, 2, 4, 1);
      this.scanlines = ctx.createPattern(c, 'repeat');
    }
    ctx.save();
    roundRect(ctx, 0, 0, VIEW_W, HALF, SCREEN_R);
    ctx.clip();
    ctx.fillStyle = this.scanlines;
    ctx.fillRect(0, 0, VIEW_W, HALF);
    const vig = ctx.createRadialGradient(VIEW_W / 2, HALF / 2, HALF * 0.55, VIEW_W / 2, HALF / 2, VIEW_W * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, VIEW_W, HALF);
    const glare = ctx.createLinearGradient(0, 0, VIEW_W * 0.6, HALF);
    glare.addColorStop(0, 'rgba(255,255,255,0.07)'); glare.addColorStop(0.35, 'rgba(255,255,255,0.02)'); glare.addColorStop(0.36, 'rgba(255,255,255,0)');
    ctx.fillStyle = glare;
    ctx.fillRect(0, 0, VIEW_W, HALF);
    // Camera caption, top left
    ctx.font = `12px ${DISPLAY_FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, 10, 8, 78, 18, 3); ctx.fill();
    if (Math.sin(this.time * 4) > -0.3) {
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath(); ctx.arc(20, 17, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`REC  CAM ${viewer + 1}`, 29, 18);
    ctx.restore();
  }

  // The gadget's own case behind its panel, and the curly cable to the monitor.
  drawGadgetBody(viewer) {
    const ctx = this.ctx;
    const col = SPY_COLORS[viewer];
    const x = SCREEN_X + VIEW_W + PANEL_DX - 9, y = SCREEN_Y - 10, w = W - VIEW_W + 18, h = HALF + 20;
    ctx.save();
    // Coiled cable from the bottom of the gadget round to the monitor's side
    ctx.strokeStyle = '#4a5162'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    const cx0 = x + 40, cy0 = y + h, cx1 = SCREEN_X + VIEW_W + 12, cy1 = SCREEN_Y + HALF + 8;
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const bx = cx0 + (cx1 - cx0) * t, by = cy0 + 8 * Math.sin(Math.PI * t) + (cy1 - cy0) * t;
      const px = bx + Math.cos(t * Math.PI * 18) * 5, py = by + Math.sin(t * Math.PI * 18) * 5;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
    // Stubby antenna
    ctx.fillStyle = '#2b2f38';
    roundRect(ctx, x + w - 36, y - 5, 18, 10, 3); ctx.fill();
    ctx.fillStyle = col.coat;
    ctx.beginPath(); ctx.arc(x + w - 27, y - 3, 3.5, 0, Math.PI * 2); ctx.fill();
    // Case
    const body = ctx.createLinearGradient(x, 0, x + w, 0);
    body.addColorStop(0, '#4a5060'); body.addColorStop(1, '#30343e');
    ctx.fillStyle = body;
    roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 13); ctx.stroke();
    ctx.restore();
  }

  drawHalf(state, viewer, dt, opts) {
    if (opts.ending) {
      this.drawEndingHalf(state, viewer, opts);
      return;
    }
    const ctx = this.ctx;
    const spy = state.spies[viewer];
    const v = this.views[viewer];
    if (v.lastRoom !== spy.room) {
      if (v.lastRoom !== null) v.fade = TUNING.juice.fade;
      v.lastRoom = spy.room;
    }

    ctx.save();
    roundRect(ctx, 0, 0, VIEW_W, HALF, SCREEN_R);
    ctx.clip();
    if (v.shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * v.shake * 2, (Math.random() - 0.5) * v.shake * 2);
      v.shake = Math.max(0, v.shake - TUNING.juice.shakeDecay * dt * v.shake * 0.5 - dt * 4);
    }
    this.drawRoom(state, spy.room, viewer, opts);
    if (spy.mapOpen) this.drawMap(state, spy, opts);
    if (v.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, v.flash)})`;
      ctx.fillRect(-10, -10, VIEW_W + 20, HALF + 20);
      v.flash -= dt * 1.6;
    }
    if (v.fade > 0) {
      // Switching cameras: the picture drops out to static for a moment.
      const k = v.fade / TUNING.juice.fade;
      ctx.fillStyle = `rgba(0,0,0,${k * 0.7})`;
      ctx.fillRect(-10, -10, VIEW_W + 20, HALF + 20);
      this.drawStatic(k * 0.75);
      v.fade -= dt;
    }
    if (!spy.mapOpen && state.level < TUNING.crumbs.offFromLevel) this.drawCrumbs(spy);
    if (!spy.mapOpen) this.drawBanner(state, spy, viewer, opts);
    if (v.msgT > 0) {
      v.msgT -= dt;
      ctx.globalAlpha = Math.min(1, v.msgT * 2);
      this.label(v.msg, VIEW_W / 2, HALF - 16, 15, '#fff', 'rgba(0,0,0,0.65)');
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    this.drawPanel(state, spy, viewer, opts);
  }

  // ---------- the ending ----------

  // The winner's half becomes an airfield and they fly off; the loser's half goes blank [seen].
  drawEndingHalf(state, viewer, opts) {
    const ctx = this.ctx;
    const t = opts.ending.t;
    const spy = state.spies[viewer];
    if (state.winner !== viewer) {
      // The camera feed is switched off; the gadget stays lit.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIEW_W, HALF);
      this.drawPanel(state, spy, viewer, opts);
      if (state.winner === null) {
        // Nobody escaped [ours]: the plane leaves without either spy.
        this.label('OUT OF TIME', VIEW_W / 2, HALF / 2 - 14, 28, SPY_COLORS[viewer].ui, null, 'bold');
        this.label('The plane left without you', VIEW_W / 2, HALF / 2 + 18, 14, '#c9d1dc', null);
      }
      if (opts.hints[viewer] && t > TUNING.ending.continueAt) this.label(opts.continueText, VIEW_W / 2, HALF - 20, 12, '#8d96a3', null);
      return;
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VIEW_W, HALF); ctx.clip();
    drawAirfield(ctx, t, this.time);
    const E = TUNING.ending;
    const col = SPY_COLORS[viewer];
    const ground = 268;
    const ease = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
    // Plane: parked, then taxis right, then climbs away.
    const taxi = ease(...E.taxi), lift = ease(...E.takeoff);
    let px = 360 + taxi * taxi * 120, py = ground, ang = 0, ps = 1.7;
    if (lift > 0) {
      px = 480 + lift * 300;
      py = ground - lift * lift * 260;
      ang = -0.3 * Math.min(1, lift * 3);
      ps = 1.7 * (1 - lift * 0.6);
    }
    const engineOn = t > E.board[1] + 0.2;
    const boarded = t >= E.board[1];
    drawPlane(ctx, px, py, ps, ang, col, engineOn ? this.time : null, boarded);
    if (lift > 0.02 && lift < 0.6) {
      ctx.fillStyle = 'rgba(220,220,220,0.35)';
      ctx.beginPath(); ctx.ellipse(px - 110, ground - 2, 28 * (1 - lift), 6, 0, 0, Math.PI * 2); ctx.fill();
    }
    // The spy walks from the hangar door to the plane and climbs in.
    if (!boarded) {
      const w = ease(...E.walk), b = ease(...E.board);
      const sx = 130 + w * 236, sy = ground - b * 40;
      ctx.globalAlpha = 1 - b * 0.9;
      drawSpyFigure(ctx, sx, sy, 0.6 * (1 - b * 0.2), 1, { pose: w > 0 && w < 1 ? 'walk' : 'idle', col, walk: t * 9, t: this.time });
      ctx.globalAlpha = 1;
    }
    // Score and rank [seen: score and a jokey rank over the airfield; our wording].
    if (t > E.rankAt) {
      ctx.globalAlpha = Math.min(1, (t - E.rankAt) * 2);
      this.label(spy.score.toLocaleString('en-GB'), VIEW_W / 2, 58, 40, '#ffffff', 'rgba(10,20,40,0.45)', 'bold');
      this.label(`RANK: ${rankFor(spy.score).toUpperCase()}`, VIEW_W / 2, 102, 18, '#ffe066', 'rgba(10,20,40,0.45)', 'bold');
      ctx.globalAlpha = 1;
    }
    if (opts.hints[viewer] && t > E.continueAt) this.label(opts.continueText, VIEW_W / 2, HALF - 12, 12, '#ffffff', 'rgba(0,0,0,0.45)');
    if (t < E.fadeIn) {
      ctx.fillStyle = `rgba(0,0,0,${1 - t / E.fadeIn})`;
      ctx.fillRect(0, 0, VIEW_W, HALF);
    }
    ctx.restore();
    this.drawPanel(state, spy, viewer, opts);
  }

  drawStatic(alpha) {
    const ctx = this.ctx;
    if (!this.noise) {
      this.noise = [0, 1, 2].map(() => {
        const c = document.createElement('canvas');
        c.width = 180; c.height = 80;
        const g = c.getContext('2d');
        const img = g.createImageData(c.width, c.height);
        for (let i = 0; i < img.data.length; i += 4) {
          const n = Math.random() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
          img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        return c;
      });
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.noise[Math.floor(Math.random() * 3)], 0, 0, VIEW_W, HALF);
    ctx.restore();
  }

  // Bread crumbs: read right to left, each arrow is the door to take to go back one room.
  drawCrumbs(spy) {
    if (!spy.trail.length) return;
    const ctx = this.ctx;
    const glyph = { n: '↑', s: '↓', w: '←', e: '→' };
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    spy.trail.forEach((side, i) => {
      const newest = i === spy.trail.length - 1;
      ctx.fillStyle = newest ? '#ffe066' : 'rgba(255,255,255,0.55)';
      ctx.fillText(glyph[side], 40 + i * 18, FRONT_Y + 7);
    });
  }

  drawBanner(state, spy, viewer, opts) {
    const ctx = this.ctx;
    let text = null, sub = null;
    if (spy.state === 'dead') {
      text = 'GOT YOU!';
      sub = `Back in ${Math.ceil(spy.stateT)}s · −${TUNING.time.deathPenalty}s on the clock`;
    } else if (spy.state === 'out') text = 'OUT OF TIME';
    else if (spy.state === 'escaped') text = 'ESCAPED!';
    else if (inCombat(state, spy) && opts.hints[viewer]) sub = `Rival here! Fight (${opts.fightKeys}) or run. No searching or traps.`;
    else if (state.truce && opts.hints[viewer]) sub = 'Truce until one of you leaves this room';
    if (text) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 110, VIEW_W, 70);
      this.label(text, VIEW_W / 2, 140, 30, SPY_COLORS[viewer].ui, null, 'bold');
    }
    if (sub) this.label(sub, VIEW_W / 2, text ? 166 : 26, 13, '#fff', 'rgba(0,0,0,0.6)');
  }

  // ---------- the room ----------

  drawRoom(state, roomId, viewer, opts) {
    const ctx = this.ctx;
    const room = state.embassy.rooms[roomId];
    const pal = PALETTES[room.palette];

    // Ceiling
    poly(ctx, [[24, 0], [696, 0], [696, TOP_FRONT], [570, TOP_BACK], [150, TOP_BACK], [24, TOP_FRONT]], pal.ceil);
    ctx.fillStyle = pal.ceil;
    ctx.fillRect(0, 0, VIEW_W, TOP_FRONT);
    // Back wall with wallpaper stripes
    ctx.fillStyle = pal.wall;
    ctx.fillRect(150, TOP_BACK, 420, BACK_Y - TOP_BACK);
    ctx.fillStyle = pal.stripe;
    for (let x = 158; x < 570; x += 28) ctx.fillRect(x, TOP_BACK, 10, BACK_Y - TOP_BACK);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(150, BACK_Y - 8, 420, 8); // skirting
    // Side walls
    poly(ctx, [[24, TOP_FRONT], [150, TOP_BACK], [150, BACK_Y], [24, FRONT_Y]], pal.side);
    poly(ctx, [[696, TOP_FRONT], [570, TOP_BACK], [570, BACK_Y], [696, FRONT_Y]], pal.side);
    poly(ctx, [[24, FRONT_Y - 2], [150, BACK_Y - 1], [150, BACK_Y], [24, FRONT_Y]], 'rgba(0,0,0,0.25)');
    poly(ctx, [[696, FRONT_Y - 2], [570, BACK_Y - 1], [570, BACK_Y], [696, FRONT_Y]], 'rgba(0,0,0,0.25)');
    // Outside the box (left/right margins)
    ctx.fillStyle = pal.ceil;
    ctx.fillRect(0, 0, 24, HALF);
    ctx.fillRect(696, 0, 24, HALF);
    // Floor: checker in perspective
    const rows = 6, cols = 8;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const z0 = r / rows, z1 = (r + 1) / rows, x0 = c / cols, x1 = (c + 1) / cols;
        poly(ctx, [[fx(x0, z0), fy(z0)], [fx(x1, z0), fy(z0)], [fx(x1, z1), fy(z1)], [fx(x0, z1), fy(z1)]], (r + c) % 2 ? pal.floor : pal.floor2);
      }
    }
    ctx.fillStyle = pal.ceil;
    ctx.fillRect(0, FRONT_Y, VIEW_W, HALF - FRONT_Y);

    // Doors
    for (const side of ['n', 'w', 'e', 's']) {
      const d = room.doors[side];
      if (d === undefined) continue;
      this.drawDoor(state.embassy.doors[d], side, viewer, opts.showOwnTraps[viewer]);
    }

    // Furniture
    const focus = state.spies[viewer].room === roomId && state.spies[viewer].state === 'alive' && !inCombat(state, state.spies[viewer]) ? getFocus(state, state.spies[viewer]) : null;
    for (const fid of room.furniture) {
      const f = state.embassy.furniture[fid];
      const focused = focus && focus.type === 'furniture' && focus.id === fid;
      this.drawFurniture(f, focused);
      if (f.trap && f.trap.owner === viewer && opts.showOwnTraps[viewer]) this.trapMark(f.wall === 'back' ? fx(f.x, 0) : wallPt(f.wall === 'left' ? 'w' : 'e', f.z, 70)[0], f.wall === 'back' ? BACK_Y - 100 : wallPt(f.wall === 'left' ? 'w' : 'e', f.z, 70)[1] - 14, f.trap.type);
    }
    if (focus && focus.type === 'door') this.doorHighlight(focus.side);

    // Time bombs
    for (const b of state.bombs) if (b.room === roomId) this.drawTimeBomb(b);

    // Spies, back to front
    const here = state.spies.filter((s) => s.room === roomId && (s.state === 'alive' || s.state === 'dead')).sort((a, b) => a.z - b.z);
    for (const s of here) this.drawSpy(s, state);

    // Effects
    for (const f of this.fx) if (f.room === roomId) this.drawFx(f);

    // Prompt for what the action button will do
    if (focus && opts.hints[viewer]) {
      const spy = state.spies[viewer];
      let text, px, py;
      if (focus.type === 'furniture') {
        const f = state.embassy.furniture[focus.id];
        text = spy.armed ? `${opts.actKey}: set ${TRAP_BY_ID[spy.armed].name.toLowerCase()}` : `${opts.actKey}: search`;
        if (!spy.armed && !f.fixture && (spy.hasCase || spy.items.length)) text += ` · ${opts.hideKey}: hide ${spy.hasCase ? 'briefcase' : spy.items[0]}`;
        [px, py] = f.wall === 'back' ? [fx(f.x, 0), BACK_Y - 108] : wallPt(f.wall === 'left' ? 'w' : 'e', f.z, 92);
        if (f.wall !== 'back') px += f.wall === 'left' ? 60 : -60;
      } else if (focus.type === 'door') {
        text = `${opts.actKey}: rig door with ${TRAP_BY_ID[spy.armed].name.toLowerCase()}`;
        px = fx(spy.x, spy.z); py = fy(spy.z) - 110;
      } else {
        text = `${opts.actKey}: drop time bomb`;
        px = fx(spy.x, spy.z); py = fy(spy.z) - 110;
      }
      this.label(text, Math.max(90, Math.min(VIEW_W - 90, px)), Math.max(14, py), 12, '#fff', 'rgba(0,0,0,0.7)');
    }
  }

  drawDoor(door, side, viewer, showTraps) {
    const ctx = this.ctx;
    const frame = '#4a3526', panel = door.exit ? '#2f6d3a' : '#7b5a3c', dark = '#20160f';
    if (side === 'n') {
      const x0 = fx(0.42, 0), x1 = fx(0.58, 0), top = BACK_Y - 88;
      ctx.fillStyle = frame; ctx.fillRect(x0 - 5, top - 5, x1 - x0 + 10, BACK_Y - top + 5);
      ctx.fillStyle = dark; ctx.fillRect(x0, top, x1 - x0, BACK_Y - top);
      // half-open door leaf
      poly(ctx, [[x0, top], [x0 + (x1 - x0) * 0.35, top + 6], [x0 + (x1 - x0) * 0.35, BACK_Y - 2], [x0, BACK_Y]], panel);
      if (door.exit) this.exitSign((x0 + x1) / 2, top - 16);
    } else if (side === 'w' || side === 'e') {
      const z0 = 0.3, z1 = 0.6, h = 86;
      const a = wallPt(side, z0, 0), b = wallPt(side, z1, 0), c = wallPt(side, z1, h), d = wallPt(side, z0, h);
      poly(ctx, [[a[0], a[1] + 2], [b[0], b[1] + 2], [c[0], c[1] - 5], [d[0], d[1] - 5]], frame);
      poly(ctx, [a, b, c, d], dark);
      const m0 = wallPt(side, z0 + 0.1, 2), m1 = wallPt(side, z0 + 0.1, h - 3);
      poly(ctx, [a, m0, m1, d], panel);
      if (door.exit) { const t = wallPt(side, (z0 + z1) / 2, h + 18); this.exitSign(t[0], t[1]); }
    } else {
      // Front doorway: a gap in the front edge with a mat and an arrow.
      const x0 = fx(0.41, 1), x1 = fx(0.59, 1);
      ctx.fillStyle = dark; ctx.fillRect(x0, FRONT_Y, x1 - x0, HALF - FRONT_Y);
      ctx.fillStyle = door.exit ? '#2f6d3a' : '#8a3b2b';
      ctx.fillRect(x0 + 6, FRONT_Y - 10, x1 - x0 - 12, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      tri(ctx, (x0 + x1) / 2, FRONT_Y + 10, 7);
      if (door.exit) this.exitSign((x0 + x1) / 2, FRONT_Y - 22);
    }
    if (showTraps && door.trap && door.trap.owner === viewer) {
      const p = side === 'n' ? [fx(0.5, 0), BACK_Y - 100] : side === 's' ? [fx(0.5, 1), FRONT_Y - 30] : wallPt(side, 0.45, 100);
      this.trapMark(p[0], p[1], door.trap.type);
    }
  }

  doorHighlight(side) {
    const ctx = this.ctx;
    ctx.strokeStyle = `rgba(255,240,120,${0.5 + 0.5 * Math.sin(this.time * 10)})`;
    ctx.lineWidth = 3;
    if (side === 'n') ctx.strokeRect(fx(0.42, 0) - 6, BACK_Y - 94, fx(0.58, 0) - fx(0.42, 0) + 12, 94);
    else if (side === 's') ctx.strokeRect(fx(0.41, 1), FRONT_Y - 12, fx(0.59, 1) - fx(0.41, 1), 20);
    else {
      const pts = [wallPt(side, 0.3, 0), wallPt(side, 0.6, 0), wallPt(side, 0.6, 90), wallPt(side, 0.3, 90)];
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    }
  }

  exitSign(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#1f8a3a';
    roundRect(ctx, x - 30, y - 9, 60, 18, 3); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('AIRPORT ✈', x, y + 1);
  }

  trapMark(x, y, type) {
    // A small reminder of where your own traps are [ours]; only you see it.
    const ctx = this.ctx;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    drawTrapIcon(ctx, type, x, y, 0.55);
    ctx.globalAlpha = 1;
  }

  drawFurniture(f, focused) {
    const ctx = this.ctx;
    ctx.save();
    if (focused) {
      ctx.shadowColor = `rgba(255,240,120,${0.6 + 0.4 * Math.sin(this.time * 10)})`;
      ctx.shadowBlur = 16;
    }
    if (f.wall === 'back') drawBackFurniture(ctx, f.kind, fx(f.x, 0), BACK_Y);
    else drawWallFixture(ctx, f.kind, f.wall === 'left' ? 'w' : 'e', f.z);
    ctx.restore();
  }

  drawTimeBomb(b) {
    const ctx = this.ctx;
    const x = fx(b.x, b.z), y = fy(b.z), s = fs(b.z);
    const pulse = 1 + 0.08 * Math.sin(this.time * (20 - b.fuse));
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y, 14 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(x, y - 12 * s, 12 * s * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = b.fuse < 4 && Math.sin(this.time * 25) > 0 ? '#ff3b30' : '#ffcc00';
    ctx.font = `bold ${Math.round(12 * s)}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(b.fuse)), x, y - 12 * s);
  }

  drawSpy(s, state) {
    const ctx = this.ctx;
    const x = fx(s.x, s.z), y = fy(s.z), k = fs(s.z) * 0.95;
    const col = SPY_COLORS[s.idx];
    if (s.state === 'dead') {
      const up = (TUNING.time.deathDown - s.stateT) * 14;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, y, 16 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.75;
      drawSpyFigure(ctx, x + Math.sin(this.time * 2) * 6, y - up, k, s.face, { pose: 'angel', col, walk: 0, t: this.time });
      ctx.globalAlpha = 1;
      return;
    }
    if (s.invuln > 0 && Math.floor(this.time * 16) % 2) ctx.globalAlpha = 0.4;
    const pose = poseOf(s);
    const flash = s.stun > TUNING.combat.hitstun - 0.08 && s.stun > 0;
    if (s.armed === 'gun') {
      // The gun's string trails behind the spy until the trap is set [manual]
      ctx.strokeStyle = '#e6d7b0'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + s.face * 8 * k, y - 38 * k);
      const wob = Math.sin(this.time * 6) * 4 * k;
      ctx.quadraticCurveTo(x - s.face * 10 * k, y - 10 * k + wob, x - s.face * 34 * k, y - 1);
      ctx.lineTo(x - s.face * 60 * k, y + 1);
      ctx.stroke();
    }
    const laugh = s.laughT > 0 && !s.action;
    drawSpyFigure(ctx, x, y, k, s.face, { pose, col, walk: s.walk, t: this.time, flash, action: s.action, stun: s.stun > 0 && !flash, laugh });
    ctx.globalAlpha = 1;
    if (laugh) {
      // "HA HA" bubbling up beside the head, fading out at the end
      ctx.globalAlpha = Math.min(1, s.laughT * 2);
      const jig = Math.sin(this.time * 30) * 1.5;
      this.label('HA', x + s.face * 24 * k, y - 84 * k + jig, Math.round(13 * k), col.band, null, 'bold');
      this.label('HA!', x + s.face * 40 * k, y - 98 * k - jig, Math.round(15 * k), col.band, null, 'bold');
      ctx.globalAlpha = 1;
    }
    // Health pips above the head during a fight
    if (inCombat(state, s)) {
      for (let i = 0; i < TUNING.combat.maxHp; i++) {
        ctx.fillStyle = i < s.hp ? col.ui : 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - 21 * k + i * 6 * k, y - 92 * k, 5 * k, 4 * k);
      }
    }
  }

  drawFx(f) {
    const ctx = this.ctx;
    const t = f.life / f.max;
    if (f.kind === 'p') {
      const x = fx(f.x, f.z) + f.ox, y = fy(f.z) - f.h + f.oy;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.fillStyle = f.color;
      ctx.fillRect(x - f.size / 2, y - f.size / 2, f.size, f.size);
      ctx.globalAlpha = 1;
    } else if (f.kind === 'text') {
      ctx.globalAlpha = Math.min(1, t * 2);
      this.label(f.text, fx(f.x, f.z), fy(f.z) - f.h, 14, f.color, null, 'bold');
      ctx.globalAlpha = 1;
    } else if (f.kind === 'spring') {
      const x = fx(f.x, f.z), y = fy(f.z);
      ctx.strokeStyle = '#ccc'; ctx.lineWidth = 3;
      ctx.beginPath();
      const hgt = 70 * Math.sin((1 - t) * Math.PI);
      for (let i = 0; i <= 10; i++) ctx.lineTo(x + (i % 2 ? 8 : -8), y - (hgt * i) / 10);
      ctx.stroke();
    } else if (f.kind === 'bucket') {
      const x = fx(f.x, f.z), y = fy(f.z) - 110 + (1 - t) * 30;
      ctx.fillStyle = '#9aa3ad';
      poly(ctx, [[x - 14, y - 10], [x + 14, y - 10], [x + 10, y + 10], [x - 10, y + 10]], '#9aa3ad');
    } else if (f.kind === 'bang') {
      this.label('BANG!', fx(f.x, f.z), fy(f.z) - 100, 24, '#ffe066', null, 'bold');
    } else if (f.kind === 'boot') {
      const p = f.side === 'n' ? [fx(0.5, 0), BACK_Y - 30] : f.side === 's' ? [fx(0.5, 1), FRONT_Y - 20] : wallPt(f.side, 0.45, 30);
      const push = Math.sin((1 - t) * Math.PI) * 30;
      ctx.fillStyle = '#2b2b2b';
      const dir = f.side === 'w' ? 1 : f.side === 'e' ? -1 : 0;
      roundRect(ctx, p[0] - 20 + dir * push, p[1] - 12 - (f.side === 's' ? push : f.side === 'n' ? -push : 0), 40, 22, 8);
      ctx.fill();
      this.label('GUARD: NO ENTRY!', p[0], p[1] - 40, 13, '#fff', 'rgba(0,0,0,0.6)', 'bold');
    }
  }

  // ---------- map ----------

  drawMap(state, spy, opts) {
    const ctx = this.ctx;
    const { rooms, doors, furniture, grid } = state.embassy;
    ctx.fillStyle = 'rgba(8,12,20,0.9)';
    ctx.fillRect(0, 0, VIEW_W, HALF);
    const [gw, gh] = grid;
    const cell = Math.min(520 / gw, 230 / gh);
    const ox = (VIEW_W - cell * gw) / 2, oy = 34 + (240 - cell * gh) / 2;
    const itemRooms = new Set(furniture.filter((f) => f.contents.some((c) => c.t === 'item')).map((f) => f.room));
    for (const r of rooms) {
      const x = ox + r.gx * cell, y = oy + r.gy * cell;
      const here = r.id === spy.room;
      ctx.fillStyle = here ? (Math.sin(this.time * 8) > 0 ? '#ffe066' : '#c9a227') : spy.visited[r.id] ? '#4f8fbf' : '#1f2a38';
      ctx.fillRect(x + 4, y + 4, cell - 8, cell - 8);
      ctx.strokeStyle = '#7d93ad'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 4, y + 4, cell - 8, cell - 8);
      if (itemRooms.has(r.id)) {
        ctx.fillStyle = '#ff5e5e';
        ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, Math.max(3, cell * 0.08), 0, Math.PI * 2); ctx.fill();
      }
      if (r.id === state.embassy.exitRoom) {
        ctx.fillStyle = '#7dff9b';
        ctx.font = `${Math.round(cell * 0.3)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('✈', x + cell * 0.75, y + cell * 0.3);
      }
    }
    ctx.fillStyle = '#c8d6e5';
    for (const d of doors) {
      if (d.exit) continue;
      const a = rooms[d.rooms[0]], b = rooms[d.rooms[1]];
      const mx = ox + ((a.gx + b.gx) / 2 + 0.5) * cell, my = oy + ((a.gy + b.gy) / 2 + 0.5) * cell;
      const horiz = a.gy === b.gy;
      ctx.fillRect(mx - (horiz ? 6 : 4), my - (horiz ? 4 : 6), horiz ? 12 : 8, horiz ? 8 : 12);
    }
    this.label(`EMBASSY MAP · red dot = an item is hidden there · clock runs 4× faster · ${opts.mapKey ?? 'M'} to close`, VIEW_W / 2, 18, 12, '#cfe3ff', null);
  }

  // ---------- gadget panel ----------

  drawPanel(state, spy, viewer, opts) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(PANEL_DX, 0);
    this.drawPanelFace(state, spy, viewer, opts);
    ctx.restore();
  }

  drawPanelFace(state, spy, viewer, opts) {
    const ctx = this.ctx;
    const col = SPY_COLORS[viewer];
    const x0 = VIEW_W, w = W - VIEW_W;
    const grad = ctx.createLinearGradient(x0, 0, W, 0);
    grad.addColorStop(0, '#3a3f48'); grad.addColorStop(1, '#2a2e35');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, w, HALF);
    ctx.fillStyle = col.coat;
    ctx.fillRect(x0, 0, 5, HALF);

    // Name and score
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col.ui;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(`${spy.name.toUpperCase()}${opts.labels[viewer] ? ' · ' + opts.labels[viewer] : ''}`, x0 + 16, 18);
    ctx.fillStyle = '#d7dde6';
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${spy.score} pts`, W - 12, 18);

    // Clock
    ctx.fillStyle = '#0b1a10';
    roundRect(ctx, x0 + 14, 34, 168, 40, 5); ctx.fill();
    const tm = Math.max(0, spy.time);
    const mm = Math.floor(tm / 60), ss = Math.floor(tm % 60), hh = Math.floor((tm * 100) % 100);
    ctx.fillStyle = spy.time < TUNING.time.lowTimeWarn ? '#ff6b5e' : '#7dff9b';
    ctx.font = 'bold 26px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}.${String(hh).padStart(2, '0')}`, x0 + 98, 55);
    // Warning light
    const warn = spy.time < TUNING.time.lowTimeWarn && spy.state !== 'escaped' && Math.sin(this.time * 10) > 0;
    ctx.fillStyle = warn ? '#ff3b30' : '#4a1d1a';
    ctx.beginPath(); ctx.arc(x0 + 206, 54, 10, 0, Math.PI * 2); ctx.fill();

    // Health
    ctx.fillStyle = '#aab3bf';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STRENGTH', x0 + 16, 88);
    for (let i = 0; i < TUNING.combat.maxHp; i++) {
      ctx.fillStyle = i < spy.hp && spy.state === 'alive' ? col.ui : '#1b1e23';
      ctx.fillRect(x0 + 80 + i * 18, 82, 14, 12);
    }

    // Trap buttons
    const combat = inCombat(state, spy);
    TRAPS.forEach((t, i) => {
      const bx = x0 + 14 + i * 42, by = 104;
      const armed = spy.armed === t.id;
      const empty = spy.traps[t.id] <= 0;
      ctx.fillStyle = armed ? '#ffe066' : combat ? '#2a2d33' : '#4d5562';
      roundRect(ctx, bx, by, 38, 44, 5); ctx.fill();
      ctx.globalAlpha = empty || combat ? 0.35 : 1;
      drawTrapIcon(ctx, t.id, bx + 19, by + 19, 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = armed ? '#000' : '#e6eaf0';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      if (opts.keyLabels[viewer]) ctx.fillText(String(i + 1), bx + 4, by + 9);
      ctx.textAlign = 'right';
      ctx.fillText(`×${spy.traps[t.id]}`, bx + 35, by + 37);
    });
    // Map button
    ctx.fillStyle = spy.mapOpen ? '#ffe066' : combat ? '#2a2d33' : '#4d5562';
    roundRect(ctx, x0 + 14, 154, 80, 26, 5); ctx.fill();
    ctx.fillStyle = spy.mapOpen ? '#000' : '#e6eaf0';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.keyLabels[viewer] ? 'M  MAP −70' : 'MAP −70', x0 + 54, 168);
    // Armed hint
    ctx.textAlign = 'left';
    ctx.fillStyle = '#aab3bf';
    ctx.font = '11px system-ui, sans-serif';
    const hint = spy.armed ? `Holding: ${TRAP_BY_ID[spy.armed].name}` : combat ? 'Rival in the room' : spy.remedy ? `Remedy: ${remedyName(spy.remedy)}` : 'Remedy: none';
    ctx.fillText(hint, x0 + 102, 168);

    // Items
    ctx.fillStyle = '#aab3bf';
    ctx.fillText(spy.hasCase ? 'BRIEFCASE' : 'CARRYING (one thing, no briefcase)', x0 + 16, 196);
    const slots = [...ITEMS, 'case'];
    slots.forEach((k, i) => {
      const bx = x0 + 14 + i * 42, by = 206;
      const have = k === 'case' ? spy.hasCase : spy.items.includes(k);
      ctx.fillStyle = have ? '#f5efe0' : '#1f2329';
      roundRect(ctx, bx, by, 38, 38, 5); ctx.fill();
      ctx.globalAlpha = have ? 1 : 0.25;
      drawItemIcon(ctx, k, bx + 19, by + 19);
      ctx.globalAlpha = 1;
    });
    // Remedy slot
    ctx.fillStyle = '#aab3bf';
    ctx.fillText('REMEDY', x0 + 16, 260);
    ctx.fillStyle = spy.remedy ? '#d9f7e0' : '#1f2329';
    roundRect(ctx, x0 + 14, 268, 38, 38, 5); ctx.fill();
    if (spy.remedy) drawRemedyIcon(ctx, spy.remedy, x0 + 33, 287);
    ctx.fillStyle = '#8d96a3';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(`Items ${spy.items.length}/4`, x0 + 62, 280);
    ctx.fillText(spy.remedy ? remedyName(spy.remedy) : 'protects from one trap', x0 + 62, 296);
  }

  label(text, x, y, size, color, bg, weight = '') {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (bg) {
      const w = ctx.measureText(text).width + 14;
      ctx.fillStyle = bg;
      roundRect(ctx, x - w / 2, y - size * 0.8, w, size * 1.6, 4); ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 1);
  }
}

export function rankFor(score) {
  return TUNING.ranks.find(([min]) => score >= min)[1];
}

// Our own airfield: sunset sky, hills, a round-roofed hangar, a control tower and a windsock.
function drawAirfield(ctx, t, time) {
  const sky = ctx.createLinearGradient(0, 0, 0, 210);
  sky.addColorStop(0, '#24406e'); sky.addColorStop(0.65, '#d98b6a'); sky.addColorStop(1, '#f3c27d');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, VIEW_W, 215);
  ctx.fillStyle = 'rgba(255,236,170,0.9)';
  ctx.beginPath(); ctx.arc(470, 196, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [cx, cy, s] of [[120, 50, 1], [420, 34, 0.8], [640, 70, 1.1]]) {
    const dx = ((time * 6 * s) % 60) - 30;
    ctx.beginPath(); ctx.ellipse(cx + dx, cy, 38 * s, 9 * s, 0, 0, Math.PI * 2); ctx.ellipse(cx + dx + 20 * s, cy - 6 * s, 22 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Hills
  ctx.fillStyle = '#3e5f3c';
  ctx.beginPath(); ctx.moveTo(0, 215);
  for (let x = 0; x <= VIEW_W; x += 40) ctx.lineTo(x, 196 + Math.sin(x * 0.013) * 12 + Math.sin(x * 0.041) * 5);
  ctx.lineTo(VIEW_W, 215); ctx.closePath(); ctx.fill();
  // Grass and runway
  ctx.fillStyle = '#5d8a45'; ctx.fillRect(0, 212, VIEW_W, HALF - 212);
  ctx.fillStyle = '#6a6f74'; ctx.fillRect(0, 246, VIEW_W, 34);
  ctx.fillStyle = '#e9e9e9';
  for (let x = 10; x < VIEW_W; x += 60) ctx.fillRect(x, 262, 32, 3);
  // Hangar: corrugated round roof
  ctx.fillStyle = '#8c968e';
  ctx.beginPath(); ctx.ellipse(130, 236, 100, 96, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath(); ctx.ellipse(130, 236, Math.abs(i) * 22 + 2, 96, 0, Math.PI, 0); ctx.stroke();
  }
  ctx.fillStyle = '#2a2f33'; ctx.fillRect(82, 168, 96, 68);
  ctx.fillStyle = '#3c4349'; ctx.fillRect(82, 168, 96, 6);
  // Control tower
  ctx.fillStyle = '#d9d2c3'; ctx.fillRect(606, 128, 26, 106);
  ctx.fillStyle = '#3b4a57'; ctx.fillRect(590, 100, 58, 30);
  ctx.fillStyle = '#9fd3e6'; ctx.fillRect(594, 105, 50, 18);
  ctx.fillStyle = '#c94f3d'; ctx.fillRect(586, 94, 66, 7);
  // Windsock
  ctx.fillStyle = '#555'; ctx.fillRect(536, 166, 3, 70);
  const flap = Math.sin(time * 4) * 3;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#ff7a1a';
    const x0 = 539 + i * 9, x1 = x0 + 9;
    ctx.beginPath();
    ctx.moveTo(x0, 166 + i * 1.2 + (i ? flap * i / 4 : 0)); ctx.lineTo(x1, 167 + (i + 1) * 1.2 + flap * (i + 1) / 4);
    ctx.lineTo(x1, 178 - (i + 1) * 1.2 + flap * (i + 1) / 4); ctx.lineTo(x0, 179 - i * 1.2 + (i ? flap * i / 4 : 0));
    ctx.closePath(); ctx.fill();
  }
}

// A little high-wing monoplane in the spy's colours. (x, y) is where the wheels touch the ground.
function drawPlane(ctx, x, y, s, ang, col, spinTime, pilot) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
  // Wheels and struts
  ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(8, -22); ctx.lineTo(4, -7); ctx.moveTo(-50, -18); ctx.lineTo(-54, -5); ctx.stroke();
  ctx.fillStyle = '#1d1d1d';
  ctx.beginPath(); ctx.arc(4, -7, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-54, -4, 4, 0, Math.PI * 2); ctx.fill();
  // Fuselage
  ctx.fillStyle = col.coat;
  ctx.beginPath();
  ctx.moveTo(40, -30); ctx.quadraticCurveTo(46, -22, 40, -14);
  ctx.lineTo(-30, -16); ctx.lineTo(-62, -24); ctx.lineTo(-58, -33); ctx.lineTo(-20, -40); ctx.lineTo(28, -42);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = col.band; ctx.fillRect(-40, -30, 70, 4); // stripe
  // Tail fin
  ctx.fillStyle = col.dark;
  ctx.beginPath(); ctx.moveTo(-50, -31); ctx.lineTo(-66, -56); ctx.lineTo(-58, -56); ctx.lineTo(-36, -36); ctx.closePath(); ctx.fill();
  // Cockpit window and pilot
  ctx.fillStyle = '#bfe6f5';
  ctx.beginPath(); ctx.moveTo(4, -42); ctx.lineTo(22, -42); ctx.lineTo(30, -32); ctx.lineTo(4, -32); ctx.closePath(); ctx.fill();
  if (pilot) {
    ctx.fillStyle = '#f0c9a0'; ctx.beginPath(); ctx.arc(14, -36, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col.dark; ctx.fillRect(8, -44, 12, 4); ctx.fillRect(10, -48, 8, 5);
  }
  // High wing and strut
  ctx.fillStyle = col.dark;
  roundRect(ctx, -26, -50, 62, 7, 3); ctx.fill();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-6, -44); ctx.lineTo(-14, -22); ctx.stroke();
  // Nose cowl and propeller
  ctx.fillStyle = '#3a3a3a';
  ctx.beginPath(); ctx.ellipse(42, -28, 6, 11, 0, 0, Math.PI * 2); ctx.fill();
  if (spinTime !== null) {
    ctx.fillStyle = 'rgba(230,230,230,0.35)';
    ctx.beginPath(); ctx.ellipse(48, -28, 3, 22, 0, 0, Math.PI * 2); ctx.fill();
    const a = spinTime * 60;
    ctx.strokeStyle = 'rgba(40,40,40,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(48, -28 - Math.cos(a) * 20); ctx.lineTo(48, -28 + Math.cos(a) * 20); ctx.stroke();
  } else {
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(48, -48); ctx.lineTo(48, -8); ctx.stroke();
  }
  ctx.restore();
}

// ---------- shape helpers ----------

function poly(ctx, pts, fill) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function tri(ctx, x, y, s) {
  ctx.beginPath(); ctx.moveTo(x - s, y - s / 2); ctx.lineTo(x + s, y - s / 2); ctx.lineTo(x, y + s / 2); ctx.closePath(); ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
}

// Adds a rounded rectangle to the current path without starting a new one.
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function poseOf(s) {
  if (s.action) {
    if (s.action.kind === 'search' || s.action.kind === 'set' || s.action.kind === 'hide') return 'search';
    const mv = TUNING.combat[s.action.kind];
    const t = s.action.t;
    if (t < mv.startup) return s.action.kind === 'heavy' ? 'windup' : 'jabback';
    if (t < mv.startup + mv.active) return s.action.kind === 'heavy' ? 'smash' : 'jab';
    return 'recover';
  }
  return Math.abs(s.vx) + Math.abs(s.vz) > 0.03 ? 'walk' : 'idle';
}

// Our spy design: round head, dark glasses, wide-brim hat and a belted coat.
export function drawSpyFigure(ctx, x, y, k, face, o) {
  const { col, pose } = o;
  const white = o.flash ? '#ffffff' : null;
  const angel = pose === 'angel';
  const coat = white || (angel ? '#f4f4ff' : col.coat);
  const dark = white || (angel ? '#d8d8ee' : col.dark);
  const skin = white || (angel ? '#ffffff' : '#f0c9a0');
  const shoe = white || (angel ? '#e0e0f0' : '#222');
  const crouch = pose === 'search' ? 6 * k : 0;
  const bob = pose === 'walk' ? Math.abs(Math.sin(o.walk)) * 2 * k : 0;
  const by = y - crouch - bob;
  // Laughing: shoulders and head jerk up and down
  const lift = o.laugh ? Math.abs(Math.sin(o.t * 17)) * 3.5 * k : 0;
  const uy = by - lift; // upper body

  if (!angel) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y, 16 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Legs
  const swing = pose === 'walk' ? Math.sin(o.walk) * 5 * k : 0;
  ctx.fillStyle = dark;
  ctx.fillRect(x - 7 * k + swing, by - 22 * k, 5 * k, 20 * k + crouch * 0.3);
  ctx.fillRect(x + 2 * k - swing, by - 22 * k, 5 * k, 20 * k + crouch * 0.3);
  ctx.fillStyle = shoe;
  ctx.beginPath(); ctx.ellipse(x - 4.5 * k + swing + face * 2 * k, y - 2 * k, 5 * k, 2.5 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + 4.5 * k - swing + face * 2 * k, y - 2 * k, 5 * k, 2.5 * k, 0, 0, Math.PI * 2); ctx.fill();
  // Coat
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(x - 11 * k - lift * 0.4, uy - 54 * k);
  ctx.lineTo(x + 11 * k + lift * 0.4, uy - 54 * k);
  ctx.lineTo(x + 16 * k, by - 18 * k);
  ctx.lineTo(x - 16 * k, by - 18 * k);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(x - 14 * k, by - 36 * k, 28 * k, 4 * k); // belt
  ctx.fillStyle = white || (angel ? '#fff' : col.band);
  ctx.fillRect(x - 2 * k, by - 36 * k, 4 * k, 4 * k); // buckle
  // Lapel line
  ctx.strokeStyle = dark; ctx.lineWidth = 1.5 * k;
  ctx.beginPath(); ctx.moveTo(x, uy - 54 * k); ctx.lineTo(x + face * 4 * k, by - 40 * k); ctx.stroke();

  // Arm and club
  const sh = [x + face * 6 * k, uy - 50 * k];
  let ang; // club angle, 0 = pointing forward
  switch (pose) {
    case 'windup': ang = -2.2; break;
    case 'smash': ang = 0.4; break;
    case 'jabback': ang = -0.3; break;
    case 'jab': ang = 0; break;
    case 'recover': ang = 0.8; break;
    case 'search': ang = 0.6 + Math.sin(o.t * 20) * 0.3; break;
    case 'angel': ang = 1.2; break;
    default:
      if (o.laugh) { ang = 0.9; break; } // hand on the belly
 ang = 1.25 + (pose === 'walk' ? Math.sin(o.walk) * 0.15 : 0);
  }
  const reach = pose === 'jab' ? 18 * k : pose === 'smash' ? 14 * k : 12 * k;
  const hand = [sh[0] + face * Math.cos(ang) * reach, sh[1] + Math.sin(ang) * reach];
  ctx.strokeStyle = coat; ctx.lineWidth = 6 * k; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(...sh); ctx.lineTo(...hand); ctx.stroke();
  if (!angel) {
    const clubLen = 20 * k;
    const tip = [hand[0] + face * Math.cos(ang - 0.5) * clubLen, hand[1] + Math.sin(ang - 0.5) * clubLen];
    ctx.strokeStyle = white || '#6b4423'; ctx.lineWidth = 5 * k;
    ctx.beginPath(); ctx.moveTo(...hand); ctx.lineTo(...tip); ctx.stroke();
    if (pose === 'windup') {
      // Telegraph the heavy blow with a glint
      ctx.fillStyle = `rgba(255,255,200,${0.6 + 0.4 * Math.sin(o.t * 40)})`;
      ctx.beginPath(); ctx.arc(tip[0], tip[1], 5 * k, 0, Math.PI * 2); ctx.fill();
    }
    if (pose === 'jab' || pose === 'smash') {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sh[0], sh[1], reach + clubLen, face > 0 ? -1.2 : Math.PI - 0.4, face > 0 ? 0.4 : Math.PI + 1.2); ctx.stroke();
    }
  }
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(hand[0], hand[1], 3 * k, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'butt';

  // Head
  const hy = uy - 63 * k - lift * 0.5;
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(x, hy, 10 * k, 0, Math.PI * 2); ctx.fill();
  // Glasses
  ctx.fillStyle = white || (angel ? '#c8c8e0' : '#111');
  roundRect(ctx, x - 6 * k + face * 3 * k, hy - 3 * k, 12 * k, 5 * k, 2 * k); ctx.fill();
  // Nose
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(x + face * 10 * k, hy + 2 * k, 2.5 * k, 0, Math.PI * 2); ctx.fill();
  if (o.laugh) {
    // Wide open grin
    ctx.fillStyle = '#5a1a14';
    ctx.beginPath(); ctx.ellipse(x + face * 4 * k, hy + 5 * k, 5 * k, 3 * k + lift * 0.4, 0, 0, Math.PI); ctx.fill();
  }
  // Hat
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(x, hy - 7 * k, 16 * k, 3.5 * k, 0, 0, Math.PI * 2); ctx.fill();
  roundRect(ctx, x - 9 * k, hy - 17 * k, 18 * k, 11 * k, 3 * k); ctx.fill();
  ctx.fillStyle = white || (angel ? '#fff' : col.band);
  ctx.fillRect(x - 9 * k, hy - 10 * k, 18 * k, 3 * k);

  if (angel) {
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2.5 * k;
    ctx.beginPath(); ctx.ellipse(x, hy - 24 * k, 9 * k, 3 * k, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const flap = Math.sin(o.t * 8) * 4 * k;
    ctx.beginPath(); ctx.ellipse(x - 16 * k, by - 46 * k - flap, 9 * k, 14 * k, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 16 * k, by - 46 * k - flap, 9 * k, 14 * k, 0.5, 0, Math.PI * 2); ctx.fill();
  }
  if (o.stun) {
    ctx.fillStyle = '#ffe066';
    for (let i = 0; i < 3; i++) {
      const a = o.t * 8 + (i * Math.PI * 2) / 3;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * 14 * k, hy - 18 * k + Math.sin(a) * 4 * k, 2.5 * k, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawBackFurniture(ctx, kind, x, y) {
  switch (kind) {
    case 'desk':
      ctx.fillStyle = '#6b4226'; ctx.fillRect(x - 36, y - 40, 72, 7);
      ctx.fillStyle = '#5a361f'; ctx.fillRect(x - 33, y - 33, 22, 33); ctx.fillRect(x + 11, y - 33, 22, 33);
      ctx.fillStyle = '#c9a36b'; ctx.fillRect(x - 25, y - 24, 6, 3); ctx.fillRect(x + 19, y - 24, 6, 3); ctx.fillRect(x - 25, y - 12, 6, 3); ctx.fillRect(x + 19, y - 12, 6, 3);
      ctx.fillStyle = '#2f6d3a'; ctx.fillRect(x + 14, y - 58, 3, 18); ctx.beginPath(); ctx.moveTo(x + 6, y - 56); ctx.lineTo(x + 26, y - 56); ctx.lineTo(x + 21, y - 66); ctx.lineTo(x + 11, y - 66); ctx.fill();
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(x - 24, y - 43, 18, 3);
      break;
    case 'cabinet':
      ctx.fillStyle = '#7d8793'; ctx.fillRect(x - 20, y - 78, 40, 78);
      ctx.fillStyle = '#6a737e';
      for (let i = 0; i < 3; i++) ctx.fillRect(x - 17, y - 74 + i * 25, 34, 21);
      ctx.fillStyle = '#d7dde6';
      for (let i = 0; i < 3; i++) ctx.fillRect(x - 6, y - 66 + i * 25, 12, 3);
      break;
    case 'bookshelf': {
      ctx.fillStyle = '#5b3a22'; ctx.fillRect(x - 28, y - 92, 56, 92);
      ctx.fillStyle = '#3b2414';
      const colors = ['#b03a2e', '#2e6eb0', '#e0b030', '#3a8f4a', '#8a4fb0', '#d06a2a'];
      for (let r = 0; r < 4; r++) {
        ctx.fillStyle = '#3b2414'; ctx.fillRect(x - 24, y - 88 + r * 22, 48, 18);
        let bx = x - 23;
        for (let b = 0; b < 7; b++) {
          const w = 4 + ((b * 7 + r * 3) % 4);
          ctx.fillStyle = colors[(b + r * 2) % colors.length];
          ctx.fillRect(bx, y - 86 + r * 22 + ((b + r) % 3), w, 16 - ((b + r) % 3));
          bx += w + 1;
        }
      }
      break;
    }
    case 'tv':
      ctx.fillStyle = '#4a3020'; ctx.fillRect(x - 24, y - 30, 48, 30);
      ctx.fillStyle = '#2c2c2c'; roundRect(ctx, x - 22, y - 66, 44, 36, 6); ctx.fill();
      ctx.fillStyle = '#6fa0a8'; roundRect(ctx, x - 17, y - 61, 30, 26, 5); ctx.fill();
      ctx.fillStyle = '#bbb'; ctx.fillRect(x + 15, y - 58, 4, 4); ctx.fillRect(x + 15, y - 50, 4, 4);
      ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 4, y - 66); ctx.lineTo(x - 14, y - 82); ctx.moveTo(x + 4, y - 66); ctx.lineTo(x + 12, y - 84); ctx.stroke();
      break;
    case 'dresser':
      ctx.fillStyle = '#8a5a3a'; ctx.fillRect(x - 32, y - 46, 64, 46);
      ctx.fillStyle = '#9d6a47';
      for (let i = 0; i < 3; i++) ctx.fillRect(x - 29, y - 43 + i * 14, 58, 11);
      ctx.fillStyle = '#e8cc8a';
      for (let i = 0; i < 3; i++) { ctx.fillRect(x - 16, y - 39 + i * 14, 4, 3); ctx.fillRect(x + 12, y - 39 + i * 14, 4, 3); }
      ctx.fillStyle = '#cfe6ee'; ctx.beginPath(); ctx.ellipse(x, y - 66, 14, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 3; ctx.stroke();
      break;
    case 'plant':
      ctx.fillStyle = '#b5562d'; ctx.beginPath(); ctx.moveTo(x - 14, y - 26); ctx.lineTo(x + 14, y - 26); ctx.lineTo(x + 10, y); ctx.lineTo(x - 10, y); ctx.fill();
      ctx.fillStyle = '#3c8f45';
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.45;
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 16, y - 34 + Math.sin(a) * 18, 6, 14, a + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'coatrack':
      ctx.fillStyle = '#4a3020'; ctx.fillRect(x - 2, y - 90, 4, 90); ctx.fillRect(x - 14, y - 3, 28, 3);
      ctx.fillRect(x - 12, y - 86, 24, 3);
      ctx.fillStyle = '#556070'; ctx.beginPath(); ctx.moveTo(x - 10, y - 84); ctx.lineTo(x - 18, y - 40); ctx.lineTo(x - 4, y - 40); ctx.fill();
      ctx.strokeStyle = '#2b2b5a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + 10, y - 84); ctx.lineTo(x + 12, y - 30); ctx.arc(x + 15, y - 30, 3, Math.PI, 0, true); ctx.stroke();
      break;
    case 'firstaid':
      ctx.fillStyle = '#f4f4f4'; roundRect(ctx, x - 18, y - 80, 36, 30, 4); ctx.fill();
      ctx.fillStyle = '#1f9a4a'; ctx.fillRect(x - 3, y - 74, 6, 18); ctx.fillRect(x - 9, y - 68, 18, 6);
      break;
  }
}

function drawWallFixture(ctx, kind, side, z) {
  const z0 = z - 0.13, z1 = z + 0.13;
  const box = (h0, h1, color, a = z0, b = z1) => poly(ctx, [wallPt(side, a, h0), wallPt(side, b, h0), wallPt(side, b, h1), wallPt(side, a, h1)], color);
  if (kind === 'firebox') {
    box(28, 74, '#b71c1c');
    box(34, 68, '#e53935', z0 + 0.03, z1 - 0.03);
    box(46, 56, '#fff3e0', z - 0.06, z + 0.06); // handle
  } else if (kind === 'toolbox') {
    box(28, 58, '#d0d4d9');
    box(52, 58, '#8a939d');
    box(38, 44, '#5f6770', z - 0.05, z + 0.05); // latch
    box(58, 64, '#5f6770', z - 0.06, z + 0.06); // carry handle
  }
}

export function drawTrapIcon(ctx, id, x, y, s) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  switch (id) {
    case 'bomb':
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 3, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9a36b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(4, -6); ctx.quadraticCurveTo(8, -12, 12, -10); ctx.stroke();
      ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(12, -10, 2.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'spring':
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2.5; ctx.beginPath();
      for (let i = 0; i <= 8; i++) ctx.lineTo(i % 2 ? 7 : -7, 12 - i * 3);
      ctx.stroke();
      break;
    case 'bucket':
      ctx.fillStyle = '#9aa3ad'; ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(10, -8); ctx.lineTo(7, 11); ctx.lineTo(-7, 11); ctx.fill();
      ctx.fillStyle = '#5ab4ff'; ctx.fillRect(-9, -8, 18, 4);
      break;
    case 'gun':
      ctx.fillStyle = '#333'; ctx.fillRect(-12, -5, 20, 6); ctx.fillRect(2, -1, 6, 11);
      ctx.strokeStyle = '#e6d7b0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(-14, -12); ctx.stroke();
      break;
    case 'timebomb':
      ctx.fillStyle = '#b03a2e'; ctx.fillRect(-11, -6, 22, 14);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -8, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, -12); ctx.moveTo(0, -8); ctx.lineTo(3, -8); ctx.stroke();
      break;
  }
  ctx.restore();
}

export function drawItemIcon(ctx, k, x, y) {
  ctx.save(); ctx.translate(x, y);
  switch (k) {
    case 'passport':
      ctx.fillStyle = '#284a8a'; ctx.fillRect(-9, -12, 18, 24);
      ctx.strokeStyle = '#e8c35a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, -2, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e8c35a'; ctx.fillRect(-5, 6, 10, 2);
      break;
    case 'money':
      ctx.fillStyle = '#4c9a4c'; ctx.fillRect(-13, -7, 26, 14);
      ctx.fillStyle = '#d8f0d0'; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4c9a4c'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 0.5);
      break;
    case 'key':
      ctx.strokeStyle = '#c99a1a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(-6, 0, 5, 0, Math.PI * 2); ctx.moveTo(-1, 0); ctx.lineTo(12, 0); ctx.moveTo(8, 0); ctx.lineTo(8, 5); ctx.moveTo(12, 0); ctx.lineTo(12, 5); ctx.stroke();
      break;
    case 'plans':
      ctx.fillStyle = '#2d6db5'; ctx.fillRect(-12, -9, 24, 18);
      ctx.strokeStyle = '#cfe6ff'; ctx.lineWidth = 1;
      ctx.strokeRect(-9, -6, 10, 8); ctx.beginPath(); ctx.moveTo(3, -6); ctx.lineTo(9, -6); ctx.moveTo(3, -2); ctx.lineTo(9, -2); ctx.moveTo(-9, 5); ctx.lineTo(9, 5); ctx.stroke();
      break;
    case 'case':
      ctx.fillStyle = '#5b3a22'; roundRect(ctx, -13, -7, 26, 17, 3); ctx.fill();
      ctx.strokeStyle = '#5b3a22'; ctx.lineWidth = 2.5; ctx.strokeRect(-5, -11, 10, 5);
      ctx.fillStyle = '#e8c35a'; ctx.fillRect(-2, -2, 4, 3);
      break;
  }
  ctx.restore();
}

export function drawRemedyIcon(ctx, k, x, y) {
  ctx.save(); ctx.translate(x, y);
  switch (k) {
    case 'water':
      ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.moveTo(-9, -8); ctx.lineTo(9, -8); ctx.lineTo(7, 10); ctx.lineTo(-7, 10); ctx.fill();
      ctx.fillStyle = '#5ab4ff'; ctx.fillRect(-8, -8, 16, 3);
      break;
    case 'cutters':
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(2, -2); ctx.moveTo(8, 10); ctx.lineTo(-2, -2); ctx.stroke();
      ctx.strokeStyle = '#888'; ctx.beginPath(); ctx.moveTo(2, -2); ctx.lineTo(-2, -11); ctx.moveTo(-2, -2); ctx.lineTo(2, -11); ctx.stroke();
      break;
    case 'umbrella':
      ctx.fillStyle = '#2b2b5a'; ctx.beginPath(); ctx.arc(0, 0, 11, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#2b2b5a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 10); ctx.arc(3, 10, 3, Math.PI, 0, true); ctx.stroke();
      break;
    case 'scissors':
      ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(-4, 7, 3.5, 0, Math.PI * 2); ctx.moveTo(7.5, 7); ctx.arc(4, 7, 3.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, 4); ctx.lineTo(5, -11); ctx.moveTo(2, 4); ctx.lineTo(-5, -11); ctx.stroke();
      break;
  }
  ctx.restore();
}

