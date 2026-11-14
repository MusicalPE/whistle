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
    await t.waitForSelector('text=누가 어시스트 했나요?');
    assert.equal(await t.locator('#sheet .pl').count(), 4, '어시스트 후보에는 득점한 선수가 빠져야 함');
    await shot(t, '02c-assist');
    await t.locator('#sheet .pl').first().click();
    await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent === '1');
    assert.match(await text(t), /6-1 번개 득점 · 2 한지우 \(어시스트 1 강태윤\)/);
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
    await sbtn(t, '어시스트 없음').click();
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
    await sbtn(t, '어시스트 없음').click();
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
    await t.goto(`${base}#home`);
    assert.equal(await t.locator('.nav a:not(.navbrand)').count(), 3, '메뉴는 홈·경기·대회 설정');
    await t.locator('.submenu a', { hasText: '종목·규칙' }).click();
    await t.waitForSelector('text=6학년 종목·규칙');
    await t.getByRole('button', { name: '교체 카드 늘리기' }).click();
    await t.waitForSelector('text=4장');
    await t.selectOption('#g-sport', 'netball');
    await t.waitForFunction(() => document.querySelector('#g-format').value === 'quarters');
    assert.deepEqual(await t.locator('#g-format option').allInnerTexts(), ['전·후반', '쿼터']);
    assert.equal(await t.locator('text=득점 단추').count(), 0, '넷볼 설정에는 득점 단추 고르기가 없어야 함');
    await t.selectOption('#g-format', 'halves');
    await t.waitForFunction(() => document.querySelector('#g-format').value === 'halves');
    await t.selectOption('#g-sport', 'futsal');
    await t.goto(`${base}#settings`);
    await t.fill('#t-title', '햇살초 리그'); await t.locator('#t-title').blur();
    await s.waitForFunction(() => /햇살초 리그/.test(document.body.innerText));
    await shot(t, '08-settings');
  });

  await step('피구: 전원 아웃, 시간 종료 동점에서 연장 고르기', async () => {
    await addGrade('5학년', 'dodge');
    await t.goto(`${base}#rules`);
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
      assert.equal(await t.locator('[data-act="gPlus"][data-pts="3"]').count(), sport === 'basket' ? 2 : 0, '1·2·3점 단추는 농구에만');
      if (sport === 'teeball') {
        assert.ok(await t.locator('[data-act="gPlus"][data-team="b"]').isDisabled(), '초에는 나중 팀이 수비라 득점 단추가 꺼져 있어야 함');
        assert.match(await text(t), /공격[\s\S]*수비/);
      }
      await t.locator('[data-act="gPlus"][data-team="a"]').first().click();
      await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent !== '0');
      await t.locator('[data-act="gNext"]').click();
      await t.waitForFunction(() => document.querySelectorAll('.log').length >= 2);
      if (sport === 'teeball') {
        await t.waitForSelector('text=1회 말');
        assert.ok(await t.locator('[data-act="gPlus"][data-team="a"]').isDisabled(), '말에는 먼저 팀이 수비');
        await t.locator('[data-act="gPlus"][data-team="b"]').click();
        await t.waitForFunction(() => document.querySelector('[data-score="b"]').textContent === '1');
      }
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
    assert.match(await t.locator('.tcard').first().innerText(), /내가 만든 대회[\s\S]*햇살초 리그[\s\S]*6학년 풋살[\s\S]*경기 \d+개/);
    await shot(t, '19-list');
    await t.getByRole('button', { name: /햇살초 리그/ }).click();
    await t.waitForSelector('text=학생용 화면 QR');
    await t.reload();
    await t.waitForSelector('text=학생용 화면 QR');
  });

  await step('학교 명단(선택): 반 등록, 팀 명단에서 체크해서 불러오기', async () => {
    await t.goto(`${base}#home`);
    await t.getByRole('button', { name: /^6학년/ }).click();
    await t.locator('.submenu a', { hasText: '팀 명단' }).click();
    await t.waitForSelector('text=6학년 팀 명단');
    await btn(t, '학교 명단에서 불러오기').click();
    await t.waitForSelector('text=학교 명단이 아직 없습니다');
    await sbtn(t, '학교 명단 등록하러 가기').click();
    await t.waitForSelector('text=학교 명단 · 선택');
    await t.getByRole('button', { name: '+ 반 추가' }).click();
    await t.fill('#nc-name', '6학년 1반'); await sbtn(t, '추가').click();
    await btn(t, '명단 붙여넣기').click();
    await t.fill('#paste', '21 노아린\n22 표민재\n23 길서우\n양도현'); await sbtn(t, '명단에 넣기').click();
    await t.waitForSelector('text=4명');
    assert.match(await text(t), /24\s*양도현/);
    await t.fill('#s-name', '선유나'); await btn(t, '추가').click();
    await t.waitForSelector('text=5명');
    await t.goto(`${base}#home`);
    await t.getByRole('button', { name: /^6학년/ }).click();
    await t.locator('.submenu a', { hasText: '팀 명단' }).click();
    await t.waitForSelector('text=6학년 팀 명단');
    const before = Number((await text(t)).match(/선수 (\d+)명/)[1]);
    await btn(t, '학교 명단에서 불러오기').click();
    await t.waitForSelector('#im-class');
    assert.ok(await sbtn(t, '0명 팀 명단에 넣기').isDisabled());
    await t.locator('#sheet .pl').nth(0).click(); await t.locator('#sheet .pl').nth(2).click();
    await shot(t, '13-import');
    await sbtn(t, '2명 팀 명단에 넣기').click();
    await t.waitForFunction((n) => new RegExp(`선수 ${n}명`).test(document.body.innerText), before + 2);
    assert.match(await text(t), /21\s*노아린[\s\S]*23\s*길서우/);
    await btn(t, '학교 명단에서 불러오기').click();
    await sbtn(t, '모두 고르기').click();
    await sbtn(t, '5명 팀 명단에 넣기').click();
    await t.waitForFunction((n) => new RegExp(`선수 ${n}명`).test(document.body.innerText), before + 5);
    assert.doesNotMatch(await text(s), /노아린/, '경기 전에 넣은 선수는 끝난 경기의 학생 화면에 나오지 않아야 함');
  });

  await step('티볼 타석 기록: 루 상황, 안타·홈런·아웃, 취소, 전원 타격제 공수 교대, 개인 기록', async () => {
    await addGrade('티볼반', 'teeball');
    await t.goto(`${base}#rules`);
    for (let i = 0; i < 7; i++) await t.getByRole('button', { name: '선발 인원 줄이기' }).click();
    await t.waitForSelector('text=3명');
    await btn(t, '타석 기록').click();
    await t.waitForSelector('text=전원 타격제');
    await t.getByRole('button', { name: '최대 진루 줄이기' }).click();
    await t.waitForSelector('text=2루');
    await t.goto(`${base}#teams`);
    await addTeam('티볼 가', ['1 가람', '2 나래', '3 다온']);
    await addTeam('티볼 나', ['1 라온', '2 마루', '3 바다']);
    await addGameAndOpen();
    await btn(t, '경기 시작').click();
    await t.waitForSelector('text=지금 타자 · 1번');
    assert.equal(await t.locator('[data-batter]').innerText(), '1 가람');
    assert.equal(await t.locator('[data-act="gPlus"]').count(), 0, '타석 기록에서는 득점 단추가 없어야 함');
    assert.equal(await btn(t, '3루타').count(), 0, '최대 진루가 2루면 3루타 단추가 없어야 함');
    assert.match(await text(t), /홈런이 아니면 2루까지/);
    await btn(t, '1루타').click();
    await t.waitForFunction(() => document.querySelector('[data-batter]').textContent === '2 나래');
    assert.match(await text(t), /1루\s*1 가람/);
    await btn(t, '2루타').click();
    await t.waitForFunction(() => /3루\s*1 가람[\s\S]*2루\s*2 나래/.test(document.querySelector('#app').innerText));
    await shot(t, '14-teeball');
    await btn(t, '홈런').click();
    await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent === '3');
    await t.waitForSelector('text=타자가 모두 쳤습니다');
    assert.ok(await btn(t, '1루타').isDisabled());
    await btn(t, '방금 기록 취소').click();
    await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent === '0');
    assert.match(await text(t), /홈런 · 3득점[^\n]*\(취소\)/);
    await btn(t, '플라이').click();
    await t.waitForSelector('text=타자가 모두 쳤습니다');
    await t.getByRole('button', { name: '홈인' }).first().click();
    await t.waitForFunction(() => document.querySelector('[data-score="a"]').textContent === '1');
    await s.reload();
    await s.selectOption('select[data-change="pickGrade"]', { label: '티볼반' });
    await s.waitForSelector('svg[aria-label^="루 상황"]');
    assert.match(await text(s), /공격 끝/);
    await btn(t, '공수 교대').click();
    await t.waitForSelector('text=1회 말');
    assert.equal(await t.locator('[data-batter]').innerText(), '1 라온');
    await btn(t, '땅볼').click(); await btn(t, '출루').click();
    await t.waitForFunction(() => /1루\s*2 마루/.test(document.querySelector('#app').innerText));
    assert.doesNotMatch(await text(t), /실책/);
    await t.goto(`${base}#records`);
    await t.waitForSelector('text=타점');
    assert.match(await text(t), /1 가람\s*티볼 가\s*1\s*1\s*0\s*1/);
    await shot(t, '15-teeball-records');
  });

  await step('타순 제출: 학생이 QR 주소로 타순을 내면 그 순서대로 경기가 시작됨', async () => {
    await t.goto(`${base}#teams`);
    await t.getByRole('button', { name: '티볼 가', exact: true }).click();
    await t.fill('#p-name', '라라'); await btn(t, '추가').click();
    await t.waitForSelector('text=선수 4명 · 선발 3 / 교체 1');
    await addGameAndOpen();
    await t.waitForSelector('text=타순을 아직 안 냄');
    const gid = (await t.evaluate(() => location.hash)).split('/')[1];
    await btn(t, '타순 제출 QR 띄우기').click();
    assert.ok(await t.locator('#sheet .qr svg').count());
    await sbtn(t, '닫기').click();
    const o = await ctx.newPage(); watch(o, '타순 제출');
    await o.goto(`${base}?o=${tid}&g=${gid}`);
    await o.getByRole('button', { name: '티볼 가' }).click();
    assert.ok(await o.getByRole('button', { name: /타순 제출 \(0명\)/ }).isDisabled());
    for (const name of ['다온', '가람']) await o.getByRole('button', { name: new RegExp(name) }).click();
    assert.ok(await o.getByRole('button', { name: '타순 제출 (2명 · 교체 2명)' }).count());
    for (const name of ['라라', '나래']) await o.getByRole('button', { name: new RegExp(name) }).click();
    assert.match(await o.getByRole('button', { name: /라라/ }).innerText(), /3번/);
    assert.match(await o.getByRole('button', { name: /나래/ }).innerText(), /교체/, '선발 인원(3명)을 넘겨 누른 선수는 교체 멤버');
    await o.getByRole('button', { name: /라라/ }).click();
    assert.match(await o.getByRole('button', { name: /나래/ }).innerText(), /3번/, '앞 선수가 빠지면 교체가 타순으로 올라옴');
    await o.getByRole('button', { name: /라라/ }).click();
    await shot(o, '16-order');
    await o.getByRole('button', { name: '타순 제출 (3명 · 교체 1명)' }).click();
    await o.waitForSelector('text=타순을 냈습니다');
    assert.match(await o.locator('#app').innerText(), /교체 멤버\s*4 라라/);
    await t.waitForFunction(() => /받은 타순\s*1번 3 다온\s*2번 1 가람\s*3번 2 나래\s*교체\s*4 라라/.test(document.querySelector('#app').innerText));
    await btn(t, '경기 시작').click();
    await t.waitForSelector('text=지금 타자 · 1번');
    assert.equal(await t.locator('[data-batter]').innerText(), '3 다온');
    // 3아웃제로 바꿔 주자를 둘 세운 뒤 병살: 함께 아웃되는 주자를 고르는 창
    const gameHash = await t.evaluate(() => location.hash);
    await t.goto(`${base}#rules`);
    await btn(t, '3아웃제').click();
    await btn(t, '다음 공격에 유지').click();
    await t.goto(`${base}${gameHash}`);
    await btn(t, '1루타').click();
    await t.waitForFunction(() => document.querySelector('[data-batter]').textContent === '1 가람');
    await btn(t, '1루타').click();
    await t.waitForFunction(() => document.querySelector('[data-batter]').textContent === '2 나래');
    await btn(t, '병살').click();
    await t.waitForSelector('text=타자와 함께 아웃되는 주자는?');
    await shot(t, '17-dp');
    await t.locator('#sheet').getByRole('button', { name: /2루/ }).click();
    await t.waitForFunction(() => /아웃 2 \/ 3/.test(document.querySelector('#app').innerText));
    assert.match(await text(t), /병살 \(2루 주자 3 다온 함께 아웃\)/);
    assert.match(await text(t), /1루\s*1 가람/);
    // 학생 화면과 전광판은 타순으로 보여 주고 지금 타자를 강조
    await s.reload();
    await s.selectOption('select[data-change="pickGrade"]', { label: '티볼반' });
    await s.waitForSelector('.nowbat');
    assert.match(await s.locator('.lineup.a').last().innerText(), /타순\s*1번 다온 · 타석\s*2번 가람\s*3번 나래/);
    await b.reload();
    await b.waitForSelector('.board .nowbat');
    assert.match(await b.locator('.box.a').innerText(), /타순[\s\S]*1번 다온 · 2번 가람 · 3번 나래/);
    await shot(b, '18-board-order');
    await o.reload();
    await o.waitForSelector('text=이미 시작한 경기라 타순을 바꿀 수 없습니다');
    await o.close();
  });

  await step('경기 일정: 날짜와 교시 넣기, 시간으로 바꾸기, 학생 화면에 보임', async () => {
    await t.goto(`${base}#home`);
    await t.getByRole('button', { name: /^6학년/ }).click();
    await t.getByRole('button', { name: '+ 경기 추가' }).click();
    await t.fill('#w-date', '2026-11-20'); await t.selectOption('#w-period', '3교시');
    await sbtn(t, '추가').click();
    await t.waitForSelector('text=예정 · 11월 20일(금) 3교시');
    await s.reload(); await s.getByRole('button', { name: '경기 결과' }).click();
    assert.match(await text(s), /예정 · 11월 20일\(금\) 3교시/);
    await t.locator('a.game').last().click();
    await btn(t, '일정 바꾸기').click();
    await t.fill('#w-hour', '9'); await t.locator('#w-hour').blur();
    assert.deepEqual([await t.inputValue('#w-ampm'), await t.inputValue('#w-min')], ['am', '00']);
    await t.fill('#w-min', '30'); await sbtn(t, '저장').click();
    await t.waitForSelector('text=11월 20일(금) 오전 9시 30분');
    await s.waitForFunction(() => /11월 20일\(금\) 오전 9시 30분/.test(document.body.innerText));
    await btn(t, '일정 바꾸기').click();
    assert.deepEqual([await t.inputValue('#w-ampm'), await t.inputValue('#w-hour'), await t.inputValue('#w-min')], ['am', '9', '30']);
    await t.fill('#w-hour', '23'); await t.locator('#w-hour').blur();
    assert.deepEqual([await t.inputValue('#w-ampm'), await t.inputValue('#w-hour')], ['pm', '11'], '23시는 오후 11시로 바뀌어야 함');
    await t.fill('#w-min', '0'); await sbtn(t, '저장').click();
    await t.waitForSelector('text=11월 20일(금) 오후 11시');
  });

  await step('끝난 경기 지우기: 순위표와 기록에서도 빠짐', async () => {
    await t.goto(`${base}#home`);
    await t.locator('a.game').first().click();
    await t.waitForSelector('text=최종 점수');
    await btn(t, '이 경기 지우기').click();
    await t.waitForSelector('text=순위표와 개인 기록에서도 빠집니다');
    await sbtn(t, '지우기').click();
    await t.waitForSelector('text=학생용 화면 QR');
    assert.equal(await t.locator('a.game').count(), 1);
    await s.waitForFunction(() => !/순위표[\s\S]*6-1 번개\s*1\s*1/.test(document.body.innerText));
    assert.match(await text(s), /6-1 번개\s*0\s*0\s*0\s*0\s*0/);
  });

  await step('홈에서 학년 지우기: 그 학년의 팀·경기도 함께 지워짐', async () => {
    await t.goto(`${base}#home`);
    await t.getByRole('button', { name: /^1학년/ }).click();
    await btn(t, '학년 지우기').click();
    await t.waitForSelector('text=이 학년의 팀, 경기, 기록이 모두 지워집니다');
    await sbtn(t, '지우기').click();
    await t.waitForFunction(() => !/1학년 넷볼/.test(document.querySelector('.chips').innerText));
    assert.match(await t.locator('.chips').innerText(), /6학년 풋살/);
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
    await t.waitForSelector('.cols .dark');
    await shot(t, '21-pc-game');
    await t.goto(`${base}#records`); await shot(t, '22-pc-records');
    await t.goto(`${base}#teams`); await shot(t, '23-pc-teams');
    await t.locator('.navbrand').click();
    await t.waitForSelector('text=학생용 화면 QR');
    assert.equal(await t.evaluate(() => location.hash), '#home', '왼쪽 위 이름을 누르면 홈으로');
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
