// Runs the server locally (wrangler dev), connects two players, walks them
// around for a while and checks the game loop keeps up with 60 steps a second.
// Usage: node test/loop-test.mjs [seconds]
import { spawn } from 'node:child_process';

const SECONDS = Number(process.argv[2]) || 20;
const PORT = 8799;
const base = `127.0.0.1:${PORT}`;
const code = 'TEST';

const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
dev.stdout.on('data', (d) => { log += d; });
dev.stderr.on('data', (d) => { log += d; });
const stop = (code) => { process.kill(-dev.pid, 'SIGINT'); process.exit(code); };

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://${base}/`); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  console.log(log);
  throw new Error('wrangler dev did not start');
}

function connect(slot) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/match/${code}?slot=${slot}&seed=42`);
    const got = { snapshots: 0, bytes: 0, events: 0, lastTick: 0, rooms: new Set() };
    ws.onmessage = (m) => {
      const s = JSON.parse(m.data);
      got.snapshots++;
      got.bytes += m.data.length;
      got.events += s.events.length;
      got.lastTick = s.tick;
      got.rooms.add(s.spies[slot].room);
    };
    ws.onopen = () => resolve({ ws, got });
    ws.onerror = reject;
  });
}

try {
  await waitForServer();
  const players = [await connect(0), await connect(1)];
  // Each player changes direction every half second and sometimes searches or jabs.
  let sent = 0;
  const moves = setInterval(() => {
    for (const { ws } of players) {
      const a = Math.random() * Math.PI * 2;
      ws.send(JSON.stringify({ mx: Math.cos(a), mz: Math.sin(a), act: Math.random() < 0.3, jab: Math.random() < 0.1 }));
      sent++;
    }
  }, 500);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(moves);
  const stats = await (await fetch(`http://${base}/match/${code}/stats`)).json();
  for (const { ws } of players) ws.close();
  const report = {
    seconds: +stats.seconds.toFixed(1),
    ticksPerSecond: +stats.ticksPerSecond.toFixed(2),
    timerCallbacks: stats.callbacks,
    mostStepsInOneCallback: stats.maxSteps,
    longestGapMs: stats.maxGapMs,
    snapshotsPerSecondReceived: +(players[0].got.snapshots / stats.seconds).toFixed(1),
    avgSnapshotBytes: Math.round(players[0].got.bytes / players[0].got.snapshots),
    messagesSentByPlayers: sent,
    roomsVisited: players.map((p) => p.got.rooms.size),
  };
  console.log(JSON.stringify(report, null, 2));
  const ok = report.ticksPerSecond > 58 && report.ticksPerSecond < 61 && report.snapshotsPerSecondReceived > 19;
  console.log(ok ? 'PASS: the game loop keeps up' : 'FAIL: the game loop fell behind');
  stop(ok ? 0 : 1);
} catch (e) {
  console.error(e);
  console.log(log.slice(-3000));
  stop(1);
}
