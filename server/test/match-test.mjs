// End-to-end check of the online protocol against the server running locally
// (wrangler dev): two players create and join, only the creator can change the
// settings, Ready starts a countdown, the start message keeps hidden things
// secret, "Rival's monitor off" stops sending the rival once they leave the
// room, a dropped player can rejoin, and leaving forfeits.
// Usage: node test/match-test.mjs
import { spawn } from 'node:child_process';
import { DOOR_ANCHOR } from '../../src/data.js';

const PORT = 8798;
const base = `127.0.0.1:${PORT}`;
const ORIGIN = 'http://127.0.0.1:8123';
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
let log = '';
dev.stdout.on('data', (d) => { log += d; });
dev.stderr.on('data', (d) => { log += d; });
const finish = (code) => { process.kill(-dev.pid, 'SIGINT'); process.exit(code); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://${base}/`); return; } catch { await sleep(500); }
  }
  throw new Error('wrangler dev did not start');
}

// A scripted player: remembers the latest message of each kind.
function player(code, hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/match/${code}`, { headers: { Origin: ORIGIN } });
    const p = { ws, last: {}, all: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); p.last[msg.t] = msg; p.all.push(msg); };
    ws.onopen = () => { p.send({ t: 'hello', ...hello }); resolve(p); };
    ws.onerror = reject;
  });
}
async function until(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(30); }
  throw new Error(`timed out waiting for ${what}`);
}

try {
  await waitForServer();

  // Refused from another site
  const res = await fetch(`http://${base}/match/ABCD`, { headers: { Origin: 'https://evil.example' } });
  check(res.status === 403, 'connections from other websites are refused');

  const code = 'KMRX';
  const nobody = await player('ZZZZ', { token: 'x', name: 'Lost' });
  await until(() => nobody.last.error, 5000, 'no-game error');
  check(nobody.last.error.code === 'nogame', 'joining a code nobody created says so');
  nobody.ws.close();

  const a = await player(code, { create: true, token: 'tokA', name: 'Steven' });
  await until(() => a.last.lobby, 5000, 'lobby for A');
  check(a.last.lobby.you === 0, 'creator is Scarlet');
  const b = await player(code, { token: 'tokB', name: 'Old <b>Friend</b> with a long name' });
  await until(() => b.last.lobby && a.last.lobby.players[1], 5000, 'lobby for B');
  check(b.last.lobby.you === 1, 'friend is Cobalt');
  check(a.last.lobby.players[1].name === 'Old bFriendb', `names are cleaned and cut to 12 letters (${a.last.lobby.players[1].name})`);

  const c = await player(code, { token: 'tokC', name: 'Third' });
  await until(() => c.last.error, 5000, 'full error');
  check(c.last.error.code === 'full', 'a third player is turned away');
  c.ws.close();

  b.send({ t: 'settings', level: 2, screens: 'one' });
  await sleep(300);
  check(a.last.lobby.settings.level === 0, 'only the creator can change the settings');
  a.send({ t: 'settings', level: 1, screens: 'rivalOff' });
  await until(() => b.last.lobby.settings.screens === 'rivalOff', 5000, 'settings change');
  check(b.last.lobby.settings.level === 1, 'creator\'s settings reach the friend');
  b.send({ t: 'name', name: 'Davy' });
  await until(() => a.last.lobby.players[1].name === 'Davy', 5000, 'rename');
  check(true, 'renaming in the lobby reaches the other player');

  a.send({ t: 'ready', on: true });
  b.send({ t: 'ready', on: true });
  await until(() => a.last.lobby.phase === 'countdown', 5000, 'countdown');
  check(true, 'both Ready starts the countdown');
  await until(() => a.last.start && b.last.start, 6000, 'start');
  const start = b.last.start;
  check(start.names[0] === 'Steven' && start.names[1] === 'Davy', 'the spies carry the players\' names');
  check(start.embassy.furniture.every((f) => !('contents' in f) && !('trap' in f)), 'start message has no furniture contents or traps');
  check(start.embassy.rooms.length === 13, 'creator\'s embassy size is used (13 rooms)');

  // Walk Scarlet out of the start room through its first door.
  const startRoom = start.embassy.startRoom;
  const side = Object.keys(start.embassy.rooms[startRoom].doors).find((s) => start.embassy.doors[start.embassy.rooms[startRoom].doors[s]] && !start.embassy.doors[start.embassy.rooms[startRoom].doors[s]].exit);
  const [tx, tz] = DOOR_ANCHOR[side];
  const steer = setInterval(() => {
    const s = a.last.snap?.spies[0];
    if (!s) return;
    const dx = tx - s.x, dz = tz - s.z, len = Math.hypot(dx, dz) || 1;
    a.send({ t: 'in', mx: Math.round((dx / len) * 4) / 4, mz: Math.round((dz / len) * 4) / 4 });
  }, 100);
  await until(() => a.last.snap && a.last.snap.spies[0].room !== startRoom, 15000, 'Scarlet leaving the room');
  clearInterval(steer);
  a.send({ t: 'in', mx: 0, mz: 0 });
  await sleep(200);
  check(b.last.snap.spies[0].hidden === true && b.last.snap.spies[0].room === -1, 'with the rival\'s monitor off, Davy no longer gets Scarlet\'s whereabouts');
  check(a.last.snap.spies[0].hidden === undefined, 'Steven still gets his own spy');
  const msgsWithScarlet = b.all.filter((m) => m.t === 'snap').slice(-3).flatMap((m) => m.events).filter((e) => e.spy === 0);
  check(msgsWithScarlet.length === 0, 'and none of Scarlet\'s events');

  // Davy's connection drops: the game pauses, then resumes when he comes back.
  b.ws.close();
  await until(() => a.last.pause, 5000, 'pause');
  check(a.last.pause.waiting === 1, 'a dropout pauses the game and says who it\'s waiting for');
  const tickAtPause = a.last.snap.tick;
  await sleep(500);
  check(a.last.snap.tick === tickAtPause, 'the game clock stops while waiting');
  const b2 = await player(code, { token: 'tokB', name: 'Davy' });
  await until(() => b2.last.start && a.last.resume, 5000, 'rejoin');
  check(b2.last.start.you === 1, 'coming back with the same browser gets the same spy back');
  await sleep(300);
  check(a.last.snap.tick > tickAtPause, 'the game carries on after the rejoin');

  // Leaving mid-game forfeits.
  b2.send({ t: 'leave' });
  await until(() => a.last.forfeit, 5000, 'forfeit');
  check(a.last.forfeit.winner === 0, 'leaving mid-game hands the win to the other spy');

  // Rematch: back to the lobby.
  a.send({ t: 'rematch' });
  await until(() => a.all.at(-1).t === 'lobby' && a.all.at(-1).phase === 'lobby', 5000, 'rematch lobby');
  check(true, 'rematch goes back to the briefing room');

  a.ws.close();
  console.log(failures ? `${failures} check(s) failed` : 'All online checks passed');
  finish(failures ? 1 : 0);
} catch (e) {
  console.error(e);
  console.log(log.slice(-2000));
  finish(1);
}
