// Checks the live server: two scripted players create and join a game, walk
// around for a while, and the server must keep 60 steps a second and send 20
// snapshots a second. Uses the address in src/online-config.js.
// Usage: node test/live-check.mjs [seconds]
import { SERVER_URL } from '../../src/online-config.js';

const SECONDS = Number(process.argv[2]) || 30;
const ORIGIN = 'https://featurepiece.github.io';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!SERVER_URL) { console.log('No server address in src/online-config.js'); process.exit(1); }
console.log(`Server ${SERVER_URL}, game ${code}`);

function connect(slot) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SERVER_URL}/match/${code}`, { headers: { Origin: ORIGIN } });
    const got = { snapshots: 0, bytes: 0, first: 0, last: 0, gaps: [], prevAt: 0, start: false };
    ws.onmessage = (m) => {
      const s = JSON.parse(m.data);
      if (s.t === 'start') got.start = true;
      if (s.t !== 'snap') return;
      const now = Date.now();
      if (!got.first) got.first = now;
      if (got.prevAt) got.gaps.push(now - got.prevAt);
      got.prevAt = got.last = now;
      got.snapshots++;
      got.bytes += m.data.length;
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', create: slot === 0, token: `live${slot}-${code}`, name: `Check${slot}` }));
      resolve({ ws, got });
    };
    ws.onerror = (e) => reject(new Error(`could not connect: ${e.message ?? e.type}`));
  });
}

const players = [await connect(0)];
await wait(500);
players.push(await connect(1));
await wait(500);
for (const { ws } of players) ws.send(JSON.stringify({ t: 'ready', on: true }));
await wait(4000);
if (!players.every((p) => p.got.start)) { console.log('FAIL: the match never started'); process.exit(1); }
const moves = setInterval(() => {
  for (const { ws } of players) {
    const a = Math.random() * Math.PI * 2;
    ws.send(JSON.stringify({ t: 'in', mx: Math.round(Math.cos(a) * 4) / 4, mz: Math.round(Math.sin(a) * 4) / 4, act: Math.random() < 0.3 }));
  }
}, 500);
await wait(SECONDS * 1000);
clearInterval(moves);
const statsUrl = SERVER_URL.replace(/^ws/, 'http') + `/match/${code}/stats`;
const stats = await (await fetch(statsUrl, { headers: { Origin: ORIGIN } })).json();
for (const { ws } of players) { ws.send(JSON.stringify({ t: 'leave' })); ws.close(); }
const g = players[0].got;
const gaps = g.gaps.sort((x, y) => x - y);
const report = {
  serverTicksPerSecond: +stats.ticksPerSecond.toFixed(2),
  serverLongestGapMs: stats.maxGapMs,
  serverMostStepsInOneCallback: stats.maxSteps,
  snapshotsPerSecondReceived: +(g.snapshots / ((g.last - g.first) / 1000)).toFixed(1),
  avgSnapshotBytes: Math.round(g.bytes / g.snapshots),
  snapshotGapMs: { median: gaps[Math.floor(gaps.length / 2)], p99: gaps[Math.floor(gaps.length * 0.99)], max: gaps.at(-1) },
};
console.log(JSON.stringify(report, null, 2));
const ok = report.serverTicksPerSecond > 58 && report.serverTicksPerSecond < 61 && report.snapshotsPerSecondReceived > 18;
console.log(ok ? 'PASS: the live server keeps up' : 'FAIL: the live server fell behind');
process.exit(ok ? 0 : 1);
