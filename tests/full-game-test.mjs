// Plays complete games in the browser with ?autoplay (a computer brain
// controls both spies) at high speed, and checks the game-over screen shows
// without console errors. Run: npx http-server -p 8123 . & node tests/full-game-test.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] || 'tests/screens';
const base = process.argv[3] || 'http://localhost:8123/index.html';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const level of [0, 1]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?autoplay&speed=8`);
  await page.click(`#levelSeg button:nth-child(${level + 1})`);
  await page.click('#startBtn');
  let shots = 0;
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => ({ screen: window.__game.screen, t: window.__game.state.t, sp: window.__game.state.spies.map((s) => s.state) }));
    if (shots < 4 && i % 6 === 5) await page.screenshot({ path: `${out}/auto-L${level}-${shots++}.png` });
    if (g.screen === 'over') break;
  }
  const g = await page.evaluate(() => ({ screen: window.__game.screen, t: Math.round(window.__game.state.t), winner: window.__game.state.winner, scores: window.__game.state.spies.map((s) => s.score) }));
  console.log(`level ${level + 1}:`, JSON.stringify(g));
  await page.screenshot({ path: `${out}/auto-L${level}-over.png` });
  if (g.screen !== 'over') errors.push(`level ${level + 1} did not reach the game-over screen`);
  await page.close();
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('no console errors');
