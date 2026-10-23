// Headless check: two computer spies play whole games. Catches crashes,
// stuck spies and games that never end. Run with: node tests/sim-test.mjs
import { createGame, step } from '../src/sim.js';
import { CpuBrain } from '../src/ai.js';

const games = Number(process.argv[2] || 30);
let failures = 0;
const results = [];
for (let i = 0; i < games; i++) {
  const level = i % 3;
  const iqA = i % 3, iqB = (i + 1) % 3;
  const state = createGame({ level, cpuIq: iqB, seed: 1000 + i });
  const brains = [new CpuBrain(0, iqA, 7 + i), new CpuBrain(1, iqB, 99 + i)];
  const counts = {};
  let ticks = 0;
  try {
    while (!state.over && ticks < 60 * 60 * 30) {
      const inputs = brains.map((b) => b.think(state));
      step(state, inputs);
      for (const b of brains) b.observe(state, state.events);
      for (const e of state.events) counts[e.type] = (counts[e.type] || 0) + 1;
      ticks++;
    }
  } catch (err) {
    failures++;
    console.error(`game ${i} crashed at tick ${ticks}:`, err);
    continue;
  }
  const s = state.spies;
  results.push({ i, level, iq: [iqA, iqB], over: state.over, winner: state.winner, secs: Math.round(ticks / 60),
    items: s.map((x) => x.items.length + (x.hasCase ? 'C' : '')), score: s.map((x) => x.score),
    traps: counts.trapset || 0, sprung: counts.trap || 0, hits: counts.hit || 0, ko: counts.ko || 0, kicks: counts.guard || 0 });
  if (!state.over) failures++;
}
console.table(results);
const won = results.filter((r) => r.winner !== null).length;
console.log(`${won}/${results.length} games ended with an escape; ${failures} failures`);
process.exit(failures ? 1 : 0);
