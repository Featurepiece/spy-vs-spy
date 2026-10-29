// Drives the whole game with a pretend controller: headless Chromium has no
// real one, so navigator.getGamepads is replaced with a stand-in the test
// presses buttons on. Covers the menu, play, pause and the ending, and fails
// on any console error. Run: npx http-server -p 8123 . & node tests/gamepad-test.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] || 'tests/screens';
const url = process.argv[3] || 'http://localhost:8123/index.html';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };

// Standard layout: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 View, 9 Menu, 12-15 D-pad.
const A = 0, B = 1, X = 2, RB = 5, VIEW = 8, START = 9, UP = 12, DOWN = 13, RIGHT = 15;

async function run(name, id, isMobile) {
  const page = await browser.newPage({ viewport: isMobile ? { width: 844, height: 390 } : { width: 1280, height: 860 }, isMobile, hasTouch: isMobile });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.addInitScript((padId) => {
    const pad = { id: padId, index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  }, id);
  await page.goto(url);
  await page.waitForTimeout(300);

  const setBtn = (i, on) => page.evaluate(([i, on]) => { window.__pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; }, [i, on]);
  const press = async (i) => { await setBtn(i, true); await page.waitForTimeout(80); await setBtn(i, false); await page.waitForTimeout(80); };
  const stick = (x, y) => page.evaluate(([x, y]) => { window.__pad.axes[0] = x; window.__pad.axes[1] = y; }, [x, y]);
  const screen = () => page.evaluate(() => window.__game.screen);
  const level = () => page.evaluate(() => JSON.parse(localStorage.getItem('da.level') ?? '0'));

  // Menu: D-pad down to Embassy, right changes it, back again; down to Controls, A opens, B closes.
  await press(DOWN);
  const before = await level();
  await press(RIGHT);
  check((await level()) !== before, `${name}: D-pad right did not change the embassy size`);
  await stick(-1, 0); await page.waitForTimeout(100); await stick(0, 0); await page.waitForTimeout(80);
  check((await level()) === before, `${name}: stick left did not change the embassy size back`);
  for (let i = 0; i < 3; i++) await press(DOWN);
  await press(A);
  check(!(await page.isHidden('#keysPanel')), `${name}: A on Controls did not open it`);
  const hint = await page.textContent('#menuHint');
  await page.screenshot({ path: `${out}/pad-${name}-controls.png` });
  await press(B);
  check(!(await page.isHidden('#menuMain')), `${name}: B did not go back to the menu`);

  // Holding down repeats: from Controls it should wrap round and keep moving.
  await setBtn(DOWN, true); await page.waitForTimeout(800); await setBtn(DOWN, false); await page.waitForTimeout(80);
  const selIdx = () => page.evaluate(() => [...document.querySelectorAll('#menuList .item')].findIndex((b) => b.classList.contains('sel')));
  const selAfterHold = await selIdx();
  const count = await page.evaluate(() => document.querySelectorAll('#menuList .item').length);
  const stepsDown = (selAfterHold - 4 + count) % count; // steps down from Controls, wrapping round
  check(stepsDown >= 2, `${name}: holding down did not repeat (selection ${selAfterHold})`);
  for (let i = 0; i < 6 && (await selIdx()) !== 0; i++) await press(UP);
  await press(A); // Start mission
  check((await screen()) === 'play', `${name}: A on Start mission did not start a game`);
  check(!(await page.evaluate(() => document.getElementById('touch').classList.contains('on'))), `${name}: touch buttons showed while a controller is in use`);

  // Play: walk, search, pick a trap, jab, open and close the map.
  const at = await page.evaluate(() => { const s = window.__game.state.spies[0]; return [s.x, s.z]; });
  await stick(0, -1); await page.waitForTimeout(500); await stick(-1, 0); await page.waitForTimeout(400); await stick(0, 0);
  const moved = await page.evaluate(() => { const s = window.__game.state.spies[0]; return [s.x, s.z]; });
  check(moved[0] !== at[0] || moved[1] !== at[1], `${name}: the stick did not move the spy`);
  await press(A);
  await page.waitForTimeout(500);
  await press(RB);
  const armed = await page.evaluate(() => window.__game.state.spies[0].armed);
  check(!!armed, `${name}: RB did not pick a trap`);
  await press(RB);
  await press(X);
  await page.screenshot({ path: `${out}/pad-${name}-play.png` });
  await press(VIEW);
  await page.waitForTimeout(200);
  // The map is refused while the rival is in the same room, so only expect it when alone.
  const m = await page.evaluate(() => { const [me, cpu] = window.__game.state.spies; return { open: me.mapOpen, together: me.room === cpu.room, action: me.action }; });
  check(m.open || m.together, `${name}: View did not open the map ${JSON.stringify(m)}`);
  await press(VIEW);

  // Pause with Start, move to Quit and back, resume with B; then pause and quit with A.
  await press(START);
  check((await screen()) === 'paused', `${name}: Start did not pause`);
  await press(DOWN); await press(DOWN);
  await page.screenshot({ path: `${out}/pad-${name}-paused.png` });
  await press(B);
  check((await screen()) === 'play', `${name}: B did not resume`);
  await press(START);
  await press(RIGHT);
  await press(A);
  check((await screen()) === 'title', `${name}: A on Quit to menu did not quit`);

  // The ending: start again, end the game, A returns to the menu.
  await press(A);
  check((await screen()) === 'play', `${name}: A did not start a second game`);
  await page.evaluate(() => {
    const s = window.__game.state;
    s.spies.forEach((sp) => { sp.state = 'out'; sp.time = 0; });
    s.over = true;
    s.winner = null;
  });
  await page.waitForTimeout(1600);
  check((await screen()) === 'ending', `${name}: did not reach the ending`);
  // A is ignored until the "Press A" line shows, so keep pressing for up to 15 s.
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/pad-${name}-ending.png` });
  for (let i = 0; i < 30 && (await screen()) === 'ending'; i++) { await press(A); await page.waitForTimeout(500); }
  check((await screen()) === 'title', `${name}: A during the ending did not go back to the menu`);

  // Touching the keyboard switches the hints back.
  await page.keyboard.press('ArrowDown');
  const keyHint = await page.textContent('#menuHint');
  console.log(name, JSON.stringify({ padHint: hint, keyHint }));
  await page.close();
  return hint;
}

const xbox = await run('xbox', 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', false);
check(xbox.includes('A select') && xbox.includes('B back'), `xbox: menu hint was "${xbox}"`);
const ps = await run('playstation', '054c-0ce6-DualSense Wireless Controller', false);
check(ps.includes('✕ select') && ps.includes('○ back'), `playstation: menu hint was "${ps}"`);
await run('tablet', 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', true);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('no console errors');
