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
