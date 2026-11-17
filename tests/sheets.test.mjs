// 기록지: 학교급과 경기 방식에 따라 칸이 바뀌는지, 입력표 값이 개인 기록에 들어가는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import * as SH from '../js/sheets.js';

test('기록지 종류: 이닝제는 없고, 종목마다 맞는 양식을 쓴다', () => {
  const kind = (s) => SH.sheetKind(L.gradeFromSport(s, '6학년'));
  assert.deepEqual(['teeball', 'baseball', 'futsal', 'soccer', 'basket', 'netball', 'volley', 'dodge', 'badminton', 'tabletennis', 'custom'].map(kind),
    ['', '', 'soccer', 'soccer', 'basket', 'netball', 'volley', 'dodge', 'racket', 'racket', 'free']);
});

test('학교급: 초등용은 칸이 적고, 중·고용은 자세하다', () => {
  const gr = L.gradeFromSport('basket', '6학년');
  assert.deepEqual(SH.statCols(gr, 'e').map(([k]) => k), ['pts', 'as', 'reb']);
  assert.deepEqual(SH.statCols(gr, 's').map(([k]) => k), ['ft', 'p2', 'p3', 'reb', 'as', 'stl', 'blk']);
  assert.equal(SH.levelOf({}), 'e'); assert.equal(SH.levelOf({ level: 's' }), 's');
  for (const s of Object.keys(L.SPORTS)) for (const lv of ['e', 's']) {
    const g = L.gradeFromSport(s, 'x'), html = SH.sheetHtml(g, lv, {});
    if (!SH.sheetKind(g)) { assert.equal(html, ''); continue; }
    assert.match(html, new RegExp(`${lv === 'e' ? '초등' : '중 · 고'}용`));
    const sh = SH.sheetOf(g, lv);
    assert.ok(sh.cols.reduce((a, c) => a + c[1], 0) <= 165, `${s} ${lv} 칸 폭이 종이를 넘지 않는다`);
  }
});

test('농구·넷볼: 전·후반으로 바꾸면 기록지 구간도 전반·후반으로 바뀐다', () => {
  for (const s of ['basket', 'netball']) {
    const q = L.gradeFromSport(s, 'x'), h = { ...q, format: 'halves' };
    assert.deepEqual(SH.partsOf(q), ['1Q', '2Q', '3Q', '4Q']);
    assert.deepEqual(SH.partsOf(h), ['전반', '후반']);
    const hq = SH.sheetHtml(q, 's', {}), hh = SH.sheetHtml(h, 's', {});
    assert.match(hq, /<th>4Q<\/th>/); assert.doesNotMatch(hq, /<th>후반<\/th>/);
    assert.match(hh, /<th>전반<\/th><th>후반<\/th><th>연장<\/th>/); assert.doesNotMatch(hh, /1Q/);
  }
  assert.deepEqual(SH.partsOf({ ...L.gradeFromSport('volley', 'x'), sets: 5 }).length, 5);
});

test('기록지에 대회·경기·팀·명단이 채워진다. 이름의 특수 문자는 그대로 글자로 나온다', () => {
  const gr = L.gradeFromSport('futsal', '6학년');
  const html = SH.sheetHtml(gr, 'e', { title: '햇살초 <리그>', game: '3경기', when: '11월 20일', a: { name: '6-1', players: [{ no: 7, name: '하늘' }, { no: 9, name: '바다' }] }, b: { name: '6-2', players: [] } });
  assert.match(html, /햇살초 &lt;리그&gt;/); assert.match(html, />3경기</); assert.match(html, /class="no">7<\/td><td class="nm">하늘</);
  assert.equal(SH.rowsFor(SH.sheetOf(gr, 'e'), { players: Array(20).fill({}) }, {}).rows, 18);
});

test('입력표에서 득점 뽑기: 종목마다 다르고, 안 적으면 null', () => {
  assert.equal(SH.pointsFrom({}), null);
  assert.equal(SH.pointsFrom({ reb: 3 }), null);
  assert.equal(SH.pointsFrom({ goals: 2 }), 2);
  assert.equal(SH.pointsFrom({ pts: 7 }), 7);
  assert.equal(SH.pointsFrom({ ft: 1, p2: 2, p3: 1 }), 8);
  assert.equal(SH.pointsFrom({ srv: 1, pt: 4 }), 5);
  assert.equal(SH.pointsFrom({ srv: 2 }), null, '서브 득점만으로는 득점을 바꾸지 않는다');
});

test('점수만 모드: 득점 선수를 고르지 않고 기록도 남기지 않는다. 입력표 값이 개인 기록에 들어간다', () => {
  const grade = { ...L.gradeFromSport('futsal', '6학년'), scoreOnly: true };
  assert.equal(L.usesPicker(grade), false);
  assert.equal(L.usesPicker({ ...grade, scoreOnly: false }), true);
  const teams = { ta: { name: '가', players: { p1: { no: 1, name: '하나' }, p2: { no: 2, name: '둘' } } }, tb: { name: '나', players: { q1: { no: 1, name: '셋' } } } };
  const g = { id: 'x', ...L.newGame('g6', 1, 'ta', 'tb') };
  const ctx = (now) => ({ now, uid: 'u', names: { a: '가', b: '나' }, players: { a: teams.ta.players, b: teams.tb.players } });
  L.start(g, grade, ctx(0));
  assert.deepEqual(L.score(g, grade, ctx(1000), 'a', 1, ''), []);
  assert.equal(g.sa, 1);
  assert.equal(L.records(teams, [g], {}, SH.pointsFrom).reduce((a, r) => a + r.goals, 0), 0);
  g.stats = { a: { p1: { goals: 1, sv: 2 }, p2: { as: 1 } } };
  const rows = L.records(teams, [g], {}, SH.pointsFrom);
  const p1 = rows.find((r) => r.name === '하나'), p2 = rows.find((r) => r.name === '둘');
  assert.deepEqual([p1.goals, p1.x.sv, p2.as, p2.goals], [1, 2, 1, 0]);
});
