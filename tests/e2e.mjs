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
// ONLY=글 을 주면 처음 두 단계(대회·학년 만들기)와 이름에 그 글이 든 단계만 돌린다(고치는 동안 빨리 확인하려고).
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
let stepNo = 0;
const step = async (name, fn) => { if (only && stepNo++ >= 2 && !only.test(name)) return; await fn(); steps.push(name); };
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
  await t.goto(`${base}#games`);
  await t.getByRole('button', { name: '+ 경기 추가' }).click();
  await sbtn(t, '추가').click();
  await t.locator('a.game:not(.other)').last().click();
}

try {
  await step('미리보기로 들어가 대회 만들기', async () => {
    await t.goto(base);
    await btn(t, '미리보기로 시작').click();
    await t.fill('#new-t', '햇살초 스포츠클럽 리그');
    await btn(t, '대회 만들기').click();
    await t.waitForSelector('text=대회 목록');
    tid = await t.evaluate(() => localStorage.getItem('whistle-tid'));
    assert.ok(tid);
    await t.goto(`${base}#games`);
    await t.waitForSelector('text=학생용 화면 QR');
    await t.goto(`${base}#games`);
    await t.waitForSelector('text=학생용 화면 QR');
    assert.ok(await t.locator('.qr svg').count(), 'QR 그림이 그려져야 함');
  });

  await step('학년(풋살) 추가, 팀 두 팀과 명단 넣기', async () => {
    await addGrade('6학년', 'futsal');
    await t.goto(`${base}#teams`);
    await addTeam('6-1 번개', names.map((n, i) => `${i + 1} ${n}`));
    assert.match(await text(t), /선수 8명 · 선발 5\/5 · 후보 3/);
    await addTeam('6-2 돌풍', names.map((n, i) => `${i + 11} ${n}`));
    await t.fill('#p-no', '99'); await t.fill('#p-name', '추가선수'); await btn(t, '추가').click();
    assert.match(await text(t), /선수 9명 · 선발 5\/5 · 후보 4/);
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

  await step('전반 끝내기 → 후반 → 경기 종료, 득점 기록 고치기, 순위표', async () => {
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
    // 끝난 경기에서도 득점 기록을 눌러 넣은 선수와 어시스트를 고칠 수 있다(점수는 그대로)
    const goalRow = t.locator('button.log.edit').first();
    const before = await goalRow.locator('span').innerText();
    const who = before.split('· ')[1].trim().split(' ').slice(1).join(' ');
    await goalRow.click();
    await t.waitForSelector('text=누가 넣었나요?');
    assert.ok((await t.locator('#sheet .pl.on').innerText()).includes(who), '지금 기록된 선수가 표시돼야 함');
    await t.locator('#sheet .pl:not(.on)').first().click();
    await t.waitForSelector('text=누가 어시스트 했나요?');
    await t.locator('#sheet .pl').first().click();
    await t.waitForFunction(() => /어시스트/.test(document.querySelector('button.log.edit span').textContent));
    assert.notEqual(await goalRow.locator('span').innerText(), before);
    assert.equal(await t.locator('[data-score="a"]').innerText(), '2', '점수는 그대로');
    await goalRow.click();
    await t.locator('#sheet .pl', { hasText: who }).click();
    await sbtn(t, '어시스트 없음').click();
    await t.waitForFunction((b) => document.querySelector('button.log.edit span').textContent === b, before);
    await goalRow.click();
    await sbtn(t, '선수 기록 없음으로 두기').click();
    await t.waitForFunction(() => /선수 기록 없음/.test(document.querySelector('button.log.edit span').textContent));
    assert.equal(await goalRow.locator('i').innerText(), '선수 넣기');
    await goalRow.click();
    await t.locator('#sheet .pl', { hasText: who }).click();
    await sbtn(t, '어시스트 없음').click();
    await t.waitForFunction((b) => document.querySelector('button.log.edit span').textContent === b, before);
    await shot(t, '07b-edit-goal');
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
    await t.waitForSelector('.submenu a.on:has-text("종목·규칙")');
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
    // 아웃 기록(선수까지): 누가 아웃됐고 누가 아웃시켰는지 고르기, 되살아남
    await out('b');
    await t.waitForSelector('text=누가 아웃됐나요?');
    await t.locator('#sheet .pl').first().click();
    await t.waitForSelector('text=누가 아웃시켰나요?');
    await shot(t, '09a-dodge-out');
    await t.locator('#sheet .pl').nth(1).click();
    await t.waitForFunction(() => document.querySelector('[data-score="b"]').textContent === '2');
    assert.match(await text(t), /5-2 가람 1 라 아웃 · 5-1 한빛 2 나가 아웃시킴/);
    await t.locator('[data-act="dOut"][data-team="b"][data-d="1"]').click();
    await t.waitForSelector('text=누가 되살아났나요?');
    await t.locator('#sheet .pl').first().click();
    await t.waitForFunction(() => document.querySelector('[data-score="b"]').textContent === '3');
    const dodgeHash = await t.evaluate(() => location.hash);
    await t.goto(`${base}#records`);
    await t.waitForSelector('.tbl button.tr');
    assert.match(await text(t), /2 나\s*5-1 한빛\s*1\s*1\s*0/);
    await t.goto(`${base}#rules`);
    await btn(t, '인원만').click();
    await t.goto(`${base}${dodgeHash}`);
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
    assert.ok(await t.locator('.dark .qr svg').count(), '초대 QR이 있어야 함');
    assert.match(await text(t), /경기 진행 \+ 팀 명단·경기 일정[\s\S]*모든 설정/);
    await shot(t, '12-members');
    await t.goto(`${base}#home`);
    await shot(t, '01-home');
    await btn(t, '대회 목록').click();
    await t.waitForSelector('text=내 대회');
    assert.match(await t.locator('.tcard').first().innerText(), /내가 만든 대회[\s\S]*햇살초 리그[\s\S]*6학년 풋살[\s\S]*경기 \d+개/);
    await shot(t, '19-list');
    await t.getByRole('button', { name: /햇살초 리그/ }).click();
    await t.waitForSelector('text=대회 목록');
    await t.reload();
    await t.waitForSelector('text=대회 목록');
  });

  await step('학교 명단(선택): 반 등록, 팀 명단에서 체크해서 불러오기', async () => {
    await t.goto(`${base}#home`);
    await t.locator('[data-act="pickGrade"]', { hasText: '6학년' }).click();
    await t.locator('.submenu a', { hasText: '팀 명단' }).click();
    await t.waitForSelector('.submenu a.on:has-text("팀 명단")');
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
    await t.locator('[data-act="pickGrade"]', { hasText: '6학년' }).click();
    await t.locator('.submenu a', { hasText: '팀 명단' }).click();
    await t.waitForSelector('.submenu a.on:has-text("팀 명단")');
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
    await t.waitForSelector('text=선수 4명 · 선발 3/');
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
    await t.goto(`${base}#games`);
    await t.locator('[data-act="pickGrade"]', { hasText: '6학년' }).click();
    await t.getByRole('button', { name: '+ 경기 추가' }).click();
    await t.fill('#w-date', '2026-11-20'); await t.selectOption('#w-period', '3교시');
    await sbtn(t, '추가').click();
    await t.waitForSelector('text=예정 · 11월 20일(금) 3교시');
    await s.reload(); await s.getByRole('button', { name: '경기 결과' }).click();
    assert.match(await text(s), /예정 · 11월 20일\(금\) 3교시/);
    await t.locator('a.game:not(.other)').last().click();
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
    await t.goto(`${base}#games`);
    await t.locator('a.game:not(.other)').first().click();
    await t.waitForSelector('text=최종 점수');
    await btn(t, '이 경기 지우기').click();
    await t.waitForSelector('text=순위표와 개인 기록에서도 빠집니다');
    await sbtn(t, '지우기').click();
    await t.waitForSelector('text=학생용 화면 QR');
    assert.equal(await t.locator('a.game:not(.other)').count(), 1);
    await s.waitForFunction(() => !/순위표[\s\S]*6-1 번개\s*1\s*1/.test(document.body.innerText));
    assert.match(await text(s), /6-1 번개\s*0\s*0\s*0\s*0\s*0/);
  });

  await step('선발 인원 제한: 넘게 고르면 안내 창, 설정보다 많으면 번호 순으로만 선발 표시, 맞추기 단추', async () => {
    await t.goto(`${base}#home`);
    await t.locator('[data-act="pickGrade"]', { hasText: '6학년' }).click();
    await t.locator('.submenu a', { hasText: '팀 명단' }).click();
    await t.getByRole('button', { name: '6-1 번개', exact: true }).click();
    await t.waitForSelector('text=선발 5/5');
    await t.locator('.prow .seg button[data-slot="on"]:not(.on)').first().click();
    await t.waitForSelector('text=선발은 5명까지입니다');
    await sbtn(t, '확인').click();
    await t.waitForSelector('text=선발 5/5');
    await t.goto(`${base}#rules`);
    await t.getByRole('button', { name: '선발 인원 줄이기' }).click();
    await t.waitForSelector('text=4명');
    await t.goto(`${base}#games`);
    await t.locator('a.game:not(.other)').first().click();
    await t.waitForSelector('text=팀 명단에서 맞춰야 시작할 수 있습니다');
    await btn(t, '경기 시작').click();
    await t.waitForSelector('text=명단이 설정과 달라 시작할 수 없습니다');
    assert.match(await t.locator('#sheet').innerText(), /선발이 5명입니다\(설정 4명\)/);
    await sbtn(t, '확인').click();
    assert.ok(await btn(t, '경기 시작').count(), '시작되지 않아야 함');
    await t.goto(`${base}#teams`);
    await t.getByRole('button', { name: '6-1 번개', exact: true }).click();
    await t.waitForSelector('text=맞춰야 경기를 시작할 수 있습니다');
    await btn(t, '번호 순으로 맞추기').click();
    await t.waitForSelector('text=선발 4/4');
    assert.equal(await t.locator('text=맞춰야 경기를 시작할 수 있습니다').count(), 0);
    // 후보 인원: 정해 두면 넘는 선수는 맞추기에서 빠짐이 되고, 후보로 더 못 넣는다
    await t.goto(`${base}#rules`);
    await t.getByRole('button', { name: '후보 인원 늘리기' }).click();
    await t.goto(`${base}#teams`);
    await t.getByRole('button', { name: '6-1 번개', exact: true }).click();
    await t.waitForSelector('text=후보가');
    await btn(t, '번호 순으로 맞추기').click();
    await t.waitForSelector('text=후보 1/1');
    await t.locator('.prow .seg button[data-slot="bench"]:not(.on)').first().click();
    await t.waitForSelector('text=후보는 1명까지입니다');
    await sbtn(t, '확인').click();
    await t.goto(`${base}#rules`);
    await t.getByRole('button', { name: '후보 인원 줄이기' }).click();
  });

  await step('홈에서 학년 지우기: 확인 창, 15초 되돌리기, 팀·경기도 함께 지워짐', async () => {
    await t.goto(`${base}#home`);
    await t.locator('[data-act="pickGrade"]', { hasText: '1학년' }).click();
    await btn(t, '학년 지우기').click();
    await t.waitForSelector('text=지운 뒤 15초 동안은 되돌릴 수 있습니다');
    await sbtn(t, '1학년 지우기').click();
    await t.waitForFunction(() => !/1학년 넷볼/.test(document.querySelector('.chips').innerText));
    // 15초 안에는 되돌리기: 팀과 경기까지 돌아옴
    await t.locator('#toast .undo').click({ force: true });
    await t.waitForFunction(() => /1학년 넷볼/.test(document.querySelector('.chips').innerText));
    await t.goto(`${base}#games`);
    await t.waitForSelector('a.game:not(.other)');
    await t.goto(`${base}#home`);
    await btn(t, '학년 지우기').click();
    await sbtn(t, '1학년 지우기').click();
    await t.waitForFunction(() => !/1학년 넷볼/.test(document.querySelector('.chips').innerText));
    assert.match(await t.locator('.chips').first().innerText(), /6학년 풋살/);
  });

  await step('PC 화면: 메뉴는 왼쪽, 내용은 두 칸', async () => {
    await t.setViewportSize({ width: 1280, height: 800 });
    await t.goto(`${base}#games`);
    await t.waitForSelector('text=학생용 화면 QR');
    const nav = await t.locator('.nav').boundingBox();
    assert.ok(nav.x < 100 && nav.height > 600 && nav.width < 260, '메뉴가 왼쪽 세로로 있어야 함');
    const cols = await t.locator('.cols > .col').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    assert.ok(cols[1] - cols[0] > 300, '두 칸이 나란히 있어야 함');
    await shot(t, '20-pc-home');
    await t.locator('a.game:not(.other)').first().click();
    await t.waitForSelector('.cols .dark');
    await shot(t, '21-pc-game');
    await t.goto(`${base}#records`); await shot(t, '22-pc-records');
    await t.goto(`${base}#teams`); await shot(t, '23-pc-teams');
    await t.locator('.navbrand').click();
    await t.waitForSelector('text=대회 목록');
    assert.equal(await t.evaluate(() => location.hash), '#home', '왼쪽 위 이름을 누르면 홈으로');
    await t.setViewportSize({ width: 390, height: 844 });
    await t.goto(`${base}#home`);
    const m = await t.locator('.nav').boundingBox();
    assert.ok(m.width > 380 && m.height < 70, `폰에서는 메뉴가 아래 가로로 있어야 함 ${JSON.stringify(m)}`);
  });

  await step('체험용 미리보기(?demo): 지어낸 대회가 채워져 있고 평소 자료와 따로 저장', async () => {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const d = await c2.newPage(); watch(d, '체험');
    await d.goto(`${base}?demo`);
    await d.waitForSelector('text=대회 목록');
    assert.match(await d.locator('#app').innerText(), /지어낸 대회[\s\S]*햇살초 스포츠클럽 리그/);
    await d.goto(`${base}?demo#games`);
    await d.waitForSelector('text=학생용 화면 QR');
    assert.match(await d.locator('#app').innerText(), /2 : 1[\s\S]*진행 중/);
    assert.match(await d.locator('a.btn', { hasText: '전광판 모드' }).getAttribute('href'), /\?b=.+&demo$/);
    const keys = await d.evaluate(() => Object.keys(localStorage));
    assert.ok(keys.length && keys.every((k) => k.startsWith('whistle-try-')), '평소 자료 자리를 건드리지 않아야 함');
    const tid2 = await d.evaluate(() => localStorage.getItem('whistle-try-tid'));
    const s2 = await c2.newPage(); watch(s2, '체험 학생');
    await s2.goto(`${base}?v=${tid2}&demo`);
    await s2.waitForSelector('text=학생용 · 보기 전용');
    assert.match(await s2.locator('#app').innerText(), /1 : 1/);
    // 대회 편성 시험용: 5학년 피구 8팀 (경기는 아직 없음)
    await d.goto(`${base}?demo#plan`);
    await d.waitForSelector('text=대회 방식');
    await d.locator('[data-act="pickGrade"]', { hasText: '5학년' }).first().click();
    await d.waitForSelector('text=8팀 풀리그 28경기');
    // 예전 견본으로 체험하던 기기도 견본이 바뀌면(SEED_REV) 바로 새 견본으로
    await d.evaluate(() => { const r = JSON.parse(localStorage.getItem('whistle-try-v1')); for (const t of Object.values(r.t)) for (const [k, g] of Object.entries(t.grades)) if (g.label === '5학년') delete t.grades[k]; localStorage.setItem('whistle-try-v1', JSON.stringify(r)); localStorage.setItem('whistle-try-rev', '1'); });
    await d.goto(`${base}?demo#plan`); await d.waitForSelector('text=대회 방식');
    assert.match(await d.locator('#app').innerText(), /5학년/, '견본이 바뀌면 다시 채워져야 함');
    await c2.close();
  });

  await step('대회 편성: 원형 예선 + 결선 추첨, 전광판 추첨, 경기 짜기, 결선 자리 채우기, 동점 연장', async () => {
    await t.setViewportSize({ width: 390, height: 844 });
    await addGrade('편성반', 'futsal');
    await t.goto(`${base}#teams`);
    await t.waitForSelector('text=+ 팀 추가');
    for (const n of ['가람', '나래', '다온', '라온', '마루']) await addTeam(n, []);
    await t.goto(`${base}#plan`);
    await t.waitForSelector('text=대회 방식');
    assert.match(await text(t), /5팀 풀리그 10경기/);
    await btn(t, '조별 예선 + 결선').click();
    await t.waitForSelector('text=2개 조(2~3팀씩) 예선 4경기');
    await btn(t, '원형 예선 + 결선').click();
    await t.waitForSelector('text=5팀 원형 예선 5경기(팀마다 2경기) → 상위 2팀 결승부터 토너먼트 1경기');
    assert.ok(await t.locator('[data-act="planMake"]').isDisabled(), '추첨 전에는 경기를 짤 수 없음');
    await btn(t, '추첨하기').click();
    await t.waitForSelector('.dring .dteam');
    assert.equal(await t.locator('.dring .dteam').count(), 5);
    const seat = () => t.locator('.dring .dteam').allInnerTexts();
    const before = await seat();
    await t.locator('.dring .dteam').nth(0).click();
    await t.locator('.dring .dteam').nth(1).click();
    await t.waitForFunction((x) => document.querySelector('.dring .dteam').textContent === x, before[1]);
    assert.deepEqual((await seat()).slice(0, 2), [before[1], before[0]], '두 팀을 누르면 자리가 바뀜');
    // 추첨 연출 미리 보기: 전광판에 띄우지 않고 이 화면에서만
    await btn(t, '이 화면에서 추첨 연출 미리 보기').click();
    await t.waitForSelector('#sheet #drawballs');
    assert.equal(await t.locator('#sheet .dteam').count(), 5);
    await t.waitForTimeout(600); await shot(t, '38b-draw-test');
    await t.locator('#sheet [data-act="drawTestAgain"]').click();
    await t.waitForSelector('#sheet #drawballs');
    await t.locator('#sheet [data-act="closeSheet"]').click();
    assert.equal(await t.locator('#drawballs').count(), 0);
    await btn(t, '전광판에 추첨 띄우기').click();
    await b.goto(`${base}?b=${tid}`);
    await b.waitForSelector('.drawbox .dteam');
    assert.equal(await b.locator('.drawbox .dteam').count(), 5);
    assert.match(await b.locator('.drawbox').innerText(), /원형 예선 \+ 결선 추첨/);
    // 공 뽑기 연출: 그림판에 공이 그려지고, 차례가 되면 오른쪽 결과에 팀이 뜬다
    await b.waitForSelector('#drawballs');
    await b.waitForTimeout(700);
    const painted = () => b.evaluate(() => { const c = document.getElementById('drawballs'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4000) if (d[i]) n++; return n; });
    assert.ok(await painted() > 5, '공 뽑기 그림이 그려져야 함');
    const shown = () => b.evaluate(() => [...document.querySelectorAll('.drawbox .dteam')].filter((x) => Number(getComputedStyle(x).opacity) > 0.5).length);
    assert.equal(await shown(), 0, '처음에는 아무 팀도 안 보임');
    await shot(b, '38a-balls-start');
    await b.waitForTimeout(5600);
    assert.equal(await shown(), 1, '첫 공이 나오면 한 팀이 보임');
    await shot(b, '38-draw-board'); await shot(t, '39-plan');
    await b.reload(); await b.waitForSelector('#drawballs'); await b.waitForTimeout(600);
    assert.ok(await shown() >= 1, '전광판을 새로 열어도 이어서 보임');
    await btn(t, '이름만').click();
    await b.waitForFunction(() => !document.getElementById('drawballs') && document.querySelectorAll('.drawbox .dteam').length === 5);
    await btn(t, '공 뽑기').click();
    await b.waitForSelector('#drawballs');
    await btn(t, '전광판 추첨 닫기').click();
    await b.waitForFunction(() => !document.querySelector('.drawbox'));
    await btn(t, '이대로 경기 6개 짜기').click();
    await t.waitForSelector('text=편성된 경기 6개');
    await t.goto(`${base}#games`);
    await t.waitForSelector('a.game:not(.other)');
    assert.equal(await t.locator('a.game:not(.other)').count(), 6);
    assert.match(await t.locator('a.game:not(.other)').last().innerText(), /6경기 · 결승[\s\S]*예선 1위[\s\S]*예선 2위/);
    // 아직 팀이 안 정해진 결승은 시작할 수 없다
    await t.locator('a.game:not(.other)').last().click();
    await btn(t, '경기 시작').click();
    await t.waitForSelector('text=아직 팀이 정해지지 않았습니다');
    await sbtn(t, '확인').click();
    const play = async (i, goalsA, goalsB) => {
      await t.goto(`${base}#games`);
      await t.locator('a.game:not(.other)').nth(i).click();
      await btn(t, '경기 시작').click();
      await t.waitForSelector('[data-score="a"]');
      for (let k = 0; k < goalsA; k++) await t.locator('[data-act="gPlus"][data-team="a"]').click();
      for (let k = 0; k < goalsB; k++) await t.locator('[data-act="gPlus"][data-team="b"]').click();
      await t.waitForFunction(([x, y]) => document.querySelector('[data-score="a"]').textContent === String(x) && document.querySelector('[data-score="b"]').textContent === String(y), [goalsA, goalsB]);
      await btn(t, '전반 끝내기').click();
      await btn(t, '경기 종료').click();
      await sbtn(t, '경기 종료').click();
      await t.waitForFunction(() => /경기 종료/.test(document.body.innerText) && !document.querySelector('[data-act="gPlus"]'));
    };
    for (let i = 0; i < 5; i++) await play(i, i + 1, 0);
    await t.goto(`${base}#games`);
    await t.waitForFunction(() => !/예선 [12]위/.test([...document.querySelectorAll('a.game:not(.other)')].at(-1).innerText));
    await t.goto(`${base}#plan`);
    await t.waitForSelector('text=예선 순위');
    assert.match(await text(t), /예선 순위 · 예선 끝[\s\S]*결선 대진[\s\S]*결승/);
    await shot(t, '40-plan-made');
    // 결승이 동점으로 끝나면 연장을 연다
    await play(5, 0, 0);
    await t.waitForSelector('text=동점입니다. 결선은 승자가 있어야 다음 경기가 정해집니다.');
    await btn(t, '연장 열기').click();
    await t.waitForSelector('[data-act="gPlus"]');
    assert.match(await text(t), /6경기 · 결승 · 연장/);
    await t.locator('[data-act="gPlus"][data-team="b"]').click();
    await t.waitForFunction(() => document.querySelector('[data-score="b"]').textContent === '1');
    await shot(t, '41-extra');
    await btn(t, '경기 종료').click();
    await sbtn(t, '경기 종료').click();
    await t.waitForFunction(() => /경기 종료 0 : 1/.test(document.body.innerText));
    assert.equal(await t.locator('text=동점입니다').count(), 0);
    // 학생 화면에는 예선 순위와 결선 대진이 나온다
    await s.goto(`${base}?v=${tid}`);
    await s.waitForSelector('text=학생용 · 보기 전용');
    await s.selectOption('select[data-change="pickGrade"]', { label: '편성반' });
    await s.getByRole('button', { name: '경기 결과' }).click();
    await s.waitForSelector('text=결선 대진');
    assert.match(await text(s), /예선 순위[\s\S]*결선 대진[\s\S]*결승[\s\S]*0 : 1/);
    await shot(s, '42-student-plan');
    // 편성 지우기는 시작하지 않은 경기만
    await t.goto(`${base}#plan`);
    await btn(t, '시작하지 않은 편성 경기 지우기').click();
    await t.waitForFunction(() => /지울 수 있는/.test(document.getElementById('toast').textContent));
  });

  await step('대회 편성: 스위스 + 결선 (8팀, 라운드마다 자동 추첨, 동점은 승자 고르기, 결선 추첨)', async () => {
    await addGrade('스위스반', 'futsal');
    await t.goto(`${base}#teams`);
    await t.waitForSelector('text=+ 팀 추가');
    for (const n of ['하나', '두리', '세찬', '네온', '다솜', '여울', '일곱', '여덟']) await addTeam(n, []);
    await t.goto(`${base}#plan`);
    await btn(t, '스위스 + 결선').click();
    await t.waitForSelector('text=8팀 스위스 10경기(2승 진출 · 2패 탈락) → 상위 4팀 준결승부터 토너먼트 3경기');
    await btn(t, '추첨하기').click();
    await t.waitForSelector('.dpair .dteam');
    assert.equal(await t.locator('.dpair').count(), 4);
    await shot(t, '43-swiss-draw');
    await btn(t, '이대로 경기 13개 짜기').click();
    await t.waitForSelector('text=스위스 순위');
    const cards = () => t.locator('a.game:not(.other)');
    const finish = async (i, a, bb, pick) => {
      await t.goto(`${base}#games`);
      await cards().nth(i).click();
      await btn(t, '경기 시작').click();
      await t.waitForSelector('[data-score="a"]');
      for (let k = 0; k < a; k++) await t.locator('[data-act="gPlus"][data-team="a"]').click();
      for (let k = 0; k < bb; k++) await t.locator('[data-act="gPlus"][data-team="b"]').click();
      await t.waitForFunction(([x, y]) => document.querySelector('[data-score="a"]').textContent === String(x) && document.querySelector('[data-score="b"]').textContent === String(y), [a, bb]);
      await btn(t, '전반 끝내기').click();
      await btn(t, '경기 종료').click();
      await sbtn(t, '경기 종료').click();
      await t.waitForFunction(() => /경기 종료/.test(document.body.innerText) && !document.querySelector('[data-act="gPlus"]'));
      if (pick) {
        await t.waitForSelector('text=스위스는 승패가 있어야 다음 라운드를 짤 수 있습니다');
        await btn(t, '승자 고르기').click();
        await t.locator('#sheet [data-act="winPick"][data-side="b"]').click();
        await t.waitForSelector('text=승리로 정했습니다');
      }
    };
    await t.goto(`${base}#games`);
    assert.equal(await cards().count(), 4, '처음에는 1라운드 4경기만');
    for (let i = 0; i < 3; i++) await finish(i, 1, 0);
    await t.goto(`${base}#games`);
    assert.equal(await cards().count(), 4, '라운드가 다 끝나기 전에는 다음 라운드가 없다');
    await finish(3, 1, 1, true);
    await t.goto(`${base}#games`);
    await t.waitForFunction(() => document.querySelectorAll('a.game:not(.other)').length === 8);
    assert.match(await cards().nth(4).innerText(), /스위스 2R \(1승 0패\)/);
    assert.match(await cards().nth(7).innerText(), /스위스 2R \(0승 1패\)/);
    for (let i = 4; i < 8; i++) await finish(i, 0, 2);
    await t.goto(`${base}#games`);
    await t.waitForFunction(() => document.querySelectorAll('a.game:not(.other)').length === 10);
    assert.match(await cards().nth(8).innerText(), /스위스 3R \(1승 1패\)/);
    for (let i = 8; i < 10; i++) await finish(i, 3, 1);
    await t.goto(`${base}#games`);
    await t.waitForFunction(() => document.querySelectorAll('a.game:not(.other)').length === 13);
    assert.match(await cards().nth(10).innerText(), /준결승 1/);
    assert.match(await cards().nth(12).innerText(), /결승[\s\S]*준결승 1 승자[\s\S]*준결승 2 승자/);
    await t.goto(`${base}#plan`);
    await t.waitForSelector('text=결선 대진');
    const sw = await text(t);
    assert.equal((sw.match(/결선 진출/g) || []).length, 4);
    assert.equal((sw.match(/탈락/g) || []).length >= 4, true);
    await shot(t, '44-swiss-made');
    await s.goto(`${base}?v=${tid}`);
    await s.waitForSelector('text=학생용 · 보기 전용');
    await s.selectOption('select[data-change="pickGrade"]', { label: '스위스반' });
    await s.getByRole('button', { name: '경기 결과' }).click();
    await s.waitForSelector('text=스위스 순위');
    assert.match(await text(s), /스위스 순위[\s\S]*결선 대진[\s\S]*준결승 1/);
  });

  await step('농구: 파울(휘슬·시계 멈춤·개인/팀 파울·5반칙), 공격 제한 시간과 8초, 전광판 표시', async () => {
    await t.setViewportSize({ width: 390, height: 844 });
    await addGrade('농구반', 'basket');
    await t.goto(`${base}#rules`);
    await t.waitForSelector('text=파울 기록');
    assert.match(await text(t), /개인 파울 퇴장[\s\S]*5반칙[\s\S]*팀 파울[\s\S]*5개[\s\S]*공격 제한 시간[\s\S]*8초 세기/);
    await t.getByRole('button', { name: '개인 파울 퇴장 줄이기' }).click();
    await t.getByRole('button', { name: '개인 파울 퇴장 줄이기' }).click();
    await t.waitForSelector('text=3반칙');
    for (let i = 0; i < 14; i++) await t.getByRole('button', { name: '공격 제한 시간 줄이기' }).click();
    await t.waitForSelector('text=10초');
    await t.goto(`${base}#teams`);
    await t.waitForSelector('text=+ 팀 추가');
    await addTeam('농구 가', ['1 가람', '2 나래', '3 다온', '4 라온', '5 마루', '6 바다']);
    await addTeam('농구 나', ['1 사랑', '2 아름', '3 자람', '4 차오', '5 큰솔', '6 타래']);
    await t.goto(`${base}#games`);
    await t.getByRole('button', { name: '+ 경기 추가' }).click(); await sbtn(t, '추가').click();
    await t.locator('a.game:not(.other)').last().click();
    await btn(t, '경기 시작').click();
    await t.waitForSelector('text=공격 제한 시간');
    const hoopHash = await t.evaluate(() => location.hash);
    const running = () => t.evaluate(() => /일시 정지/.test(document.querySelector('[data-act="gClock"]').textContent));
    assert.equal(await running(), true);
    // 공격권: 24초와 8초가 돈다
    await t.locator('[data-act="gPoss"][data-team="a"]').click();
    await t.waitForSelector('[data-bc]');
    assert.match(await text(t), /농구 가 공격/);
    assert.ok(Number(await t.locator('[data-sc]').innerText()) >= 9);
    await btn(t, '넘어옴').click();
    await t.waitForFunction(() => !document.querySelector('[data-bc]'));
    await btn(t, '14초로').click();
    await t.waitForFunction(() => Number(document.querySelector('[data-sc]').textContent) <= 14);
    // 파울: 누르자마자 시계가 멈추고 선수를 고른다
    await t.locator('[data-act="gFoul"][data-team="b"]').click();
    await t.waitForSelector('text=누가 파울을 했나요?');
    await t.waitForFunction(() => /시계 시작/.test(document.querySelector('[data-act="gClock"]').textContent));
    const scStop = await t.locator('[data-sc]').innerText();
    await t.locator('#sheet .pl').first().click();
    await t.waitForSelector('text=농구 나 파울 · 1 사랑 (개인 1 · 팀 1)');
    // 멈춘 시계는 손으로 맞출 수 있다
    const clk = () => t.locator('.dark [data-clock]').first().innerText();
    const c0 = await clk();
    await t.locator('[data-act="gAdj"][data-k="clock"][data-ms="10000"]').click();
    await t.waitForFunction((v) => document.querySelector('.dark [data-clock]').textContent !== v, c0);
    const sec = (v) => Number(v.split(':')[0]) * 60 + Number(v.split(':')[1]);
    assert.equal(sec(await clk()) - sec(c0), 10);
    await t.locator('[data-act="gAdj"][data-k="clock"][data-ms="-10000"]').click();
    await t.waitForFunction((v) => document.querySelector('.dark [data-clock]').textContent === v, c0);
    const s0 = Number(await t.locator('[data-sc]').innerText());
    await t.locator('[data-act="gAdj"][data-k="sc"][data-ms="1000"]').click();
    await t.waitForFunction((v) => Number(document.querySelector('[data-sc]').textContent) === v + 1, s0);
    await t.locator('[data-act="gAdj"][data-k="sc"][data-ms="-1000"]').click();
    await t.waitForFunction((v) => Number(document.querySelector('[data-sc]').textContent) === v, s0);
    await t.waitForTimeout(1200);
    assert.equal(await t.locator('[data-sc]').innerText(), scStop, '멈춘 동안에는 공격 제한 시간도 멈춤');
    await shot(t, '45-hoop');
    // 같은 선수 3반칙(설정) → 퇴장 안내, 팀 파울 3
    for (let i = 0; i < 2; i++) { await t.locator('[data-act="gFoul"][data-team="b"]').click(); await t.locator('#sheet .pl').first().click(); await t.waitForFunction((n) => new RegExp(`팀 파울 ${n}`).test(document.body.innerText), i + 2); }
    await t.waitForSelector('text=1 사랑 3반칙 퇴장');
    await sbtn(t, '확인').click();
    assert.match(await text(t), /개인 3 · 팀 3\) · 3반칙 퇴장/);
    // 파울 취소
    await t.locator('button.log.edit[data-act="foulUndo"]').first().click();
    await t.waitForFunction(() => /팀 파울 2/.test(document.body.innerText) && /\(취소\)/.test(document.body.innerText));
    // 선수 없이 팀 파울만, 팀 파울 5개째부터 자유투
    for (let i = 3; i <= 5; i++) { await t.locator('[data-act="gFoul"][data-team="b"]').click(); await sbtn(t, '선수 없이 팀 파울만').click(); await t.waitForFunction((n) => new RegExp(`팀 파울 ${n}`).test(document.body.innerText), i); }
    assert.match(await text(t), /팀 파울 5 · 자유투/);
    // 골이 들어가면 공격권이 넘어간다
    await btn(t, '시계 시작').click();
    await t.locator('[data-act="gPlus"][data-team="a"][data-pts="2"]').click();
    await t.locator('#sheet .pl').first().click();
    await t.waitForFunction(() => /농구 나 공격/.test(document.body.innerText));
    // 8초는 0이 돼도 울리지 않고 시계가 계속 간다
    await t.waitForFunction(() => document.querySelector('[data-bc]') && document.querySelector('[data-bc]').textContent === '0', null, { timeout: 15000 });
    assert.equal(await running(), true);
    assert.ok(!/8초 위반/.test(await text(t)));
    // 공격 제한 시간(10초로 줄여 둠)이 다 되면 버저와 함께 시계가 멈추고 기록이 남는다
    await t.waitForFunction(() => /농구 나 10초 위반 · 농구 가 공/.test(document.body.innerText), null, { timeout: 15000 });
    assert.equal(await running(), false);
    // 전광판: 팀 파울과 공격 제한 시간
    await b.goto(`${base}?b=${tid}`);
    await b.waitForSelector('.board .setbadge');
    assert.match(await b.locator('.board').innerText(), /팀 파울 0[\s\S]*팀 파울 5/);
    assert.equal(await b.locator('.board .setbadge.hot').count(), 1);
    assert.equal(await b.locator('.board .shotc').count(), 1);
    await shot(b, '46-hoop-board');
    // 개인 기록에 파울
    await t.goto(`${base}#records`);
    await t.waitForSelector('.tbl button.tr');
    assert.match(await text(t), /파울/);
    // 파울 기록을 끄면 단추가 사라진다
    await t.goto(`${base}#rules`);
    await t.locator('[data-act="setGrade"][data-key="fouls"][data-val="0"]').click();
    await t.locator('[data-act="setGrade"][data-key="shot"][data-val="0"]').click();
    await t.goto(`${base}${hoopHash}`);
    await t.waitForSelector('[data-act="gPlus"]');
    assert.equal(await t.locator('[data-act="gFoul"], [data-act="gPoss"]').count(), 0);
  });

  await step('축구: 경고·퇴장과 쉬는 시간, 전광판에서 추첨 닫기', async () => {
    await t.setViewportSize({ width: 390, height: 844 });
    await addGrade('축구반', 'soccer');
    await t.goto(`${base}#rules`);
    await t.waitForSelector('text=경고 · 퇴장 기록');
    await t.getByRole('button', { name: '쉬는 시간 늘리기' }).click();
    await t.waitForSelector('text=1분');
    for (let i = 0; i < 4; i++) await t.getByRole('button', { name: '선발 인원 줄이기' }).click();
    await t.goto(`${base}#teams`);
    await t.waitForSelector('text=+ 팀 추가');
    await addTeam('축구 가', ['1 가람', '2 나래', '3 다온', '4 라온', '5 마루']);
    await addTeam('축구 나', ['1 사랑', '2 아름', '3 자람', '4 차오', '5 큰솔']);
    await t.goto(`${base}#games`);
    await t.getByRole('button', { name: '+ 경기 추가' }).click(); await sbtn(t, '추가').click();
    await t.locator('a.game:not(.other)').last().click();
    await btn(t, '경기 시작').click();
    await t.waitForSelector('[data-act="gCard"]');
    // 경고 → 같은 선수 두 번째 경고는 퇴장
    const give = async (team, idx, name) => { await t.locator(`[data-act="gCard"][data-team="${team}"]`).click(); await t.waitForSelector('text=어느 선수인가요?'); await t.locator('#sheet .pl').nth(idx).click(); await sbtn(t, name).click(); };
    await give('a', 1, '경고');
    await t.waitForSelector('text=축구 가 경고 · 2 나래');
    assert.match(await text(t), /경고 1 · 퇴장 0/);
    await t.locator('[data-act="gCard"][data-team="a"]').click();
    await t.locator('#sheet .pl').nth(1).click();
    await t.waitForSelector('text=경고 1회 있음');
    await sbtn(t, '경고 (두 번째 · 퇴장됩니다)').click();
    await t.waitForSelector('text=축구 가 경고 2회 퇴장 · 2 나래');
    assert.match(await text(t), /경고 2 · 퇴장 1/);
    await give('b', 0, '퇴장');
    await t.waitForSelector('text=축구 나 퇴장 · 1 사랑');
    // 퇴장 선수는 득점 선수 목록과 교체 화면에서 빠진다
    await t.locator('[data-act="gPlus"][data-team="a"]').click();
    await t.waitForSelector('text=누가 넣었나요?');
    assert.ok(!(await t.locator('#sheet').innerText()).includes('나래'));
    await sbtn(t, '취소').click();
    // 학생 화면: 퇴장 표시
    await s.goto(`${base}?v=${tid}`);
    await s.waitForSelector('text=학생용 · 보기 전용');
    await s.selectOption('select[data-change="pickGrade"]', { label: '축구반' });
    await s.waitForSelector('.rcard');
    assert.match(await text(s), /2 나래[\s\S]*퇴장/);
    await shot(t, '47-cards'); await shot(s, '48-cards-student');
    // 카드 취소: 선수가 경기장으로 돌아온다
    await t.locator('button.log.edit[data-act="cardUndo"]').first().click();
    await t.waitForFunction(() => /경고 0 · 퇴장 0/.test(document.body.innerText));
    // 전반이 끝나면 쉬는 시간이 자동으로 센다. 시계를 시작하면 끝난다.
    await btn(t, '전반 끝내기').click();
    await t.waitForSelector('[data-rest]');
    assert.match(await t.locator('[data-rest]').innerText(), /^0[01]:\d\d$/);
    await b.goto(`${base}?b=${tid}`);
    await b.waitForSelector('.board [data-rest]');
    await shot(t, '49-rest');
    await btn(t, '시계 시작').click();
    await t.waitForFunction(() => !document.querySelector('[data-rest]'));
    // 전광판에서 추첨 닫기: 진행 중인 경기 화면으로 넘어간다
    await t.goto(`${base}#home`);
    await t.locator('[data-act="pickGrade"]', { hasText: '편성반' }).click();
    await t.goto(`${base}#plan`);
    await btn(t, '전광판에 추첨 띄우기').click();
    await b.waitForSelector('.drawbox');
    await b.locator('[data-act="drawClose"]').click();
    await b.waitForFunction(() => !document.querySelector('.drawbox') && document.querySelector('.board .pts'));
    await t.waitForSelector('text=전광판에 추첨 띄우기');
  });

  await step('배드민턴·탁구: 단식·복식, 서브 표시, 듀스와 세트 끝', async () => {
    await addGrade('탁구반', 'tabletennis');
    await t.goto(`${base}#rules`);
    await t.waitForSelector('text=경기 인원');
    assert.match(await text(t), /단식[\s\S]*복식[\s\S]*듀스[\s\S]*상한 점수/);
    await btn(t, '복식').click();
    await t.waitForFunction(() => document.querySelector('[data-act="setStarters"].on').textContent === '복식');
    for (let i = 0; i < 8; i++) await t.getByRole('button', { name: '세트 점수 줄이기' }).click();
    await t.waitForSelector('text=5점');
    await t.goto(`${base}#teams`);
    await t.waitForSelector('text=+ 팀 추가');
    await addTeam('가람·나래', ['1 가람', '2 나래']);
    await addTeam('다온·라온', ['1 다온', '2 라온']);
    await t.goto(`${base}#games`);
    await t.getByRole('button', { name: '+ 경기 추가' }).click(); await sbtn(t, '추가').click();
    await t.locator('a.game:not(.other)').last().click();
    await btn(t, '경기 시작').click();
    await t.waitForSelector('text=서브 · 가람·나래');
    await btn(t, '첫 서브 바꾸기').click();
    await t.waitForSelector('text=서브 · 다온·라온');
    await btn(t, '첫 서브 바꾸기').click();
    await t.waitForSelector('text=서브 · 가람·나래');
    const pt = async (team) => { const before = await t.locator(`[data-score="${team}"]`).innerText(); await t.locator(`[data-act="gPlus"][data-team="${team}"]`).click(); await t.waitForFunction(([tm, v]) => document.querySelector(`[data-score="${tm}"]`).textContent !== v, [team, before]); };
    await pt('a'); await pt('a');
    await t.waitForSelector('text=서브 · 다온·라온');     // 2점마다 서브 교대
    await pt('b'); await pt('b'); await pt('a'); await pt('a'); await pt('b'); await pt('b');   // 4:4 = 듀스(5점 세트)
    await t.waitForSelector('text=듀스입니다. 2점 차가 나야 세트가 끝납니다.');
    await pt('a');                                        // 5:4 아직 끝 아님
    await btn(t, '1세트 끝내기').click();
    await t.waitForFunction(() => /아직 세트가 끝나지 않았습니다/.test(document.getElementById('toast').textContent));
    await pt('a');                                        // 6:4
    await t.waitForSelector('text=1세트 승리 점수입니다');
    await shot(t, '50-racket');
    await btn(t, '1세트 끝내기').click();
    await t.waitForFunction(() => /1 : 0/.test(document.querySelector('.dark').innerText));
    await t.waitForSelector('text=서브 · 다온·라온');     // 다음 세트는 첫 서브가 바뀐다
  });

  await step('사용 안내: 대회 안과 대회 목록에서 간략 사용법 열기', async () => {
    await t.setViewportSize({ width: 390, height: 844 });
    await t.goto(`${base}#home`);
    await t.locator('#app .helpbtn:visible').first().click();
    await t.waitForSelector('text=휘슬! 간략 사용법');
    assert.match(await t.locator('#sheet').innerText(), /처음 준비[\s\S]*경기 진행[\s\S]*선수 없이 점수만 올리기[\s\S]*학생 화면과 전광판[\s\S]*함께 심판 보기[\s\S]*대회가 끝나면/);
    await shot(t, '36-help');
    await sbtn(t, '확인').click();
    assert.equal(await t.locator('#sheet .sheet').count(), 0);
    await t.setViewportSize({ width: 1280, height: 800 });
    await t.goto(`${base}#games`);
    await t.locator('.nav .helpbtn').click();
    await t.waitForSelector('text=휘슬! 간략 사용법');
    await shot(t, '37-help-pc');
    await sbtn(t, '닫기').click();
    await t.setViewportSize({ width: 390, height: 844 });
    await t.goto(`${base}#home`); await btn(t, '대회 목록').click();
    await t.waitForSelector('text=내 대회');
    await t.locator('#app .helpbtn:visible').first().click();
    await t.waitForSelector('text=휘슬! 간략 사용법');
    await sbtn(t, '확인').click();
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
