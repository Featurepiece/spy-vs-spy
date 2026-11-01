// The online menu: your spy's name, create or join a game, then the briefing
// room (lobby) where you share the code, pick the embassy and screens, and
// both press Ready. main.js owns the game itself; this only drives the menu.

import { TUNING } from './tuning.js';
import { OnlineGame, newCode, cleanCode, inviteLink, serverUrl } from './online.js';

const $ = (id) => document.getElementById(id);

export const SCREEN_OPTIONS = [
  { id: 'both', name: 'Both monitors', note: 'like the original TV' },
  { id: 'rivalOff', name: "Rival's monitor off", note: 'static unless you share a room' },
  { id: 'one', name: 'One big monitor', note: 'just your own spy' },
];

export function setupLobby({ store, onStart, onLeave, onSnap, onPause, onResume, onForfeit, unlock }) {
  let net = null;
  let lobby = null; // the server's latest lobby message
  let page = 'start'; // start | lobby
  let sel = 0;
  let retry = null; // reconnecting after our connection dropped
  let note = ''; // news that stays up until you do something ("Davy left: you win")
  let tries = 0;

  const status = (text) => { $(page === 'lobby' ? 'lobbyStatus' : 'onStatus').textContent = text || ''; };
  const items = () => [...$(page === 'lobby' ? 'onLobby' : 'onStart').querySelectorAll('.item')].filter((b) => !b.hidden && !b.disabled);

  $('onName').value = store.get('da.name', '');
  $('onName').addEventListener('input', () => {
    store.set('da.name', $('onName').value.trim());
    net?.send({ t: 'name', name: $('onName').value });
  });
  $('onCode').addEventListener('input', () => { $('onCode').value = cleanCode($('onCode').value); });

  const showPage = (p) => {
    page = p;
    $('onStart').hidden = p !== 'start';
    $('onLobby').hidden = p !== 'lobby';
    sel = 0;
    refresh();
  };

  function refresh() {
    const all = items();
    sel = Math.min(sel, all.length - 1);
    for (const b of document.querySelectorAll('#online .item')) b.classList.remove('sel');
    all[sel]?.classList.add('sel');
    if (page !== 'lobby' || !lobby) return;
    const creator = lobby.you === 0;
    $('lobbyCode').textContent = net.code;
    $('lobbyLink').textContent = inviteLink(net.code);
    const lv = TUNING.levels[lobby.settings.level];
    const sc = SCREEN_OPTIONS.find((o) => o.id === lobby.settings.screens);
    $('lobbyLevel').innerHTML = `${lv.name}<small>${lv.rooms} rooms · ${lv.minutes} min</small>`;
    $('lobbyScreens').innerHTML = `${sc.name}<small>${sc.note}</small>`;
    for (const a of document.querySelectorAll('#onLobby .arrow')) a.hidden = !creator;
    $('lobbyChooser').textContent = creator ? 'You choose the embassy and screens.' : `${lobby.players[0]?.name ?? 'Scarlet'} chooses the embassy and screens.`;
    lobby.players.forEach((p, i) => {
      const row = $(`lobbyP${i}`);
      row.querySelector('.who').textContent = p ? `${p.name}${i === lobby.you ? ' (you)' : ''}` : 'Waiting for your friend…';
      row.querySelector('.state').textContent = !p ? '' : !p.here ? 'signal lost' : p.ready ? 'READY' : 'not ready';
      row.classList.toggle('ready', !!p?.ready);
    });
    const me = lobby.players[lobby.you];
    $('readyBtn').querySelector('.lab').textContent = me?.ready ? 'Not ready' : 'Ready';
    if (lobby.phase === 'countdown') status(`Starting in ${lobby.countdown}…`);
    else if (note) status(note);
    else if (!lobby.players[1]) status('Send your friend the code or the link.');
    else if (!lobby.players.every((p) => p?.ready)) status('Both spies press Ready to start.');
  }

  function connect(code, create) {
    net?.close();
    clearTimeout(retry);
    status(create ? 'Setting up a game…' : 'Joining…');
    net = new OnlineGame({
      code,
      create,
      name: $('onName').value.trim(),
      on: {
        lobby: (m) => { tries = 0; lobby = m; if (page !== 'lobby') showPage('lobby'); refresh(); },
        start: (m) => onStart(net, m),
        snap: (st, events) => onSnap(st, events),
        pause: (m) => onPause(m),
        resume: () => onResume(),
        forfeit: (m) => onForfeit(m),
        error: (m) => {
          if (m.code === 'taken' && create) { connect(newCode(), true); return; } // code clash: pick another
          const keep = net;
          net = null;
          keep?.close();
          showPage('start');
          status(m.text);
          onLeave(m.text);
        },
        closed: () => reconnect(code),
      },
    });
  }

  // Our connection dropped (Wi-Fi blip, laptop lid): keep trying for a minute.
  function reconnect(code) {
    if (tries++ > 30) {
      net = null;
      showPage('start');
      status('Lost the connection to the game.');
      onLeave('Lost the connection to the game.');
      return;
    }
    onPause({ self: true });
    retry = setTimeout(() => connect(code, false), 2000);
  }

  function create() {
    if (!serverUrl()) { status('Online play isn\'t switched on yet: the game server hasn\'t been set up.'); return; }
    unlock();
    connect(newCode(), true);
  }

  function join(code = cleanCode($('onCode').value)) {
    if (!serverUrl()) { status('Online play isn\'t switched on yet: the game server hasn\'t been set up.'); return; }
    if (code.length !== 4) { status('The code is four letters.'); return; }
    unlock();
    connect(code, false);
  }

  function leave() {
    clearTimeout(retry);
    net?.close();
    net = null;
    lobby = null;
    showPage('start');
    onLeave();
  }

  const change = (key, d) => {
    if (!lobby || lobby.you !== 0 || lobby.phase !== 'lobby') return;
    const s = { ...lobby.settings };
    if (key === 'level') s.level = (s.level + d + TUNING.levels.length) % TUNING.levels.length;
    else {
      const i = SCREEN_OPTIONS.findIndex((o) => o.id === s.screens);
      s.screens = SCREEN_OPTIONS[(i + d + SCREEN_OPTIONS.length) % SCREEN_OPTIONS.length].id;
    }
    net.send({ t: 'settings', ...s });
  };

  const activate = (b) => {
    note = '';
    switch (b.dataset.act) {
      case 'create': return create();
      case 'join': return join();
      case 'back': return onLeave();
      case 'ready': return net?.send({ t: 'ready', on: !lobby?.players[lobby.you]?.ready });
      case 'leave': return leave();
      case 'copy': return copyLink();
      case 'name': return $('onName').focus();
      case 'code': return $('onCode').focus();
    }
    if (b.dataset.set) change(b.dataset.set, 1);
  };

  function copyLink() {
    const text = inviteLink(net.code);
    const done = () => { $('copyBtn').querySelector('.lab').textContent = 'Copied!'; setTimeout(() => { $('copyBtn').querySelector('.lab').textContent = 'Copy invite link'; }, 1500); };
    navigator.clipboard?.writeText(text).then(done, () => window.prompt?.('Copy this link:', text));
  }

  for (const b of document.querySelectorAll('#online .item')) {
    b.addEventListener('click', (e) => {
      if (e.target.closest('input') || e.target.closest('.arrow')) return;
      sel = items().indexOf(b);
      refresh();
      activate(b);
    });
  }
  for (const a of document.querySelectorAll('#online .arrow')) {
    a.addEventListener('click', (e) => { e.stopPropagation(); change(a.closest('[data-set]').dataset.set, Number(a.dataset.d)); });
  }
  for (const inp of [$('onName'), $('onCode')]) {
    inp.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') { e.preventDefault(); inp === $('onCode') ? join() : inp.blur(); }
      e.stopPropagation(); // typing a name mustn't move the menu
    });
  }

  // Keys and controller (as arrow keys / Enter / Escape) while the online menu is up.
  const onKey = (code) => {
    const all = items();
    const b = all[sel];
    if (code === 'ArrowUp' || code === 'KeyW') sel = (sel + all.length - 1) % all.length;
    else if (code === 'ArrowDown' || code === 'KeyS') sel = (sel + 1) % all.length;
    else if ((code === 'ArrowLeft' || code === 'KeyA') && b?.dataset.set) change(b.dataset.set, -1);
    else if ((code === 'ArrowRight' || code === 'KeyD') && b?.dataset.set) change(b.dataset.set, 1);
    else if (code === 'Enter' || code === 'Space') { if (b) activate(b); }
    else if (code === 'Escape' || code === 'Backspace') { page === 'lobby' ? leave() : onLeave(); }
    refresh();
  };

  // Opening the page from an invite link (?join=KMRX) goes straight to joining.
  const invited = cleanCode(new URLSearchParams(location.search).get('join'));

  return {
    onKey,
    open: () => { showPage(net && lobby ? 'lobby' : 'start'); if (invited && !net) { $('onCode').value = invited; status(`You've been invited to game ${invited}. Type your spy's name, then Join.`); sel = items().findIndex((b) => b.dataset.act === 'join'); refresh(); } },
    invited,
    get net() { return net; },
    // After a match, both players come back to the briefing room for a rematch.
    backToLobby: () => { net?.send({ t: 'rematch' }); showPage('lobby'); },
    message: (text) => { note = text; status(text); },
    leave,
  };
}
