// 학생 화면 읽기(poll.js) 시험: 가짜 DB로 "바뀐 표시만 읽고, 바뀐 경기만 다시 가져오는지" 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pollStore, pulseKeys } from '../js/poll.js';

test('바뀐 표시: 경기·기록·타순은 경기별로, 나머지는 all, 경기를 지우면 null', () => {
  assert.deepEqual(pulseKeys('t/T1/games/g1', { score: 1 }), { g1: true });
  assert.deepEqual(pulseKeys('t/T1/logs/g1', { text: 'x' }), { g1: true });
  assert.deepEqual(pulseKeys('t/T1/orders/g1/a', { list: [] }), { g1: true });
  assert.deepEqual(pulseKeys('t/T1/teams/x/players/p1', { bench: true }), { all: true });
  assert.deepEqual(pulseKeys('t/T1/grades/g/starters', 7), { all: true });
  assert.deepEqual(pulseKeys('t/T1', { 'games/g1': null, 'logs/g1': null, 'orders/g1': null }), { g1: null });
  assert.deepEqual(pulseKeys('t/T1', { 'grades/x': null, 'teams/y': null, 'logs/g2': null, 'games/g2': null }), { all: true, g2: null });
  assert.deepEqual(pulseKeys('t/T1/games', { g9: { no: 1 } }), { g9: true });
  assert.deepEqual(pulseKeys('t/T1/games/g1', null), { g1: null });
  assert.deepEqual(pulseKeys('t/T1/pulse', { g1: 1 }), {});
  assert.deepEqual(pulseKeys('m/T1/u1', { role: 'ref' }), {});
});

function fake() {
  const db = { t: { T1: {
    meta: { name: '햇살초 리그' }, grades: { gr: { label: '6학년' } }, teams: { a: { name: '가' }, b: { name: '나' } },
    games: { g1: { status: 'live', sa: 0 }, g2: { status: 'ready' } }, logs: { g1: { l1: { text: '시작' } } }, pulse: { all: 1, g1: 1, g2: 1 },
  } } };
  const calls = [];
  const getJson = async (path) => { calls.push(path); const v = path.split('/').reduce((o, k) => (o == null ? o : o[k]), db); return v === undefined ? null : JSON.parse(JSON.stringify(v)); };
  let next = null, delay = 0;
  const setTimer = (fn, ms) => { next = fn; delay = ms; };
  const seen = [];
  const store = pollStore({ getJson, setTimer });
  const wait = () => new Promise((r) => setTimeout(r, 5));
  return { db, calls, seen, store, wait, step: async () => { calls.length = 0; const fn = next; next = null; fn(); await wait(); }, delay: () => delay };
}

test('학생 화면 읽기: 처음엔 통째로, 그 뒤엔 표시만 읽고 바뀐 경기만 가져온다', async () => {
  const f = fake();
  f.store.on('t/T1', (v) => f.seen.push(v));
  await f.wait();
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].games.g1.sa, 0);
  assert.equal(f.seen[0].logs.g1.l1.text, '시작');
  assert.equal(f.delay(), 5000, '진행 중인 경기가 있으면 5초마다');

  await f.step();
  assert.deepEqual(f.calls, ['t/T1/pulse'], '바뀐 게 없으면 표시만 읽는다');
  assert.equal(f.seen.length, 1);

  f.db.t.T1.games.g1.sa = 1; f.db.t.T1.logs.g1.l2 = { text: '득점' }; f.db.t.T1.pulse.g1 = 2;
  await f.step();
  assert.deepEqual(f.calls.sort(), ['t/T1/games/g1', 't/T1/logs/g1', 't/T1/orders/g1', 't/T1/pulse'].sort());
  assert.equal(f.seen.at(-1).games.g1.sa, 1);
  assert.deepEqual(Object.keys(f.seen.at(-1).logs.g1), ['l1', 'l2']);

  f.db.t.T1.games.g3 = { status: 'ready' }; f.db.t.T1.pulse.g3 = 5;
  delete f.db.t.T1.games.g2; delete f.db.t.T1.pulse.g2;
  await f.step();
  assert.deepEqual(Object.keys(f.seen.at(-1).games).sort(), ['g1', 'g3'], '새 경기는 생기고 지운 경기는 빠진다');

  f.db.t.T1.teams.a.name = '가람'; f.db.t.T1.pulse.all = 9;
  await f.step();
  assert.equal(f.seen.at(-1).teams.a.name, '가람');
  assert.ok(!f.calls.includes('t/T1/logs'), '명단만 바뀌면 기록 전체를 다시 읽지 않는다');
  assert.equal(f.seen.at(-1).logs.g1.l2.text, '득점');

  f.db.t.T1.games.g1.status = 'done'; f.db.t.T1.pulse.g1 = 10;
  await f.step();
  assert.equal(f.delay(), 15000, '진행 중인 경기가 없으면 15초마다');
});

test('학생 화면 읽기: 바뀐 표시가 없는 대회는 통째로 다시 읽어서라도 따라간다', async () => {
  const f = fake();
  delete f.db.t.T1.pulse;
  f.store.on('t/T1', (v) => f.seen.push(v));
  await f.wait();
  f.db.t.T1.games.g1.sa = 3; f.db.t.T1.logs.g1.l2 = { text: '득점' };
  await f.step();
  assert.equal(f.seen.at(-1).games.g1.sa, 3);
  assert.equal(f.seen.at(-1).logs.g1.l2.text, '득점');
  await f.step();
  assert.equal(f.seen.length, 2, '바뀐 게 없으면 화면을 다시 그리지 않는다');
});

test('학생 화면 읽기: 없는 대회는 null, 읽기에 실패해도 멈추지 않는다', async () => {
  const seen = []; let next = null, fail = true;
  const store = pollStore({ getJson: async () => { if (fail) throw new Error('끊김'); return null; }, setTimer: (fn) => { next = fn; } });
  store.on('t/none', (v) => seen.push(v));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen.length, 0);
  fail = false; next(); await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, [null]);
});
