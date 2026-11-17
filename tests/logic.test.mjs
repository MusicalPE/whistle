import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const roster = (n, benchFrom) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i + 1}`, { no: i + 1, name: `선수${i + 1}`, bench: i >= benchFrom }]));
const ctxAt = (now, extra = {}) => ({ now, uid: 'u1', name: '선생님', names: { a: '가팀', b: '나팀' }, rosters: { a: roster(8, 5), b: roster(8, 5) }, ...extra });
const MIN = 60000;

test('종목 기본값', () => {
  const g = L.gradeFromSport('netball', '5학년');
  assert.equal(g.format, 'quarters');
  assert.equal(L.partCount(g), 4);
  assert.equal(L.sportName(g), '넷볼');
  assert.deepEqual(L.SPORTS.netball.formats, ['halves', 'quarters']);
  assert.equal(L.gradeFromSport('dodge', 'x').sets, 3);
  assert.equal(L.dupWindow(g), 5000);
  assert.equal(L.dupWindow(L.gradeFromSport('futsal', 'x')), 10000);
});

test('전·후반 경기: 시작, 득점, 시계, 전반 종료, 경기 종료', () => {
  const grade = L.gradeFromSport('futsal', '6학년');
  const g = L.newGame('g6', 1, 'ta', 'tb');
  let logs = L.start(g, grade, ctxAt(0));
  assert.equal(g.status, 'live');
  assert.equal(Object.values(g.lineup.a).filter((s) => s === 'on').length, 5);
  assert.equal(L.clockLeft(g, 3 * MIN), 7 * MIN);
  assert.equal(L.fmtClock(L.clockLeft(g, 3 * MIN)), '07:00');

  logs = L.score(g, grade, ctxAt(2 * MIN + 1000), 'a', 1, 'p3');
  assert.equal(g.sa, 1);
  assert.equal(logs[0].type, 'goal');
  assert.equal(logs[0].tag, '전반 3분');
  assert.match(logs[0].text, /가팀 득점 · 3 선수3/);
  assert.deepEqual({ team: g.last.team, by: g.last.by }, { team: 'a', by: 'u1' });

  L.toggleClock(g, grade, ctxAt(4 * MIN));
  assert.equal(g.clock.run, false);
  assert.equal(L.clockLeft(g, 9 * MIN), 6 * MIN);
  L.toggleClock(g, grade, ctxAt(9 * MIN));
  assert.equal(L.clockLeft(g, 10 * MIN), 5 * MIN);

  logs = L.nextPart(g, grade, ctxAt(15 * MIN));
  assert.equal(g.cur, 1);
  assert.equal(g.clock.run, false);
  assert.equal(g.clock.left, 10 * MIN);
  L.score(g, grade, ctxAt(16 * MIN), 'b', 1, '');
  L.score(g, grade, ctxAt(16 * MIN), 'b', -1);
  assert.equal(g.sb, 0);
  logs = L.nextPart(g, grade, ctxAt(30 * MIN));
  assert.equal(g.status, 'done');
  assert.match(logs.at(-1).text, /경기 종료 1 : 0/);
  assert.throws(() => L.score(g, grade, ctxAt(31 * MIN), 'a', 1));
});

test('시간 종료는 한 번만 적용', () => {
  const grade = L.gradeFromSport('futsal', '6학년');
  const g = L.newGame('g6', 1, 'ta', 'tb');
  L.start(g, grade, ctxAt(0));
  assert.equal(L.timeUp(g, grade, ctxAt(5 * MIN)).length, 0);
  assert.equal(L.timeUp(g, grade, ctxAt(10 * MIN)).length, 1);
  assert.equal(g.clock.run, false);
  assert.equal(L.timeUp(g, grade, ctxAt(11 * MIN)).length, 0);
});

test('선수 교체: 카드 자동 차감, 기록, 재입장 금지', () => {
  const grade = { ...L.gradeFromSport('futsal', '6학년'), cards: 2 };
  const g = L.newGame('g6', 1, 'ta', 'tb');
  L.start(g, grade, ctxAt(0));
  assert.equal(L.cardsLeft(g, grade, 'a'), 2);
  const logs = L.sub(g, grade, ctxAt(MIN), 'a', 'p1', 'p6');
  assert.equal(g.lineup.a.p1, 'out');
  assert.equal(g.lineup.a.p6, 'on');
  assert.equal(L.cardsLeft(g, grade, 'a'), 1);
  assert.match(logs[0].text, /1 선수1 나감 → 6 선수6 들어감/);
  assert.throws(() => L.sub(g, grade, ctxAt(MIN), 'a', 'p2', 'p1'), /대기 중/);
  L.sub(g, grade, ctxAt(MIN), 'a', 'p2', 'p7');
  assert.throws(() => L.sub(g, grade, ctxAt(MIN), 'a', 'p3', 'p8'), /교체 카드/);
  assert.equal(L.cardsLeft(g, grade, 'b'), 2);
});

test('재입장 허용이면 나간 선수가 다시 대기로', () => {
  const grade = { ...L.gradeFromSport('futsal', '6학년'), reentry: true, cards: 0 };
  const g = L.newGame('g6', 1, 'ta', 'tb');
  L.start(g, grade, ctxAt(0));
  L.sub(g, grade, ctxAt(MIN), 'a', 'p1', 'p6');
  assert.equal(g.lineup.a.p1, 'bench');
  assert.equal(L.cardsLeft(g, grade, 'a'), Infinity);
  L.sub(g, grade, ctxAt(MIN), 'a', 'p6', 'p1');
  assert.equal(g.lineup.a.p1, 'on');
});

test('쿼터제', () => {
  const grade = { ...L.gradeFromSport('basket', '6학년') };
  const g = L.newGame('g6', 1, 'ta', 'tb');
  L.start(g, grade, ctxAt(0));
  L.score(g, grade, ctxAt(MIN), 'a', 3, 'p1');
  for (let i = 0; i < 3; i++) L.nextPart(g, grade, ctxAt(MIN));
  assert.equal(g.cur, 3);
  assert.equal(L.partName(grade, g.cur), '4쿼터');
  L.nextPart(g, grade, ctxAt(MIN));
  assert.equal(g.status, 'done');
  assert.equal(g.sa, 3);
});

test('세트제: 세트 점수, 동점이면 못 끝냄, 과반이면 경기 종료', () => {
  const grade = L.gradeFromSport('volley', '5학년');
  const g = L.newGame('g5', 1, 'ta', 'tb');
  L.start(g, grade, ctxAt(0));
  assert.equal(g.clock, undefined);
  assert.throws(() => L.nextPart(g, grade, ctxAt(1)), /같습니다/);
  for (let i = 0; i < 25; i++) L.score(g, grade, ctxAt(1), 'a', 1);
  for (let i = 0; i < 18; i++) L.score(g, grade, ctxAt(1), 'b', 1);
  assert.equal(g.sa, 0);
  L.nextPart(g, grade, ctxAt(2));
  assert.deepEqual([g.sa, g.sb, g.cur], [1, 0, 1]);
  L.score(g, grade, ctxAt(3), 'a', 1);
  const logs = L.nextPart(g, grade, ctxAt(4));
  assert.equal(g.status, 'done');
  assert.deepEqual([g.sa, g.sb], [2, 0]);
  assert.match(logs.at(-1).text, /경기 종료 2 : 0/);
});

test('이닝제: 공수 교대와 회별 점수', () => {
  const grade = { ...L.gradeFromSport('teeball', '4학년'), innings: 2 };
  const g = L.newGame('g4', 1, 'ta', 'tb');
  L.start(g, grade, ctxAt(0));
  assert.equal(L.tag(g, grade, 1), '1회 초');
  L.score(g, grade, ctxAt(1), 'a', 1, 'p2');
  L.nextPart(g, grade, ctxAt(2));
  assert.deepEqual([g.cur, g.half], [0, 1]);
  L.score(g, grade, ctxAt(3), 'b', 1, 'p1'); L.score(g, grade, ctxAt(3), 'b', 1, 'p1');
  L.nextPart(g, grade, ctxAt(4));
  assert.deepEqual([g.cur, g.half], [1, 0]);
  L.nextPart(g, grade, ctxAt(5));
  L.nextPart(g, grade, ctxAt(6));
  assert.equal(g.status, 'done');
  assert.deepEqual([g.pa, g.pb, g.sa, g.sb], [[1, 0], [2, 0], 1, 2]);
});

test('피구: 전원 아웃이면 세트 즉시 종료', () => {
  const grade = { ...L.gradeFromSport('dodge', '5학년'), starters: 3 };
  const g = L.newGame('g5', 1, 'ta', 'tb');
  L.start(g, grade, ctxAt(0, { rosters: { a: roster(3, 3), b: roster(3, 3) } }));
  assert.deepEqual(g.remain, { a: 3, b: 3 });
  L.dodgeOut(g, grade, ctxAt(MIN), 'b', -1);
  L.dodgeOut(g, grade, ctxAt(MIN), 'b', -1);
  const logs = L.dodgeOut(g, grade, ctxAt(2 * MIN), 'b', -1);
  assert.match(logs[0].text, /1세트 가팀 승 \(전원 아웃 · 03:00 남음\)/);
  assert.deepEqual([g.sa, g.sb, g.cur], [1, 0, 1]);
  assert.deepEqual(g.remain, { a: 3, b: 3 });
  assert.equal(g.clock.run, false);
});

test('피구: 시간 종료 때 인원이 많은 팀 승, 같으면 무승부 또는 연장', () => {
  const grade = { ...L.gradeFromSport('dodge', '5학년'), starters: 3 };
  const mkGame = () => { const g = L.newGame('g5', 1, 'ta', 'tb'); L.start(g, grade, ctxAt(0, { rosters: { a: roster(3, 3), b: roster(3, 3) } })); return g; };

  let g = mkGame();
  L.dodgeOut(g, grade, ctxAt(MIN), 'a', -1);
  L.timeUp(g, grade, ctxAt(5 * MIN));
  assert.deepEqual([g.wins[0], g.why[0], g.sb], ['b', '시간 종료', 1]);

  g = mkGame();
  L.timeUp(g, grade, ctxAt(5 * MIN));
  assert.equal(g.tie, true);
  assert.throws(() => L.dodgeOut(g, grade, ctxAt(5 * MIN), 'a', -1), /동점/);
  L.dodgeTie(g, grade, ctxAt(5 * MIN), 'draw');
  assert.deepEqual([g.wins[0], g.sa, g.sb, g.cur, g.tie], ['d', 0, 0, 1, false]);

  g = mkGame();
  L.timeUp(g, grade, ctxAt(5 * MIN));
  L.dodgeTie(g, grade, ctxAt(5 * MIN), 'ext');
  assert.equal(g.ext, true);
  const logs = L.dodgeOut(g, grade, ctxAt(5 * MIN + 5000), 'a', -1);
  assert.match(logs[0].text, /1세트 나팀 승 \(연장\)/);
  assert.equal(g.ext, false);
});

test('순위표와 개인 기록', () => {
  const grade = L.gradeFromSport('futsal', '6학년');
  const teams = { ta: { name: '가팀', players: roster(8, 5) }, tb: { name: '나팀', players: roster(8, 5) }, tc: { name: '다팀', players: {} } };
  const g = { id: 'x1', ...L.newGame('g6', 1, 'ta', 'tb') };
  const logs = { x1: {} };
  let n = 0; const keep = (list) => list.forEach((l) => { logs.x1[`l${n++}`] = l; });
  const c = (now) => ctxAt(now, { rosters: { a: teams.ta.players, b: teams.tb.players } });
  keep(L.start(g, grade, c(0)));
  keep(L.score(g, grade, c(MIN), 'a', 1, 'p3'));
  keep(L.score(g, grade, c(MIN), 'a', 1, 'p3'));
  keep(L.sub(g, grade, c(2 * MIN), 'a', 'p1', 'p6'));
  keep(L.score(g, grade, c(3 * MIN), 'a', 1, 'p6'));
  logs.x1.l2.x = true; // 두 번째 득점은 취소
  keep(L.nextPart(g, grade, c(10 * MIN)));
  keep(L.nextPart(g, grade, c(20 * MIN)));
  g.sa = 2; // 취소 반영
  const table = L.standings(teams, [g]);
  assert.deepEqual(table.map((r) => [r.name, r.pts, r.rank]), [['가팀', 3, 1], ['다팀', 0, 2], ['나팀', 0, 3]]);
  const rec = Object.fromEntries(L.records(teams, [g], logs).map((r) => [r.key, r]));
  assert.deepEqual([rec['ta/p3'].goals, rec['ta/p3'].starts, rec['ta/p3'].games], [1, 1, 1]);
  assert.deepEqual([rec['ta/p6'].goals, rec['ta/p6'].subIn, rec['ta/p6'].starts], [1, 1, 0]);
  assert.equal(rec['ta/p7'], undefined);
  assert.equal(rec['tb/p1'].games, 1);
});

test('빈 칸이 지워진 경기도 다시 채워서 읽는다', () => {
  const grade = L.gradeFromSport('volley', '5학년');
  const g = L.norm({ status: 'live', cur: 1, wins: { 0: 'a' } }, grade);
  assert.deepEqual([g.pa, g.wins, g.used, g.half], [[0, 0, 0], ['a'], { a: 0, b: 0 }, 0]);
});

test('이닝제: 수비 팀은 점수를 올릴 수 없고, 정정(-1)은 된다', () => {
  const grade = L.gradeFromSport('teeball', '4학년');
  const g = L.newGame('g4', 1, 'ta', 'tb');
  L.start(g, grade, ctxAt(0));
  assert.equal(L.attacker(g), 'a');
  assert.throws(() => L.score(g, grade, ctxAt(1), 'b', 1, ''), /수비 팀/);
  L.score(g, grade, ctxAt(1), 'a', 1, '');
  L.nextPart(g, grade, ctxAt(2));
  assert.equal(L.attacker(g), 'b');
  assert.throws(() => L.score(g, grade, ctxAt(3), 'a', 1, ''), /수비 팀/);
  L.score(g, grade, ctxAt(3), 'a', -1);
  L.score(g, grade, ctxAt(3), 'b', 1, '');
  assert.deepEqual([g.sa, g.sb], [0, 1]);
});

test('경기 일정 글씨: 날짜·교시·시간은 모두 선택', () => {
  assert.equal(L.whenText({}), '');
  assert.equal(L.whenText({ date: '2026-11-20', period: '3교시' }), '11월 20일(금) 3교시');
  assert.equal(L.whenText({ date: '2026-11-20', time: '09:30', period: '3교시' }), '11월 20일(금) 오전 9시 30분');
  assert.equal(L.whenText({ time: '14:00' }), '오후 2시');
  assert.equal(L.whenText({ time: '23:05' }), '오후 11시 5분');
  assert.equal(L.whenText({ time: '00:30' }), '오전 12시 30분');
  assert.equal(L.whenText({ time: '12:00' }), '오후 12시');
  assert.equal(L.whenText({ period: '점심시간' }), '점심시간');
  assert.equal(L.whenText({ date: '2026-03-02' }), '3월 2일(월)');
});

const teeGame = (extra = {}, n = 3) => {
  const grade = { ...L.gradeFromSport('teeball', '4학년'), detail: true, starters: n, ...extra };
  const g = L.newGame('g4', 1, 'ta', 'tb');
  const c = (now, op) => ctxAt(now, { rosters: { a: roster(n + 1, n), b: roster(n + 1, n) }, op });
  L.start(g, grade, c(0));
  return { grade, g, c };
};

test('티볼 타석 기록: 타순, 안타만큼 주자 진루, 홈인하면 점수·타점', () => {
  const { grade, g, c } = teeGame();
  assert.equal(g.detail, true);
  assert.deepEqual(g.order.a, ['p1', 'p2', 'p3']);
  assert.equal(L.batterOf(g), 'p1');
  let logs = L.bat(g, grade, c(1, 'o1'), 'h1');
  assert.deepEqual(g.bases, { b1: 'p1', b2: '', b3: '' });
  assert.match(logs[0].text, /가팀 1 선수1 · 1루타/);
  L.bat(g, grade, c(2, 'o2'), 'h2');
  assert.deepEqual(g.bases, { b1: '', b2: 'p2', b3: 'p1' });
  logs = L.bat(g, grade, c(3, 'o3'), 'hr');
  assert.deepEqual([g.bases, g.sa, g.pa[0]], [{ b1: '', b2: '', b3: '' }, 3, 3]);
  assert.deepEqual([logs[0].rbi, logs[0].scored], [3, ['p1', 'p2', 'p3']]);
  assert.match(logs[0].text, /홈런 · 3득점/);
  assert.equal(g.halfDone, true, '전원 타격제: 타순이 한 바퀴 돌면 공격 끝');
  assert.throws(() => L.bat(g, grade, c(4), 'h1'), /공수 교대/);
  L.nextPart(g, grade, c(5));
  assert.deepEqual([g.half, g.hb, g.outs, g.halfDone, L.batterOf(g)], [1, 0, 0, false, 'p1']);
  assert.equal(L.attacker(g), 'b');
});

test('티볼 타석 기록: 땅볼·플라이 아웃, 병살, 실책 출루, 주자 고치기', () => {
  const { grade, g, c } = teeGame({ rotate: 'out3' }, 5);
  assert.throws(() => L.bat(g, grade, c(1), 'dp'), /주자가 없으면/);
  let logs = L.bat(g, grade, c(1, 'o1'), 'e');
  assert.deepEqual([g.bases.b1, logs[0].rbi, logs[0].res], ['p1', 0, 'e']);
  logs = L.runner(g, grade, c(2, 'o2'), 1, 'adv');
  assert.equal(g.bases.b2, 'p1');
  assert.match(logs[0].text, /진루 \(1루 → 2루\)/);
  L.bat(g, grade, c(3, 'o3'), 'h1');
  assert.deepEqual(g.bases, { b1: 'p2', b2: '', b3: 'p1' });
  assert.throws(() => L.runner(g, grade, c(4), 2, 'out'), /주자가 없습니다/);
  logs = L.runner(g, grade, c(4, 'o4'), 3, 'adv');
  assert.deepEqual([g.sa, logs[0].scored, logs[0].rbiTo], [1, ['p1'], 'p2']);
  L.bat(g, grade, c(5, 'o5'), 'dp');
  assert.deepEqual([g.outs, g.bases.b1, g.halfDone], [2, '', false]);
  L.bat(g, grade, c(6, 'o6'), 'fo');
  assert.deepEqual([g.outs, g.halfDone], [3, true]);
  assert.equal(L.RESULT_NAMES.go, '땅볼 아웃');
});

test('티볼 타석 기록: 방금 기록 취소, 교체하면 타순 자리 이어받기', () => {
  const { grade, g, c } = teeGame();
  L.bat(g, grade, c(1, 'o1'), 'h3');
  L.bat(g, grade, c(2, 'o2'), 'h1');
  assert.deepEqual([g.sa, g.bases.b1, g.undo.op], [1, 'p2', 'o2']);
  L.undo(g, grade);
  assert.deepEqual([g.sa, g.bases, g.hb, L.batterOf(g), g.undo], [0, { b1: '', b2: '', b3: 'p1' }, 1, 'p2', undefined]);
  assert.throws(() => L.undo(g, grade), /되돌릴 기록/);
  L.sub(g, grade, c(3), 'a', 'p1', 'p4');
  assert.deepEqual([g.order.a, g.bases.b3], [['p4', 'p2', 'p3'], 'p4']);
});

test('티볼 타석 기록: 개인 기록(타석·안타·타점·득점), 선발이 없으면 점수만 방식으로', () => {
  const { grade, g, c } = teeGame();
  const teams = { ta: { name: '가팀', players: roster(4, 3) }, tb: { name: '나팀', players: roster(4, 3) } };
  const logs = { x: {} }; let n = 0; const keep = (list) => list.forEach((l) => { logs.x[`l${n++}`] = JSON.parse(JSON.stringify(l)); });
  keep(L.bat(g, grade, c(1, 'o1'), 'h2'));
  keep(L.bat(g, grade, c(2, 'o2'), 'h1'));
  keep(L.runner(g, grade, c(3, 'o3'), 3, 'home'));
  keep(L.bat(g, grade, c(4, 'o4'), 'go'));
  const rec = Object.fromEntries(L.records(teams, [{ id: 'x', ...g }], logs).map((r) => [r.key, r]));
  assert.deepEqual([rec['ta/p1'].ab, rec['ta/p1'].h, rec['ta/p1'].h2, rec['ta/p1'].goals], [1, 1, 1, 1]);
  assert.deepEqual([rec['ta/p2'].ab, rec['ta/p2'].h, rec['ta/p2'].rbi, rec['ta/p2'].goals], [1, 1, 1, 0]);
  assert.deepEqual([rec['ta/p3'].ab, rec['ta/p3'].h], [1, 0]);
  const g2 = L.newGame('g4', 2, 'ta', 'tb');
  L.start(g2, grade, ctxAt(0, { rosters: { a: {}, b: {} } }));
  assert.equal(g2.detail, false);
  assert.throws(() => L.bat(g2, grade, c(1), 'h1'), /타석 기록을 쓰지 않는/);
});

test('티볼: 미리 받은 타순대로 선발과 타순이 정해진다', () => {
  const grade = { ...L.gradeFromSport('teeball', '4학년'), detail: true };
  const g = L.newGame('g4', 1, 'ta', 'tb');
  const rosters = { a: roster(5, 3), b: roster(5, 3) };
  L.start(g, grade, ctxAt(0, { rosters, orders: { a: { list: ['p4', 'p1', 'p9', 'p4', 'p2'], at: 1 } } }));
  assert.deepEqual(g.order.a, ['p4', 'p1', 'p2'], '없는 선수와 겹친 선수는 빠짐');
  assert.deepEqual([g.lineup.a.p4, g.lineup.a.p3, g.st.a.p4, g.st.a.p3], ['on', 'bench', true, undefined]);
  assert.deepEqual(g.order.b, ['p1', 'p2', 'p3'], '안 낸 팀은 선발이 번호 순');
  assert.equal(L.batterOf(g), 'p4');
  const g2 = L.newGame('g6', 1, 'ta', 'tb');
  L.start(g2, L.gradeFromSport('futsal', '6학년'), ctxAt(0, { rosters, orders: { a: { list: ['p4'] } } }));
  assert.equal(g2.lineup.a.p4, 'bench', '이닝제가 아니면 타순 제출을 쓰지 않음');
});

test('티볼: 최대 진루 수를 2로 두면 3루타는 못 누르고 홈런은 된다', () => {
  const { grade, g, c } = teeGame({ maxAdv: 2 }, 5);
  assert.equal(L.maxAdv(grade), 2);
  assert.throws(() => L.bat(g, grade, c(1), 'h3'), /2루까지만/);
  L.bat(g, grade, c(1, 'o1'), 'h2');
  L.bat(g, grade, c(2, 'o2'), 'hr');
  assert.equal(g.sa, 2);
  assert.equal(L.maxAdv({}), 3);
});

test('병살: 주자가 여럿이면 함께 아웃되는 주자를 골라야 한다', () => {
  const { grade, g, c } = teeGame({ rotate: 'out3' }, 6);
  L.bat(g, grade, c(1, 'o1'), 'h1'); L.bat(g, grade, c(2, 'o2'), 'h1');
  assert.deepEqual(g.bases, { b1: 'p2', b2: 'p1', b3: '' });
  assert.throws(() => L.bat(g, grade, c(3), 'dp'), /주자를 골라/);
  const logs = L.bat(g, grade, c(3, 'o3'), 'dp', 2);
  assert.deepEqual([g.bases, g.outs], [{ b1: 'p2', b2: '', b3: '' }, 2]);
  assert.match(logs[0].text, /병살 \(2루 주자 1 선수1 함께 아웃\)/);
});

test('잔루 유지 설정: 켜면 다음 공격 때 남은 주자가 그대로, 끄면 비워짐', () => {
  for (const keep of [true, false]) {
    const { grade, g, c } = teeGame({ keepRunners: keep });
    L.bat(g, grade, c(1, 'o1'), 'h2'); L.bat(g, grade, c(2, 'o2'), 'go'); L.bat(g, grade, c(3, 'o3'), 'h1');
    assert.deepEqual(g.bases, { b1: 'p3', b2: '', b3: 'p1' });
    L.nextPart(g, grade, c(4));
    assert.deepEqual(g.bases, { b1: '', b2: '', b3: '' }, '상대 공격은 빈 루에서 시작');
    L.bat(g, grade, c(5, 'o5'), 'h1');
    L.nextPart(g, grade, c(6));
    assert.deepEqual([g.cur, g.half], [1, 0]);
    assert.deepEqual(g.bases, keep ? { b1: 'p3', b2: '', b3: 'p1' } : { b1: '', b2: '', b3: '' });
    L.nextPart(g, grade, c(7));
    assert.deepEqual(g.bases, keep ? { b1: 'p1', b2: '', b3: '' } : { b1: '', b2: '', b3: '' });
  }
});

test('야구는 티볼과 같은 방식에 3아웃제가 기본', () => {
  const b = L.gradeFromSport('baseball', '중1'), tb = L.gradeFromSport('teeball', '6학년');
  assert.deepEqual([b.format, b.rotate, b.detail, L.sportName(b)], ['innings', 'out3', true, '야구']);
  assert.deepEqual([tb.format, tb.rotate, tb.detail], ['innings', 'all', true]);
  assert.equal(L.gradeFromSport('futsal', 'x').detail, false);
});

test('어시스트: 득점 기록에 함께 남고 개인 기록에 쌓인다', () => {
  const grade = L.gradeFromSport('futsal', '6학년');
  assert.equal(grade.assist, true);
  assert.equal(L.gradeFromSport('basket', 'x').assist, false);
  const teams = { ta: { name: '가팀', players: roster(8, 5) }, tb: { name: '나팀', players: roster(8, 5) } };
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  const c = (now) => ctxAt(now, { rosters: { a: teams.ta.players, b: teams.tb.players } });
  const logs = { x: {} }; let n = 0; const keep = (list) => list.forEach((l) => { logs.x[`l${n++}`] = l; });
  keep(L.start(g, grade, c(0)));
  const out = L.score(g, grade, c(1), 'a', 1, 'p3', 'p5'); keep(out);
  assert.match(out[0].text, /가팀 득점 · 3 선수3 \(어시스트 5 선수5\)/);
  assert.equal(out[0].apid, 'p5');
  keep(L.score(g, grade, c(2), 'a', 1, 'p3', 'p3'));
  keep(L.score(g, grade, c(3), 'a', 1, 'p5', ''));
  const rec = Object.fromEntries(L.records(teams, [g], logs).map((r) => [r.key, r]));
  assert.deepEqual([rec['ta/p3'].goals, rec['ta/p3'].as, rec['ta/p5'].goals, rec['ta/p5'].as], [2, 0, 1, 1]);
});

test('1·2·3점 단추는 농구와 직접 입력 종목에서만', () => {
  assert.deepEqual(L.stepsOf(L.gradeFromSport('basket', 'x')), [1, 2, 3]);
  assert.deepEqual(L.stepsOf({ ...L.gradeFromSport('netball', 'x'), steps: '123' }), [1]);
  assert.deepEqual(L.stepsOf({ ...L.gradeFromSport('futsal', 'x'), steps: '123' }), [1]);
  assert.deepEqual(L.stepsOf({ ...L.gradeFromSport('custom', 'x'), steps: '123' }), [1, 2, 3]);
  assert.deepEqual(L.stepsOf({ ...L.gradeFromSport('basket', 'x'), steps: '1' }), [1]);
  assert.equal(L.canStep(L.gradeFromSport('teeball', 'x')), false);
});

test('피구 아웃 기록: 누가 아웃됐고 누가 아웃시켰는지, 되살아남, 세트가 바뀌면 초기화', () => {
  const grade = { ...L.gradeFromSport('dodge', '5학년'), starters: 3 };
  assert.equal(grade.outDetail, true);
  const teams = { ta: { name: '가팀', players: roster(3, 3) }, tb: { name: '나팀', players: roster(3, 3) } };
  const g = { id: 'x', ...L.newGame('g5', 1, 'ta', 'tb') };
  const c = (now) => ctxAt(now, { rosters: { a: teams.ta.players, b: teams.tb.players } });
  const logs = { x: {} }; let n = 0; const keep = (list) => { list.forEach((l) => { logs.x[`l${n++}`] = l; }); return list; };
  keep(L.start(g, grade, c(0)));
  const out = keep(L.dodgeOut(g, grade, c(1), 'b', -1, 'p2', 'p1'));
  assert.match(out[0].text, /나팀 2 선수2 아웃 · 가팀 1 선수1가 아웃시킴/);
  assert.deepEqual([g.remain.b, g.dout.b.p2], [2, true]);
  keep(L.dodgeOut(g, grade, c(2), 'b', 1, 'p2'));
  assert.deepEqual([g.remain.b, g.dout.b.p2], [3, undefined]);
  keep(L.dodgeOut(g, grade, c(3), 'b', -1, 'p1', 'p1'));
  keep(L.dodgeOut(g, grade, c(4), 'b', -1, 'p2', ''));
  keep(L.dodgeOut(g, grade, c(5), 'b', -1));
  assert.deepEqual([g.cur, g.sa, g.dout], [1, 1, { a: {}, b: {} }]);
  const rec = Object.fromEntries(L.records(teams, [g], logs).map((r) => [r.key, r]));
  assert.equal(rec['ta/p1'].ko, 2);
  assert.equal(rec['tb/p2'].ko, 0);
});

test('선발 인원: 명단의 선발이 설정보다 많으면 번호 순으로 설정 인원까지만 선발로 선다', () => {
  const grade = L.gradeFromSport('volley', '6학년');
  const players = roster(10, 10);
  assert.equal(L.starterIds(players, grade.starters).length, 6);
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  L.start(g, grade, ctxAt(0, { rosters: { a: players, b: players } }));
  assert.equal(Object.values(g.lineup.a).filter((s) => s === 'on').length, 6);
  assert.equal(Object.values(g.lineup.a).filter((s) => s === 'bench').length, 4);
});

test('빠짐으로 둔 선수는 경기 명단에 들어가지 않는다', () => {
  const grade = L.gradeFromSport('futsal', '6학년');
  const players = roster(8, 5); players.p8.off = true;
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  L.start(g, grade, ctxAt(0, { rosters: { a: players, b: players } }));
  assert.equal(g.lineup.a.p8, undefined);
  assert.equal(Object.values(g.lineup.a).filter((s) => s === 'bench').length, 2);
});

test('득점 기록 고치기: 점수만 올린 기록에 나중에 선수와 어시스트를 넣으면 개인 기록에 잡힌다', () => {
  const grade = { ...L.gradeFromSport('soccer', '6학년'), starters: 3 };
  const teams = { ta: { name: '가팀', players: roster(3, 3) }, tb: { name: '나팀', players: roster(3, 3) } };
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  const c = (now) => ctxAt(now, { rosters: { a: teams.ta.players, b: teams.tb.players } });
  L.start(g, grade, c(0));
  const [goal] = L.score(g, grade, c(1), 'a', 1, '');
  assert.match(goal.text, /선수 기록 없음/);
  const fixed = { ...goal, ...L.editGoal(goal, c(9), 'p2', 'p3') };
  assert.equal(fixed.text, '가팀 득점 · 2 선수2 (어시스트 3 선수3)');
  assert.deepEqual([fixed.pid, fixed.apid, fixed.at, g.sa], ['p2', 'p3', goal.at, 1]);
  const rec = Object.fromEntries(L.records(teams, [g], { x: { l1: fixed } }).map((r) => [r.key, r]));
  assert.deepEqual([rec['ta/p2'].goals, rec['ta/p3'].as], [1, 1]);
  assert.deepEqual(L.editGoal(fixed, c(9), '', 'p3'), { pid: '', apid: '', text: '가팀 득점 · 선수 기록 없음' });
  assert.equal(L.editGoal(fixed, c(9), 'p2', 'p2').apid, '');
  assert.throws(() => L.editGoal({ ...goal, x: true }, c(9), 'p2', ''));
});

test('농구 파울: 누르면 시계가 멈추고, 개인·팀 파울이 쌓이며, 5반칙 퇴장과 팀 파울 자유투를 알린다', () => {
  const grade = L.gradeFromSport('basket', '6학년');
  assert.deepEqual([grade.fouls, grade.shot, grade.eight, L.pfMax(grade), L.tfMax(grade)], [true, true, true, 5, 5]);
  assert.equal(L.usesFouls(L.gradeFromSport('futsal', '6학년')), false);
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  L.start(g, grade, ctxAt(0));
  L.foulStop(g, grade, ctxAt(10000));
  assert.deepEqual([g.clock.run, g.clock.left, g.buzz], [false, 8 * 60000 - 10000, undefined], '시계만 멈추고 휘슬은 울리지 않는다');
  const logs = [];
  for (let i = 1; i <= 5; i++) logs.push(...L.foul(g, grade, ctxAt(10000 + i), 'a', 'p1'));
  assert.match(logs[0].text, /가팀 파울 · 1 선수1 \(개인 1 · 팀 1\)$/);
  assert.match(logs[4].text, /\(개인 5 · 팀 5\) · 5반칙 퇴장 · 팀 파울, 이제부터 자유투/);
  assert.deepEqual([L.foulsOf(g, 'a', 'p1'), g.tf.a[0], L.fouledOut(g, grade, 'a', 'p1'), L.fouledOut(g, grade, 'a', 'p2')], [5, 5, true, false]);
  assert.match(L.foul(g, grade, ctxAt(10010), 'b', '')[0].text, /나팀 파울 \(팀 1\)$/);
  L.unfoul(g, grade, {}, 'a', 'p1', 0);
  assert.deepEqual([L.foulsOf(g, 'a', 'p1'), g.tf.a[0], L.fouledOut(g, grade, 'a', 'p1')], [4, 4, false]);
  // 팀 파울은 구간마다 새로 센다
  L.nextPart(g, grade, ctxAt(20000));
  assert.deepEqual([g.cur, g.tf.a[0], g.tf.a[1], L.foulsOf(g, 'a', 'p1')], [1, 4, 0, 4]);
  const rec = Object.fromEntries(L.records({ ta: { name: '가팀', players: ctxAt(0).rosters.a }, tb: { name: '나팀', players: ctxAt(0).rosters.b } }, [g], { x: Object.fromEntries(logs.slice(0, 4).map((l, i) => [`l${i}`, l])) }).map((r) => [r.key, r]));
  assert.equal(rec['ta/p1'].pf, 4);
});

test('농구 공격 제한 시간과 8초: 공격권·골·일시 정지에 맞춰 돌고, 공격 제한 시간이 0이 되면 버저와 함께 시계가 멈춘다', () => {
  const grade = L.gradeFromSport('basket', '6학년');
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  L.start(g, grade, ctxAt(0));
  assert.equal(g.sc, undefined);
  L.possession(g, grade, ctxAt(1000), 'a');
  assert.deepEqual([g.poss, g.sc.run, L.tLeft(g.sc, 6000), L.tLeft(g.bc, 6000)], ['a', true, 19000, 3000]);
  L.crossed(g, grade);
  assert.equal(g.bc, undefined);
  // 일시 정지하면 함께 멈추고, 다시 시작하면 이어서 돈다
  L.toggleClock(g, grade, ctxAt(11000));
  assert.deepEqual([g.clock.run, g.sc.run, g.sc.left], [false, false, 14000]);
  L.toggleClock(g, grade, ctxAt(50000));
  assert.deepEqual([g.sc.run, L.tLeft(g.sc, 54000)], [true, 10000]);
  // 골이 들어가면 공격권이 넘어가고 24초·8초를 새로 센다
  L.score(g, grade, ctxAt(55000), 'a', 2, 'p1');
  assert.deepEqual([g.poss, L.tLeft(g.sc, 55000), L.tLeft(g.bc, 55000)], ['b', 24000, 8000]);
  L.shotSet(g, grade, ctxAt(56000), 14);
  assert.equal(L.tLeft(g.sc, 56000), 14000);
  // 8초는 0이 돼도 울리지 않고 시계도 멈추지 않는다
  assert.deepEqual(L.shotUp(g, grade, ctxAt(64000)), []);
  assert.deepEqual([L.tLeft(g.bc, 64000), g.clock.run, g.buzz], [0, true, undefined]);
  // 공격 제한 시간이 다 되면 버저와 함께 시계가 멈춘다
  const v = L.shotUp(g, grade, ctxAt(70000));
  assert.match(v[0].text, /나팀 24초 위반 · 가팀 공/);
  assert.deepEqual([g.clock.run, g.sc.run, g.bc, g.buzz.k], [false, false, undefined, 'buzzer']);
  assert.deepEqual(L.shotUp(g, grade, ctxAt(71000)), [], '두 번 불러도 한 번만');
  L.possession(g, grade, ctxAt(72000), 'a'); L.crossed(g, grade); L.toggleClock(g, grade, ctxAt(72000));
  const v24 = L.shotUp(g, grade, ctxAt(96000));
  assert.match(v24[0].text, /가팀 24초 위반 · 나팀 공/);
  assert.equal(g.clock.run, false);
  // 구간이 바뀌거나 경기가 끝나면 지운다
  L.nextPart(g, grade, ctxAt(97000));
  assert.deepEqual([g.sc, g.bc, g.poss], [undefined, undefined, undefined]);
  // 8초 룰을 끄면 24초만
  const g2 = { id: 'y', ...L.newGame('g6', 2, 'ta', 'tb') }, no8 = { ...grade, eight: false };
  L.start(g2, no8, ctxAt(0)); L.possession(g2, no8, ctxAt(0), 'b');
  assert.deepEqual([g2.bc, L.tLeft(g2.sc, 0)], [undefined, 24000]);
});

test('축구 경고·퇴장: 경고 두 번이면 퇴장, 퇴장 선수는 경기장에서 빠지고 교체로 못 들어온다, 취소하면 돌아온다', () => {
  const grade = L.gradeFromSport('soccer', '6학년');
  assert.deepEqual([grade.yr, L.usesCards(grade), L.usesCards(L.gradeFromSport('basket', '6'))], [true, true, false]);
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  const c = (now) => ctxAt(now, { rosters: { a: roster(10, 8), b: roster(10, 8) } });
  L.start(g, grade, c(0));
  const y1 = L.card(g, grade, c(1), 'a', 'p3', 'y')[0];
  assert.deepEqual([y1.text, y1.color, y1.red, L.yellows(g, 'a', 'p3'), g.lineup.a.p3, g.buzz], ['가팀 경고 · 3 선수3', 'y', false, 1, 'on', undefined]);
  const y2 = L.card(g, grade, c(2), 'a', 'p3', 'y')[0];
  assert.deepEqual([y2.text, y2.red, L.sentOff(g, 'a', 'p3'), g.lineup.a.p3], ['가팀 경고 2회 퇴장 · 3 선수3', true, true, 'red']);
  assert.throws(() => L.card(g, grade, c(3), 'a', 'p3', 'y'), /이미 퇴장/);
  assert.throws(() => L.sub(g, grade, c(3), 'a', 'p3', 'p9'), /지금 뛰는 선수/);
  const r = L.card(g, grade, c(4), 'b', 'p1', 'r')[0];
  assert.deepEqual([r.text, r.color, r.red, g.lineup.b.p1], ['나팀 퇴장 · 1 선수1', 'r', true, 'red']);
  const rec = Object.fromEntries(L.records({ ta: { name: '가팀', players: roster(10, 8) }, tb: { name: '나팀', players: roster(10, 8) } }, [g], { x: { a: y1, b: y2, c: r } }).map((x) => [x.key, x]));
  assert.deepEqual([rec['ta/p3'].yc, rec['ta/p3'].rc, rec['tb/p1'].yc, rec['tb/p1'].rc], [2, 1, 0, 1]);
  L.uncard(g, grade, {}, y2);
  assert.deepEqual([L.yellows(g, 'a', 'p3'), L.sentOff(g, 'a', 'p3'), g.lineup.a.p3], [1, false, 'on']);
  L.uncard(g, grade, {}, r);
  assert.deepEqual([L.sentOff(g, 'b', 'p1'), g.lineup.b.p1], [false, 'on']);
});

test('배드민턴·탁구: 듀스와 상한 점수로 세트가 끝나고, 서브할 쪽을 알려 준다', () => {
  const bad = L.gradeFromSport('badminton', '단식'), tt = L.gradeFromSport('tabletennis', '단식');
  assert.deepEqual([bad.format, bad.sets, bad.setPoints, bad.cap, bad.deuce, bad.starters, tt.sets, tt.setPoints, tt.cap], ['sets', 3, 21, 30, true, 1, 5, 11, 0]);
  const set = (grade, a, b) => L.setWon({ cur: 0, pa: [a], pb: [b] }, grade);
  assert.deepEqual([set(bad, 21, 19), set(bad, 21, 20), set(bad, 22, 20), set(bad, 29, 29), set(bad, 30, 29), set(bad, 20, 15), set(bad, 19, 21)], ['a', '', 'a', '', 'a', '', 'b']);
  assert.deepEqual([set(tt, 11, 9), set(tt, 11, 10), set(tt, 13, 11), set(tt, 10, 12), set({ ...tt, deuce: false }, 11, 10)], ['a', '', 'a', 'b', 'a']);
  // 탁구 서브: 2점마다 교대, 10:10부터는 1점마다, 세트가 바뀌면 첫 서브가 바뀐다
  const one = roster(1, 1), c = (now) => ctxAt(now, { rosters: { a: one, b: one } });
  const g = { id: 'x', ...L.newGame('g', 1, 'ta', 'tb') };
  L.start(g, tt, c(0));
  const seq = [];
  const pt = (side) => { L.score(g, tt, c(1), side, 1, ''); seq.push(L.server(g, tt)); };
  assert.equal(L.server(g, tt), 'a');
  for (let i = 0; i < 4; i++) pt('a');
  assert.deepEqual(seq, ['a', 'b', 'b', 'a']);
  for (let i = 0; i < 6; i++) pt('a'); for (let i = 0; i < 10; i++) pt('b');   // 10:10
  assert.equal(L.server(g, tt), 'a');
  pt('a'); assert.equal(L.server(g, tt), 'b');   // 11:10 듀스부터 1점마다
  assert.throws(() => L.nextPart(g, tt, c(2)), /아직 세트가 끝나지 않았습니다/);
  pt('a');
  L.nextPart(g, tt, c(3));
  assert.deepEqual([g.cur, g.sa, L.server(g, tt)], [1, 1, 'b']);
  // 배드민턴 서브: 점수를 딴 쪽, 다음 세트는 앞 세트를 이긴 쪽
  const h = { id: 'y', ...L.newGame('g', 2, 'ta', 'tb'), fs: 'b' };
  L.start(h, bad, c(0));
  assert.equal(L.server(h, bad), 'b');
  L.score(h, bad, c(1), 'a', 1, ''); assert.equal(L.server(h, bad), 'a');
  L.score(h, bad, c(1), 'b', 1, ''); assert.equal(L.server(h, bad), 'b');
  for (let i = 0; i < 20; i++) L.score(h, bad, c(1), 'a', 1, '');
  L.nextPart(h, bad, c(2));
  assert.deepEqual([h.cur, L.server(h, bad)], [1, 'a']);
});

test('쉬는 시간: 구간이 끝나면 자동으로 세고, 시계를 시작하거나 점수가 나면 끝난다. 쿼터제는 2쿼터 뒤 하프타임을 따로', () => {
  const grade = { ...L.gradeFromSport('netball', '5학년'), rest: 2, restHalf: 5 };
  const g = { id: 'x', ...L.newGame('g', 1, 'ta', 'tb') };
  L.start(g, grade, ctxAt(0));
  L.nextPart(g, grade, ctxAt(1000));
  assert.deepEqual([g.cur, g.rest.ms, L.restLeft(g, 61000)], [1, 120000, 60000]);
  L.toggleClock(g, grade, ctxAt(70000));
  assert.equal(g.rest, undefined);
  L.nextPart(g, grade, ctxAt(80000));
  assert.deepEqual([g.cur, g.rest.ms], [2, 300000], '2쿼터 뒤는 하프타임');
  L.score(g, grade, ctxAt(81000), 'a', 1, '');
  assert.equal(g.rest, undefined);
  L.nextPart(g, grade, ctxAt(90000)); L.endRest(g, grade);
  assert.equal(g.rest, undefined);
  L.nextPart(g, grade, ctxAt(99000));
  assert.deepEqual([g.status, g.rest], ['done', undefined], '경기가 끝나면 쉬는 시간은 없다');
  // 0이면 세지 않는다. 세트제도 세트 사이에 센다.
  const g0 = { id: 'y', ...L.newGame('g', 2, 'ta', 'tb') }, none = L.gradeFromSport('futsal', '6');
  L.start(g0, none, ctxAt(0)); L.nextPart(g0, none, ctxAt(1));
  assert.equal(g0.rest, undefined);
  const v = { ...L.gradeFromSport('volley', '4'), rest: 1 }, gv = { id: 'z', ...L.newGame('g', 3, 'ta', 'tb') };
  L.start(gv, v, ctxAt(0)); L.score(gv, v, ctxAt(1), 'a', 1, ''); L.nextPart(gv, v, ctxAt(2));
  assert.deepEqual([gv.cur, gv.rest.ms], [1, 60000]);
});

test('소리와 시계 맞추기: 구간 시간이 다 되면 휘슬, 경기가 끝나면 종료 휘슬, 멈춘 시계는 손으로 맞출 수 있다', () => {
  const grade = L.gradeFromSport('basket', '6학년');
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  L.start(g, grade, ctxAt(0));
  L.possession(g, grade, ctxAt(0), 'a');
  L.toggleClock(g, grade, ctxAt(30000));
  assert.deepEqual([g.clock.left, g.sc.left], [8 * 60000 - 30000, 0]);
  L.adjust(g, grade, ctxAt(31000), 'clock', 10000);
  L.adjust(g, grade, ctxAt(31000), 'clock', -1000);
  assert.deepEqual([g.clock.left, g.clock.run], [8 * 60000 - 21000, false]);
  L.adjust(g, grade, ctxAt(31000), 'sc', 5000);
  assert.equal(g.sc.left, 5000);
  L.adjust(g, grade, ctxAt(31000), 'clock', -99 * 60000);
  assert.equal(g.clock.left, 0, '0 아래로는 내려가지 않는다');
  L.adjust(g, grade, ctxAt(31000), 'clock', 2000);
  L.toggleClock(g, grade, ctxAt(40000));
  // 도는 중에 맞춰도 이어서 돈다
  L.adjust(g, grade, ctxAt(40500), 'clock', 1000);
  assert.deepEqual([g.clock.run, L.clockLeft(g, 40500)], [true, 2500]);
  L.timeUp(g, grade, ctxAt(43100));
  assert.deepEqual([g.clock.run, g.buzz.k], [false, 'whistle']);
  for (let i = 0; i < 4; i++) L.nextPart(g, grade, ctxAt(50000 + i));
  assert.deepEqual([g.status, g.buzz.k], ['done', 'end']);
});
