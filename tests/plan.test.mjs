// 대회 편성(plan.js) 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import * as P from '../js/plan.js';

const teamsOf = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i + 1}`, { name: `${i + 1}반` }]));
const make = (plan, n) => { let k = 0; const order = Object.keys(teamsOf(n)); const games = P.buildGames(plan, order, 'gr', () => `g${++k}`, 1, L.newGame); return Object.entries(games).map(([id, g]) => ({ id, ...g })); };
const end = (g, sa, sb) => { g.status = 'done'; g.sa = sa; g.sb = sb; };
const apply = (games, teams) => { const up = P.resolve(games, teams); for (const [id, s] of Object.entries(up)) Object.assign(games.find((g) => g.id === id), s); return up; };
const pairKey = (g) => [g.a, g.b].sort().join('-');

test('풀리그: 모든 팀이 한 번씩 만나고, 번호가 이어진다', () => {
  for (const n of [2, 3, 4, 5, 6, 7]) {
    const games = make({ mode: 'league' }, n);
    assert.equal(games.length, (n * (n - 1)) / 2);
    assert.equal(new Set(games.map(pairKey)).size, games.length, `${n}팀: 같은 대진이 없어야 함`);
    assert.deepEqual(games.map((g) => g.no), games.map((_, i) => i + 1));
    assert.ok(games.every((g) => g.stage === 'L' && g.a !== g.b));
  }
  assert.equal(P.planInfo({ mode: 'league' }, 5).text, '5팀 풀리그 10경기');
});

test('토너먼트: 4·8팀은 딱 맞고, 5·6팀은 부전승이 생기며 경기 수는 팀 수 - 1', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const games = make({ mode: 'cup' }, n);
    assert.equal(games.length, n - 1, `${n}팀`);
    assert.equal(games.at(-1).label, '결승');
    const real = games.flatMap((g) => [g.a, g.b]).filter((t) => !P.isOpen(t));
    assert.equal(new Set(real).size, real.length, '한 팀이 첫 경기에 두 번 나오면 안 됨');
    assert.equal(real.length, n, '모든 팀이 대진표에 한 번씩 들어가야 함');
  }
  const six = make({ mode: 'cup', third: true }, 6);
  assert.deepEqual(six.map((g) => g.label), ['8강 1', '8강 2', '준결승 1', '준결승 2', '3·4위전', '결승']);
  assert.match(P.planInfo({ mode: 'cup', third: true }, 6).text, /6팀 8강부터 토너먼트 6경기 · 부전승 2팀 · 3·4위전 포함/);
});

test('토너먼트 진행: 이긴 팀이 올라가고, 3·4위전에는 진 팀이 들어가며, 결과가 바뀌면 되돌린다', () => {
  const teams = teamsOf(4), games = make({ mode: 'cup', third: true }, 4);
  const [s1, s2, third, final] = games;
  assert.deepEqual([final.a, final.b, third.a], ['?준결승 1 승자', '?준결승 2 승자', '?준결승 1 패자']);
  end(s1, 2, 1); apply(games, teams);
  assert.deepEqual([final.a, third.a, final.b], [s1.a, s1.b, '?준결승 2 승자']);
  end(s2, 1, 1); apply(games, teams);
  assert.equal(final.b, '?준결승 2 승자', '동점이면 승자를 고를 때까지 비워 둔다');
  s2.win = 'b'; apply(games, teams);
  assert.deepEqual([final.b, third.b], [s2.b, s2.a]);
  s1.sa = 0; apply(games, teams);
  assert.deepEqual([final.a, third.a], [s1.b, s1.a], '점수가 고쳐지면 올라간 팀도 바뀐다');
  final.status = 'live'; s1.sa = 5;
  assert.deepEqual(P.resolve(games, teams), { [third.id]: { a: s1.b } }, '이미 시작한 경기는 건드리지 않는다');
});

test('조별 예선 + 결선: 조 편성, 조 안 풀리그, 조 순위대로 결선에 들어간다', () => {
  const teams = teamsOf(8), games = make({ mode: 'groups', groups: 2, adv: 2 }, 8);
  const grp = games.filter((g) => g.stage === 'G'), ko = games.filter((g) => g.stage === 'K');
  assert.deepEqual([grp.length, ko.length], [12, 3]);
  assert.deepEqual(P.groupsOf({ mode: 'groups', groups: 2 }, Object.keys(teams)), [['t1', 't3', 't5', 't7'], ['t2', 't4', 't6', 't8']]);
  assert.ok(grp.every((g) => (Number(g.a.slice(1)) % 2) === (Number(g.b.slice(1)) % 2)), '같은 조끼리만 만난다');
  assert.deepEqual(ko.map((g) => [g.label, g.a, g.b]), [['준결승 1', '?A조 1위', '?B조 2위'], ['준결승 2', '?B조 1위', '?A조 2위'], ['결승', '?준결승 1 승자', '?준결승 2 승자']]);
  // A조만 끝나면 A조 자리만 채워진다. 번호가 작은 팀이 이기게 한다.
  const win = (g) => end(g, Number(g.a.slice(1)) < Number(g.b.slice(1)) ? 2 : 0, Number(g.a.slice(1)) < Number(g.b.slice(1)) ? 0 : 2);
  grp.filter((g) => g.grp === 0).forEach(win); apply(games, teams);
  assert.deepEqual([ko[0].a, ko[0].b, ko[1].b], ['t1', '?B조 2위', 't3']);
  grp.filter((g) => g.grp === 1).forEach(win); apply(games, teams);
  assert.deepEqual([ko[0].a, ko[0].b, ko[1].a, ko[1].b], ['t1', 't4', 't2', 't3']);
  assert.match(P.planInfo({ mode: 'groups', groups: 2, adv: 2 }, 8).text, /2개 조\(4팀씩\) 예선 12경기 → 상위 4팀 준결승부터 토너먼트 3경기/);
  assert.equal(make({ mode: 'groups', groups: 3, adv: 2 }, 9).filter((g) => g.stage === 'K').length, 5, '6팀 결선은 부전승 2팀, 5경기');
  assert.equal(P.planInfo({ mode: 'groups', groups: 4, adv: 1 }, 6).plan.groups, 3, '조 개수는 조마다 두 팀이 되도록 줄어든다');
  assert.equal(P.planInfo({ mode: 'groups', groups: 3, adv: 4 }, 6).plan.adv, 2, '조별 진출 팀 수는 조의 팀 수를 넘지 않는다');
});

test('원형 예선 + 결선: 양옆 팀과만 한 번씩(팀마다 2경기), 상위 팀이 결선', () => {
  for (const n of [3, 4, 5, 6]) {
    const order = Object.keys(teamsOf(n)), games = make({ mode: 'ring', adv: 2 }, n), pre = games.filter((g) => g.stage === 'G');
    assert.equal(pre.length, n, `${n}팀: 예선은 팀 수만큼`);
    for (const t of order) assert.equal(pre.filter((g) => g.a === t || g.b === t).length, 2, `${t}는 2경기`);
    for (const g of pre) { const d = Math.abs(order.indexOf(g.a) - order.indexOf(g.b)); assert.ok(d === 1 || d === n - 1, '옆자리끼리만'); }
    assert.equal(new Set(pre.map(pairKey)).size, n);
    assert.deepEqual(games.filter((g) => g.stage === 'K').map((g) => [g.label, g.a, g.b]), [['결승', '?예선 1위', '?예선 2위']]);
  }
  const teams = teamsOf(5), games = make({ mode: 'ring', adv: 4, third: true }, 5);
  assert.deepEqual(games.filter((g) => g.stage === 'K').map((g) => g.label), ['준결승 1', '준결승 2', '3·4위전', '결승']);
  assert.deepEqual([games[0], games[1]].flatMap((g) => [g.a, g.b]).length, 4);
  assert.equal(new Set([games[0], games[1]].flatMap((g) => [g.a, g.b])).size, 4, '첫 두 경기에 같은 팀이 연달아 나오지 않는다');
  games.filter((g) => g.stage === 'G').forEach((g) => end(g, Number(g.a.slice(1)) < Number(g.b.slice(1)) ? 1 : 0, Number(g.a.slice(1)) < Number(g.b.slice(1)) ? 0 : 1));
  apply(games, teams);
  const semi = games.filter((g) => g.label.startsWith('준결승'));
  assert.ok(semi.every((g) => !P.isOpen(g.a) && !P.isOpen(g.b)), '예선이 끝나면 준결승 팀이 모두 정해진다');
  assert.match(P.planInfo({ mode: 'ring', adv: 4 }, 5).text, /5팀 원형 예선 5경기\(팀마다 2경기\) → 상위 4팀 준결승부터 토너먼트 3경기/);
  assert.ok(P.planInfo({ mode: 'ring', adv: 2 }, 2).problems.length);
});

test('연장: 동점으로 끝난 경기에 구간을 하나 더 붙여 다시 진행한다', () => {
  const roster = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i + 1}`, { no: i + 1, name: `선수${i + 1}`, bench: i >= 5 }]));
  const ctx = (now) => ({ now, uid: 'u', names: { a: '가', b: '나' }, rosters: { a: roster(6), b: roster(6) }, orders: {} });
  const grade = L.gradeFromSport('futsal', '6학년');
  const g = { ...L.newGame('gr', 1, 'ta', 'tb'), stage: 'K' };
  L.start(g, grade, ctx(0)); L.score(g, grade, ctx(1), 'a', 1, 'p1'); L.score(g, grade, ctx(2), 'b', 1, 'p1');
  L.nextPart(g, grade, ctx(3)); L.nextPart(g, grade, ctx(4));
  assert.deepEqual([g.status, g.sa, g.sb, P.winnerOf(g)], ['done', 1, 1, '']);
  const logs = L.extend(g, grade, ctx(5));
  assert.match(logs[0].text, /동점 1 : 1 · 연장 시작/);
  assert.deepEqual([g.status, g.cur, L.partCount(grade, g), L.partName(grade, g.cur), g.clock.left], ['live', 2, 3, '연장', Math.ceil(grade.minutes / 2) * 60000]);
  L.score(g, grade, ctx(6), 'b', 1, 'p2');
  L.nextPart(g, grade, ctx(7));
  assert.deepEqual([g.status, g.sa, g.sb, g.pb[2], P.winnerOf(g)], ['done', 1, 2, 1, 'b']);
  assert.throws(() => L.extend(g, grade, ctx(8)), /동점일 때만/);
  // 이닝제도 한 회를 더 한다
  const tg = L.gradeFromSport('teeball', '5학년');
  const t = { ...L.newGame('gr', 1, 'ta', 'tb'), stage: 'K' };
  L.start(t, { ...tg, detail: false }, ctx(0)); L.endGame(t, { ...tg, detail: false }, ctx(1));
  L.extend(t, { ...tg, detail: false }, ctx(2));
  assert.deepEqual([t.status, t.cur, t.half, L.partName(tg, t.cur, t.half)], ['live', tg.innings, 0, `${tg.innings + 1}회 초`]);
});

test('스위스 + 결선: 승패가 같은 팀끼리 추첨, 승수를 채우면 진출·같은 수만큼 지면 탈락, 결선은 무패 두 팀을 양 끝에', () => {
  assert.match(P.planInfo({ mode: 'swiss' }, 16).text, /16팀 스위스 33경기\(3승 진출 · 3패 탈락\) → 상위 8팀 8강부터 토너먼트 7경기/);
  assert.match(P.planInfo({ mode: 'swiss' }, 8).text, /8팀 스위스 10경기\(2승 진출 · 2패 탈락\) → 상위 4팀 준결승부터 토너먼트 3경기/);
  assert.ok(P.planInfo({ mode: 'swiss' }, 12).problems.length, '12팀은 짤 수 없다');
  for (const n of [8, 16]) for (let seed = 1; seed <= 25; seed++) {
    let x = seed * 7919; const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    const teams = teamsOf(n), W = P.swissWins(n); let k = 0; const id = () => `g${++k}`;
    const games = Object.entries(P.buildGames({ mode: 'swiss', third: true }, Object.keys(teams), 'gr', id, 1, L.newGame)).map(([gid, g]) => ({ id: gid, ...g }));
    assert.equal(games.length, n / 2);
    let rounds = 0;
    for (;;) {
      // 지금 라운드를 끝낸다: 승패는 무작위, 가끔 동점 뒤 승자 고르기
      for (const g of games.filter((y) => y.stage === 'S' && y.status !== 'done')) { if (rnd() < 0.2) { end(g, 1, 1); g.win = rnd() < 0.5 ? 'a' : 'b'; } else if (rnd() < 0.5) end(g, 2, 1); else end(g, 0, 3); }
      const before = [...games];
      const more = P.swissNext(games, teams, { third: true }, 'gr', id, games.length + 1, L.newGame, rnd);
      const list = Object.entries(more).map(([gid, g]) => ({ id: gid, ...g }));
      assert.ok(list.length, '라운드가 끝나면 다음 경기가 나와야 함');
      games.push(...list);
      if (list[0].stage === 'K') break;
      rounds++;
      const rows = Object.fromEntries(P.swissTable(before, teams).rows.map((r) => [r.id, r]));
      for (const g of list) {
        assert.equal(`${rows[g.a].w}-${rows[g.a].l}`, `${rows[g.b].w}-${rows[g.b].l}`, '승패가 같은 팀끼리만 만난다');
        assert.equal(g.rec, `${rows[g.a].w}승 ${rows[g.a].l}패`);
        assert.ok(rows[g.a].w < W && rows[g.a].l < W, '진출·탈락이 정해진 팀은 더 뛰지 않는다');
      }
    }
    const S = games.filter((g) => g.stage === 'S'), K = games.filter((g) => g.stage === 'K');
    assert.equal(S.length, n === 16 ? 33 : 10, `${n}팀 스위스 경기 수`);
    assert.equal(rounds, n === 16 ? 4 : 2, '1라운드 뒤 라운드 수');
    const { rows } = P.swissTable(games, teams);
    const inn = rows.filter((r) => r.state === 'in'), out = rows.filter((r) => r.state === 'out');
    assert.deepEqual([inn.length, out.length, rows.length], [n / 2, n / 2, n]);
    assert.ok(inn.every((r) => r.w === W) && out.every((r) => r.l === W));
    assert.equal(K.length, n / 2, '결선 경기 수(3·4위전 포함)');
    const first = K.filter((g) => g.round === n / 2), unbeaten = inn.filter((r) => r.l === 0).map((r) => r.id), last = inn.filter((r) => r.l === W - 1).map((r) => r.id);
    assert.equal(unbeaten.length, 2);
    assert.equal(new Set(first.flatMap((g) => [g.a, g.b])).size, n / 2, '진출 팀이 모두 한 번씩');
    assert.deepEqual([first[0].a, first.at(-1).b].sort(), [...unbeaten].sort(), '무패 두 팀은 대진표 양 끝');
    assert.ok(last.includes(first[0].b) && last.includes(first.at(-1).a), '무패 팀의 상대는 마지막에 올라온 팀 가운데 추첨');
    assert.deepEqual(P.swissNext(games, teams, {}, 'gr', id, 99, L.newGame, rnd), {}, '결선을 짠 뒤에는 더 만들지 않는다');
    // 이미 만난 팀과 다시 만나는 일은 드물어야 한다
    const keys = S.map(pairKey);
    assert.ok(keys.length - new Set(keys).size <= (n === 16 ? 3 : 2), `다시 만난 경기 ${keys.length - new Set(keys).size}`);
  }
});

test('스위스: 라운드가 끝나기 전이나 동점 승자를 고르기 전에는 다음 라운드를 짜지 않는다', () => {
  const teams = teamsOf(8); let k = 0; const id = () => `g${++k}`;
  const games = Object.entries(P.buildGames({ mode: 'swiss' }, Object.keys(teams), 'gr', id, 1, L.newGame)).map(([gid, g]) => ({ id: gid, ...g }));
  games.slice(0, 3).forEach((g) => end(g, 1, 0));
  assert.deepEqual(P.swissNext(games, teams, {}, 'gr', id, 5, L.newGame), {});
  end(games[3], 2, 2);
  assert.deepEqual(P.swissNext(games, teams, {}, 'gr', id, 5, L.newGame), {});
  games[3].win = 'b';
  const more = Object.values(P.swissNext(games, teams, {}, 'gr', id, 5, L.newGame));
  assert.deepEqual([more.length, more[0].label, more.map((g) => g.rec).sort().join()], [4, '스위스 2R', '0승 1패,0승 1패,1승 0패,1승 0패']);
  assert.deepEqual(more.map((g) => g.no), [5, 6, 7, 8]);
});
