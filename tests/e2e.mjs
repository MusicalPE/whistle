// 전체 시험: 미리보기 상태로 화면을 실제로 띄워 선생님·학생·전광판 흐름을 밟아 본다.
// 실행: node tests/e2e.mjs  (playwright 가 필요하다. 다른 곳에 깔려 있으면 PLAYWRIGHT_PATH 로 알려 준다.)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pwPath = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean).find((p) => { try { require.resolve(p); return true; } catch { return false; } });
if (!pwPath) { console.error('playwright 를 찾을 수 없습니다.'); process.exit(2); }
const { chromium } = require(pwPath);
const shots = process.env.SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, p === '/' ? 'index.html' : p);
  try { res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
// 시험은 파이어베이스에 닿지 않도록 항상 미리보기로 돌린다.
await ctx.addInitScript(() => localStorage.setItem('whistle-force-demo', '1'));
const errors = [];
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
};
const steps = [];
const step = async (name, fn) => { await fn(); steps.push(name); };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }); };
const btn = (page, name) => page.locator('#app').getByRole('button', { name, exact: true });
const sbtn = (page, name) => page.locator('#sheet').getByRole('button', { name, exact: true });
const text = (page) => page.locator('#app').innerText();
const names = ['강태윤', '한지우', '오세린', '배준서', '임하늘', '문도윤', '서가온', '채은호'];

const t = await ctx.newPage(); watch(t, '선생님');
let tid;

async function addTeam(name, players) {
  await t.getByRole('button', { name: '+ 팀 추가' }).click();
  await t.fill('#nt-name', name);
  await sbtn(t, '추가').click();
  if (!players.length) return;
  await btn(t, '명단 붙여넣기').click();
  await t.fill('#paste', players.join('\n'));
  await sbtn(t, '명단에 넣기').click();
}
async function addGrade(label, sport) {
  await t.goto(`${base}#home`);
  await t.getByRole('button', { name: '+ 학년 추가' }).click();
  await t.fill('#ng-label', label);
  await t.selectOption('#ng-sport', sport);
  await sbtn(t, '추가').click();
}
async function addGameAndOpen() {
  await t.goto(`${base}#home`);
  await t.getByRole('button', { name: '+ 경기 추가' }).click();
  await sbtn(t, '추가').click();
  await t.locator('a.game').last().click();
}

try {
  await step('미리보기로 들어가 대회 만들기', async () => {
    await t.goto(base);
    await btn(t, '미리보기로 시작').click();
    await t.fill('#new-t', '햇살초 스포츠클럽 리그');
    await btn(t, '대회 만들기').click();
    await t.waitForSelector('text=학생용 화면 QR');
    tid = await t.evaluate(() => localStorage.getItem('whistle-tid'));
    assert.ok(tid);
    assert.ok(await t.locator('.qr svg').count(), 'QR 그림이 그려져야 함');
  });

  await step('학년(풋살) 추가, 팀 두 팀과 명단 넣기', async () => {
    await addGrade('6학년', 'futsal');
    await t.goto(`${base}#teams`);
    await addTeam('6-1 번개', names.map((n, i) => `${i + 1} ${n}`));
    assert.match(await text(t), /선수 8명 · 선발 5 \/ 교체 3/);
    await addTeam('6-2 돌풍', names.map((n, i) => `${i + 11} ${n}`));
    await t.fill('#p-no', '99'); await t.fill('#p-name', '추가선수'); await btn(t, '추가').click();
    assert.match(await text(t), /선수 9명 · 선발 5 \/ 교체 4/);
    await t.getByRole('button', { name: '추가선수 지우기' }).click();
    assert.match(await text(t), /선수 8명/);
    await shot(t, '04-teams');
  });

  await step('경기 추가하고 시작', async () => {
    await addGameAndOpen();
    await btn(t, '경기 시작').click();
    await t.waitForSelector('text=남은 시간');
    assert.match(await t.locator('[data-clock]').innerText(), /^(10:00|09:5\d)$/);
  });

  await step('득점 선수 고르기, 점수 빼기(득점 취소), 다시 득점', async () => {
    await t.locator('[data-act="gPlus"][data-team="a"]').click();
    await t.waitForSelector('text=누가 넣었나요?');
    await shot(t, '02b-picker');
    await t.locator('#sheet .pl').nth(1).click();
    await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent === '1');
    assert.match(await text(t), /6-1 번개 득점 · 2 한지우/);
    await t.locator('[data-act="gMinus"][data-team="a"]').click();
    await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent === '0');
    assert.match(await text(t), /\(취소\)/);
    await t.locator('[data-act="gPlus"][data-team="a"]').click();
    await t.getByRole('button', { name: /선수 없이 점수만/ }).click();
    await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent === '1');
    assert.match(await text(t), /선수 기록 없음/);
  });

  await step('선수 교체: 카드 차감과 기록', async () => {
    await t.locator('a[href^="#sub/"]').first().click();
    await t.waitForSelector('text=나가는 선수');
    assert.ok(await btn(t, '교체 확정 · 카드 1장 사용').isDisabled());
    await t.locator('[data-kind="out"]').first().click();
    await t.locator('[data-kind="in"]').first().click();
    await shot(t, '03-sub');
    await btn(t, '교체 확정 · 카드 1장 사용').click();
    await t.waitForSelector('text=교체 카드 2장 남음');
    assert.match(await text(t), /6-1 번개 교체 · 1 강태윤 나감 → 6 문도윤 들어감/);
    await shot(t, '02-live');
  });

  const s = await ctx.newPage(); watch(s, '학생');
  const b = await ctx.newPage(); watch(b, '전광판');
  await b.setViewportSize({ width: 1280, height: 720 });

  await step('학생 화면과 전광판이 실시간으로 바뀜', async () => {
    await s.goto(`${base}?v=${tid}`);
    await s.waitForSelector('text=학생용 · 보기 전용');
    assert.match(await text(s), /1 : 0/);
    assert.match(await text(s), /뛰는 중[\s\S]*6 문도윤[\s\S]*교체 선수[\s\S]*1 강태윤 나감/);
    assert.equal(await s.locator('[data-act="gPlus"]').count(), 0, '학생 화면에는 조작 단추가 없어야 함');
    await b.goto(`${base}?b=${tid}`);
    await b.waitForSelector('.board .pts');
    assert.equal(await b.locator('.board .pts').first().innerText(), '1');
    await t.locator('[data-act="gPlus"][data-team="b"]').click();
    await t.locator('#sheet .pl').first().click();
    await s.waitForFunction(() => /1 : 1/.test(document.body.innerText));
    await b.waitForFunction(() => document.querySelectorAll('.board .pts')[1].textContent === '1');
    await shot(s, '06-student'); await shot(b, '07-board');
  });

  await step('전반 끝내기 → 후반 → 경기 종료, 순위표', async () => {
    await btn(t, '전반 끝내기').click();
    await t.waitForSelector('text=후반 끝내기').catch(() => {});
    assert.match(await text(t), /전반 종료 1 : 1/);
    await t.locator('[data-act="gPlus"][data-team="a"]').click();
    await t.locator('#sheet .pl').first().click();
    await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent === '2');
    await btn(t, '경기 종료').click();
    await sbtn(t, '경기 종료').click();
    await t.waitForFunction(() => /경기 종료 2 : 1/.test(document.body.innerText));
    assert.equal(await t.locator('[data-act="gPlus"]').count(), 0);
    await s.getByRole('button', { name: '경기 결과' }).click();
    assert.match(await text(s), /순위표[\s\S]*6-1 번개\s*1\s*1\s*0\s*0\s*3/);
  });

  await step('개인 기록을 선생님만 보고 전광판에 띄우기', async () => {
    await t.goto(`${base}#records`);
    await t.waitForSelector('text=전광판에 띄워서 보여 주기');
    await t.getByRole('button', { name: /6 문도윤/ }).click();
    assert.match(await text(t), /6 문도윤[\s\S]*1경기 6-2 돌풍전 · 교체 투입/);
    assert.doesNotMatch(await text(s), /개인 기록/);
    await shot(t, '05-records');
    await btn(t, '전광판에 띄워서 보여 주기').click();
    await b.waitForFunction(() => /개인 기록/.test(document.body.innerText));
    await btn(t, '전광판에서 내리기').click();
    await b.waitForFunction(() => !/개인 기록/.test(document.body.innerText));
  });

  await step('설정: 규칙 바꾸기와 종목 바꾸면 기본값 채우기', async () => {
    await t.goto(`${base}#settings`);
    await t.getByRole('button', { name: '교체 카드 늘리기' }).click();
    await t.waitForSelector('text=4장');
    await t.selectOption('#g-sport', 'netball');
    await t.waitForFunction(() => document.querySelector('#g-format').value === 'quarters');
    assert.deepEqual(await t.locator('#g-format option').allInnerTexts(), ['전·후반', '쿼터']);
    await t.selectOption('#g-format', 'halves');
    await t.waitForFunction(() => document.querySelector('#g-format').value === 'halves');
    await t.selectOption('#g-sport', 'futsal');
    await t.fill('#t-title', '햇살초 리그'); await t.locator('#t-title').blur();
    await s.waitForFunction(() => /햇살초 리그/.test(document.body.innerText));
    await shot(t, '08-settings');
  });

  await step('피구: 전원 아웃, 시간 종료 동점에서 연장 고르기', async () => {
    await addGrade('5학년', 'dodge');
    await t.goto(`${base}#settings`);
    for (let i = 0; i < 7; i++) await t.getByRole('button', { name: '선발 인원 줄이기' }).click();
    await t.waitForSelector('text=3명');
    await t.goto(`${base}#teams`);
    await addTeam('5-1 한빛', ['1 가', '2 나', '3 다']);
    await addTeam('5-2 가람', ['1 라', '2 마', '3 바']);
    await addGameAndOpen();
    await btn(t, '경기 시작').click();
    const out = (team) => t.locator(`[data-act="dOut"][data-team="${team}"][data-d="-1"]`).click();
    await out('b'); await out('b');
    await t.waitForFunction(() => document.querySelector('[data-score="b"]').textContent === '1');
    await out('b');
    await t.waitForFunction(() => /1세트 5-1 한빛 승 \(전원 아웃/.test(document.body.innerText));
    assert.equal(await t.locator('[data-score="b"]').innerText(), '3');
    await btn(t, '시계 시작').click();
    const gameId = (await t.evaluate(() => location.hash)).split('/')[1];
    // 다른 창에서 시계를 거의 끝난 상태로 바꿔, 시간 종료가 자동으로 처리되는지 본다.
    await s.evaluate(([tidv, gid]) => {
      const root = JSON.parse(localStorage.getItem('whistle-demo-v1'));
      root.t[tidv].games[gid].clock = { run: true, left: 400, at: Date.now() };
      localStorage.setItem('whistle-demo-v1', JSON.stringify(root));
    }, [tid, gameId]);
    await t.waitForSelector('text=남은 인원이 같습니다');
    await shot(t, '09-dodge-tie');
    await btn(t, '연장 하기').click();
    await t.waitForSelector('text=연장입니다');
    await out('a');
    await t.waitForFunction(() => /2세트 5-2 가람 승 \(연장\)/.test(document.body.innerText));
    await out('a'); await out('a'); await out('a');
    await t.waitForFunction(() => /경기 종료 1 : 2/.test(document.body.innerText));
    await shot(t, '10-dodge-done');
  });

  for (const [label, sport, check] of [['4학년', 'volley', '세트 스코어'], ['3학년', 'teeball', '공격'], ['2학년', 'basket', '+3'], ['1학년', 'netball', '1쿼터']]) {
    await step(`${sport}: 점수판이 열리고 득점·다음 구간이 됨`, async () => {
      await addGrade(label, sport);
      await t.goto(`${base}#teams`);
      await addTeam(`${label} 가`, []); await addTeam(`${label} 나`, []);
      await addGameAndOpen();
      await btn(t, '경기 시작').click();
      await t.waitForFunction((c) => document.body.innerText.includes(c), check);
      await t.locator('[data-act="gPlus"][data-team="a"]').first().click();
      await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent !== '0');
      await t.locator('[data-act="gNext"]').click();
      await t.waitForFunction(() => document.querySelectorAll('.log').length >= 2);
      await shot(t, `11-${sport}`);
    });
  }

  await step('초대 코드 화면, 대회 목록으로 나갔다 다시 열기', async () => {
    await t.goto(`${base}#members`);
    await t.waitForFunction(() => /[A-Z]{2}\d{4}/.test(document.body.innerText));
    await shot(t, '12-members');
    await t.goto(`${base}#home`);
    await shot(t, '01-home');
    await btn(t, '대회 목록').click();
    await t.waitForSelector('text=내 대회');
    await t.getByRole('button', { name: /햇살초 리그/ }).click();
    await t.waitForSelector('text=학생용 화면 QR');
    await t.reload();
    await t.waitForSelector('text=학생용 화면 QR');
  });

  await step('PC 화면: 메뉴는 왼쪽, 내용은 두 칸', async () => {
    await t.setViewportSize({ width: 1280, height: 800 });
    await t.goto(`${base}#home`);
    await t.waitForSelector('text=학생용 화면 QR');
    const nav = await t.locator('.nav').boundingBox();
    assert.ok(nav.x < 100 && nav.height > 600 && nav.width < 260, '메뉴가 왼쪽 세로로 있어야 함');
    const cols = await t.locator('.cols > .col').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    assert.ok(cols[1] - cols[0] > 300, '두 칸이 나란히 있어야 함');
    await shot(t, '20-pc-home');
    await t.locator('a.game').first().click();
    await t.waitForSelector('.score');
    await shot(t, '21-pc-game');
    await t.goto(`${base}#records`); await shot(t, '22-pc-records');
    await t.goto(`${base}#teams`); await shot(t, '23-pc-teams');
    await t.setViewportSize({ width: 390, height: 844 });
    await t.goto(`${base}#home`);
    const m = await t.locator('.nav').boundingBox();
    assert.ok(m.width > 380 && m.height < 70, '폰에서는 메뉴가 아래 가로로 있어야 함');
  });

  assert.deepEqual(errors, [], '화면 오류가 없어야 함');
  console.log(`전체 시험 통과: ${steps.length}단계\n- ${steps.join('\n- ')}`);
} catch (e) {
  console.error(`전체 시험 실패 (${steps.length}단계까지 통과)\n`, e, '\n화면 오류:', errors);
  if (shots) await shot(t, 'fail');
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
