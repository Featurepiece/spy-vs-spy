// Loads the game in headless Chromium, plays a few seconds with keyboard
// input, and fails on any console error. Saves screenshots to the folder
// given as the first argument (default: tests/screens).
// Run: npx http-server -p 8123 . & node tests/browser-test.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] || 'tests/screens';
const url = process.argv[3] || 'http://localhost:8123/index.html';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
async function run(name, viewport, isMobile) {
  const page = await browser.newPage({ viewport, isMobile, hasTouch: isMobile });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-title.png` });
  if (!isMobile) {
    // Front menu by keyboard: down to Embassy, right to change it, down twice to How to play, open and close it.
    const level = () => page.evaluate(() => JSON.parse(localStorage.getItem('da.level') ?? '0'));
    const before = await level();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    if ((await level()) === before) errors.push(`${name}: right arrow did not change the embassy size`);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    if (await page.isHidden('#howPanel')) errors.push(`${name}: Enter on How to play did not open it`);
    await page.screenshot({ path: `${out}/${name}-how.png` });
    await page.keyboard.press('Escape');
    if (await page.isHidden('#menuMain')) errors.push(`${name}: Escape did not go back to the menu`);
    if ((await page.evaluate(() => window.__game.screen)) !== 'title') errors.push(`${name}: menu keys left the title screen`);
    await page.waitForTimeout(300);
    if (!(await page.evaluate(() => window.__game.titleMusic))) errors.push(`${name}: title music did not start after a key press`);
  }
  await page.click('#startBtn');
  await page.waitForTimeout(500);
  if (await page.evaluate(() => window.__game.titleMusic)) errors.push(`${name}: title music kept playing in the game`);
  // Wander and search a bit.
  const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
  await hold('ArrowUp', 600);
  await hold('ArrowLeft', 500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}-play.png` });
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-map.png` });
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Digit5');
  await page.keyboard.press('Space');
  await hold('ArrowRight', 1500);
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => ({ t: window.__game.state.t, screen: window.__game.screen, spies: window.__game.state.spies.map((s) => [s.state, s.room, s.score, s.time.toFixed(1)]) }));
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `${out}/${name}-later.png` });
  await page.close();
}
await run('desktop', { width: 1280, height: 860 }, false);
await run('phone', { width: 390, height: 844 }, true);
await run('phone-landscape', { width: 844, height: 390 }, true);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('no console errors');
