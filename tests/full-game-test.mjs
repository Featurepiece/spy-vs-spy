// Plays complete games in the browser with ?autoplay (a computer brain
// controls both spies) at high speed, checks the escape ending plays and
// returns to the menu, all without console errors. Run: npx http-server -p 8123 . & node tests/full-game-test.mjs
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
  for (let i = 0; i < level; i++) await page.click('[data-set="level"] .arrow[data-d="1"]'); // each page starts at Level 1
  await page.click('#startBtn');
  let shots = 0;
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => ({ screen: window.__game.screen, t: window.__game.state.t, sp: window.__game.state.spies.map((s) => s.state) }));
    if (shots < 4 && i % 6 === 5) await page.screenshot({ path: `${out}/auto-L${level}-${shots++}.png` });
    if (g.screen === 'ending') break;
  }
  const g = await page.evaluate(() => ({ screen: window.__game.screen, t: Math.round(window.__game.state.t), winner: window.__game.state.winner, scores: window.__game.state.spies.map((s) => s.score) }));
  console.log(`level ${level + 1}:`, JSON.stringify(g));
  if (g.screen !== 'ending') errors.push(`level ${level + 1} did not reach the ending`);
  else await watchEnding(page, `auto-L${level}`);
  await page.close();
}

// The case where nobody escapes: force both spies out of time.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.click('#startBtn');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = window.__game.state;
    s.spies.forEach((sp) => { sp.state = 'out'; sp.time = 0; });
    s.over = true;
    s.winner = null;
  });
  await page.waitForTimeout(1600);
  const screen = await page.evaluate(() => window.__game.screen);
  if (screen !== 'ending') errors.push('the nobody-escaped case did not reach the ending');
  else await watchEnding(page, 'timeout');
  await page.close();
}

// Screenshots through the scene, then Enter should go back to the menu.
async function watchEnding(page, name) {
  for (const [i, wait] of [300, 1700, 2500, 2500, 1500].entries()) {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${name}-end-${i}.png` });
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__game.screen);
  if (after !== 'title') errors.push(`${name}: Enter during the ending went to "${after}", not the menu`);
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('no console errors');
