// Two browsers play each other online through the server running locally.
// Steven creates a game, his friend opens the invite link, both press Ready,
// and Steven walks right: the friend's screen must show Scarlet moving. Then
// the same with "Rival's monitor off" and "One big monitor". Fails on any
// console error. Saves screenshots to the folder given (default tests/screens).
// Run: npx http-server -p 8123 . & node tests/online-test.mjs
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const out = process.argv[2] || 'tests/screens';
const site = process.argv[3] || 'http://127.0.0.1:8123/index.html';
const PORT = 8797;
const server = `ws://127.0.0.1:${PORT}`;
mkdirSync(out, { recursive: true });

const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: 'server', detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
let devLog = '';
dev.stdout.on('data', (d) => { devLog += d; });
dev.stderr.on('data', (d) => { devLog += d; });
for (let i = 0; i < 60; i++) {
  try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
}

const browser = await chromium.launch();
const errors = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) errors.push(what); };
async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); // own storage = own browser
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  return page;
}
const game = (page) => page.evaluate(() => {
  const g = window.__game;
  return { screen: g.screen, spies: g.state?.spies.map((s) => ({ name: s.name, room: s.room, x: s.x, hidden: !!s.hidden })) };
});
async function until(page, fn, arg, ms = 10000) {
  await page.waitForFunction(fn, arg, { timeout: ms });
}

async function match(screens, label) {
  const steven = await open('steven');
  await steven.goto(`${site}?server=${server}`);
  await steven.click('[data-act="online"]');
  await steven.fill('#onName', 'Steven');
  await steven.click('[data-act="create"]');
  await until(steven, () => document.getElementById('lobbyCode').textContent.length === 4);
  const code = await steven.textContent('#lobbyCode');
  const link = await steven.textContent('#lobbyLink');
  check(link.includes(`join=${code}`), `${label}: invite link carries the code ${code}`);
  for (let i = 0; i < screens; i++) await steven.click('[data-set="screens"] .arrow[data-d="1"]');

  const friend = await open('friend');
  await friend.goto(link);
  await until(friend, () => !document.getElementById('online').hidden);
  check((await friend.inputValue('#onCode')) === code, `${label}: the invite link fills in the code`);
  await friend.fill('#onName', 'Davy');
  await friend.click('[data-act="join"]');
  await until(steven, () => document.querySelector('#lobbyP1 .who').textContent.startsWith('Davy'));
  await steven.screenshot({ path: `${out}/online-${label}-lobby.png` });
  check((await friend.locator('#onLobby .arrow').first().isHidden()), `${label}: the friend can't change the settings`);

  await steven.click('#readyBtn');
  await friend.click('#readyBtn');
  await until(steven, () => window.__game.screen === 'play', null, 8000);
  await until(friend, () => window.__game.screen === 'play', null, 8000);
  const s0 = await game(steven), f0 = await game(friend);
  check(s0.spies[0].name === 'Steven' && f0.spies[1].name === 'Davy', `${label}: both screens show the players' names`);

  // Steven walks right for a second: Davy's screen must see it (same room at the start).
  await steven.keyboard.down('KeyD');
  await steven.waitForTimeout(1000);
  await steven.keyboard.up('KeyD');
  await steven.waitForTimeout(300);
  const s1 = await game(steven), f1 = await game(friend);
  check(s1.spies[0].x > s0.spies[0].x + 0.05, `${label}: Steven's spy moved on his screen (${s0.spies[0].x.toFixed(2)} → ${s1.spies[0].x.toFixed(2)})`);
  check(Math.abs(f1.spies[0].x - s1.spies[0].x) < 0.05, `${label}: Davy sees Scarlet in the same place`);
  await steven.screenshot({ path: `${out}/online-${label}-steven.png` });
  await friend.screenshot({ path: `${out}/online-${label}-davy.png` });
  // Canvas height says how many monitors are drawn: one for "one big monitor".
  const ratio = await friend.evaluate(() => { const c = document.getElementById('game'); return c.clientHeight / c.clientWidth; });
  check(screens === 2 ? ratio < 0.5 : ratio > 0.5, `${label}: ${screens === 2 ? 'one monitor' : 'two monitors'} on screen (height/width ${ratio.toFixed(2)})`);

  // Davy leaves through the menu: Steven wins and goes back to the briefing room.
  await friend.keyboard.press('Escape');
  await friend.click('#quitBtn');
  await until(steven, () => window.__game.screen === 'online', null, 8000);
  check((await steven.textContent('#lobbyStatus')).includes('You win'), `${label}: Steven is told Davy left and he wins`);
  await steven.close();
  await friend.close();
}

try {
  await match(0, 'both');
  await match(1, 'rivaloff');
  await match(2, 'one');
} catch (e) {
  errors.push(e.message);
  console.log(devLog.slice(-1500));
}
await browser.close();
process.kill(-dev.pid, 'SIGINT');
if (errors.length) { console.log(`FAILED:\n${errors.join('\n')}`); process.exit(1); }
console.log('Online browser test passed');
