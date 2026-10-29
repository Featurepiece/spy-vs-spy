// The front menu: a keyboard-, controller- and touch-friendly list over the attract-mode
// monitors, plus the title art. Until real picture files arrive (see ART in
// art.js) the key art is drawn here in code.

import { TUNING } from './tuning.js';
import { SPY_COLORS, drawSpyFigure, drawItemIcon } from './render.js';
import { ART } from './art.js';

const $ = (id) => document.getElementById(id);

const IQ_NOTES = ['sets few traps', 'a fair fight', 'sneaky and fierce'];
const OPTIONS = {
  level: { count: TUNING.levels.length, text: (i) => `${TUNING.levels[i].name}<small>${TUNING.levels[i].rooms} rooms · ${TUNING.levels[i].minutes} min</small>` },
  iq: { count: TUNING.cpu.length, text: (i) => `${TUNING.cpu[i].name}<small>${IQ_NOTES[i]}</small>` },
  music: { count: 11, clamp: true, text: volumeBar },
  sfx: { count: 11, clamp: true, text: volumeBar },
};

function volumeBar(v) {
  const bars = Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('');
  return `<span class="bar">${bars}</span><small>${v === 0 ? 'Off' : `${v * 10}%`}</small>`;
}

export function setupTitle({ settings, save, onStart, onChange, isTouch }) {
  const list = $('menuList');
  // The rows you can move between: the main list, or the settings page's rows.
  const items = () => [...(panel === 'settings' ? $('settingsPanel') : list).querySelectorAll('.item')];
  let sel = 0;
  let panel = null; // 'how', 'keys' or 'settings' while a page is open

  const refresh = () => {
    for (const row of $('title').querySelectorAll('[data-set]')) {
      const key = row.dataset.set;
      row.querySelector('.val').innerHTML = OPTIONS[key].text(settings[key]);
    }
    for (const b of $('title').querySelectorAll('.item')) b.classList.remove('sel');
    items()[sel]?.classList.add('sel');
  };
  const change = (key, d) => {
    const { count: n, clamp } = OPTIONS[key];
    const v = clamp ? Math.min(n - 1, Math.max(0, settings[key] + d)) : (settings[key] + d + n) % n;
    if (v === settings[key]) return;
    settings[key] = v;
    save(key, v);
    onChange?.(key);
    refresh();
  };
  let mainSel = 0;
  const openPanel = (name) => {
    if (name && !panel) mainSel = sel;
    panel = name;
    sel = name ? 0 : mainSel;
    $('menuMain').hidden = !!name;
    $('howPanel').hidden = name !== 'how';
    $('keysPanel').hidden = name !== 'keys';
    $('settingsPanel').hidden = name !== 'settings';
    $('title').scrollTop = 0;
    refresh();
  };
  const activate = (b) => {
    if (b.dataset.act === 'start') onStart();
    else if (b.classList.contains('back')) openPanel(null);
    else if (b.dataset.set && !OPTIONS[b.dataset.set].clamp) change(b.dataset.set, 1);
    else if (b.dataset.panel) openPanel(b.dataset.panel);
  };

  for (const box of [list, $('settingsPanel')]) {
    [...box.querySelectorAll('.item')].forEach((b, i) => {
      if (!b.classList.contains('back')) b.addEventListener('click', () => { sel = i; refresh(); activate(b); });
      b.addEventListener('pointerenter', () => { sel = i; refresh(); });
    });
  }
  for (const a of $('title').querySelectorAll('.arrow')) {
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      change(a.closest('[data-set]').dataset.set, Number(a.dataset.d));
    });
  }
  for (const b of document.querySelectorAll('#title .back')) b.addEventListener('click', () => openPanel(null));
  // Labels are the controller's button names while one is in use, otherwise null.
  const setHint = (labels) => {
    $('menuHint').textContent = labels ? `Stick or D-pad: ↑ ↓ choose · ← → change · ${labels.a} select · ${labels.b} back`
      : isTouch ? 'Tap an option · ◀ ▶ change a setting' : '↑ ↓ choose · ← → change · Enter select';
    $('settingsHint').textContent = labels ? `Stick or D-pad: ↑ ↓ choose · ← → change · ${labels.b} back`
      : isTouch ? 'Tap ◀ ▶ to change the volume' : '↑ ↓ choose · ← → change · Esc back';
  };
  setHint(null);

  // Called by main.js for key presses while the title screen is up.
  const onKey = (code) => {
    if (panel && panel !== 'settings') {
      if (['Escape', 'Enter', 'Space', 'Backspace'].includes(code)) openPanel(null);
      return;
    }
    if (panel && ['Escape', 'Backspace'].includes(code)) { openPanel(null); return; }
    const all = items();
    const b = all[sel];
    if (code === 'ArrowUp' || code === 'KeyW') sel = (sel + all.length - 1) % all.length;
    else if (code === 'ArrowDown' || code === 'KeyS') sel = (sel + 1) % all.length;
    else if ((code === 'ArrowLeft' || code === 'KeyA') && b.dataset.set) change(b.dataset.set, -1);
    else if ((code === 'ArrowRight' || code === 'KeyD') && b.dataset.set) change(b.dataset.set, 1);
    else if (code === 'Enter' || code === 'Space') activate(b);
    refresh();
  };

  setupArt();
  refresh();
  return { onKey, setHint, reset: () => { openPanel(null); sel = 0; refresh(); } };
}

// Swap in the picture files when they exist; otherwise draw the placeholder.
function setupArt() {
  if (ART.logo) {
    const img = document.createElement('img');
    img.src = ART.logo;
    img.alt = 'Double Agents';
    img.className = 'logo-img';
    $('logo').replaceChildren(img);
  }
  const hero = $('hero');
  if (ART.titleArt) {
    hero.style.backgroundImage = `url("${ART.titleArt}")`;
    hero.classList.add('has-art');
    return;
  }
  const c = $('heroArt');
  const draw = () => drawHeroPlaceholder(c);
  draw();
  // Redraw once the display font is in, for the stamp lettering.
  document.fonts?.ready.then(draw);
}

// Placeholder key art: the two spies square up in crossed spotlights over the briefcase.
function drawHeroPlaceholder(c) {
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0f1626'); bg.addColorStop(1, '#1d2740');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Wallpaper stripes and a skirting line
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = 0; x < w; x += 48) ctx.fillRect(x, 0, 22, h * 0.72);
  ctx.fillStyle = '#121a2c';
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
  // A spotlight on each spy
  for (const [sx, cx, tint] of [[w * 0.06, w * 0.33, 'rgba(255,140,120,'], [w * 0.94, w * 0.67, 'rgba(140,190,255,']]) {
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.86);
    g.addColorStop(0, `${tint}0.35)`); g.addColorStop(1, `${tint}0.06)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - 8, 0); ctx.lineTo(sx + 8, 0);
    ctx.lineTo(cx + w * 0.13, h * 0.86); ctx.lineTo(cx - w * 0.13, h * 0.86);
    ctx.closePath();
    ctx.fill();
  }
  // Light pools on the floor
  for (const [x, col] of [[w * 0.33, 'rgba(255,230,180,0.18)'], [w * 0.67, 'rgba(200,225,255,0.18)']]) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x, h * 0.86, w * 0.14, h * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  }
  // The spies, facing each other
  const k = h / 150;
  drawSpyFigure(ctx, w * 0.33, h * 0.86, k, 1, { pose: 'idle', col: SPY_COLORS[0], walk: 0, t: 0 });
  drawSpyFigure(ctx, w * 0.67, h * 0.86, k, -1, { pose: 'idle', col: SPY_COLORS[1], walk: 0, t: 0 });
  // The prize between them
  ctx.save();
  ctx.translate(w / 2, h * 0.8);
  ctx.scale(k * 1.3, k * 1.3);
  drawItemIcon(ctx, 'case', 0, 0);
  ctx.restore();
  // Placeholder stamp, so nobody mistakes this for the finished art
  ctx.save();
  ctx.translate(w - 96, h - 30);
  ctx.rotate(-0.06);
  ctx.strokeStyle = 'rgba(255,107,94,0.7)'; ctx.lineWidth = 2;
  ctx.strokeRect(-70, -14, 140, 28);
  ctx.fillStyle = 'rgba(255,107,94,0.8)';
  ctx.font = '15px "Black Ops One", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('PLACEHOLDER ART', 0, 1);
  ctx.restore();
}
