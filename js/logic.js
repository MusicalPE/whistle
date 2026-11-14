// 휘슬! 경기 규칙 계산. 화면·저장과 떨어져 있어서 node 로 바로 시험할 수 있다.

const ALL_FORMATS = ['halves', 'quarters', 'single', 'sets', 'innings', 'dodge'];

export const SPORTS = {
  futsal: { name: '풋살', format: 'halves', formats: ['halves', 'single'], minutes: 10, starters: 5, cards: 3, steps: '1' },
  soccer: { name: '축구', format: 'halves', formats: ['halves', 'single'], minutes: 15, starters: 8, cards: 3, steps: '1' },
  netball: { name: '넷볼', format: 'quarters', formats: ['halves', 'quarters'], minutes: 8, starters: 7, cards: 3, steps: '1' },
  basket: { name: '농구', format: 'quarters', formats: ['halves', 'quarters'], minutes: 8, starters: 5, cards: 5, steps: '123' },
  volley: { name: '배구', format: 'sets', formats: ['sets'], sets: 3, setPoints: 25, starters: 6, cards: 6, steps: '1' },
  teeball: { name: '티볼', format: 'innings', formats: ['innings'], innings: 3, starters: 10, cards: 3, steps: '1' },
  dodge: { name: '피구', format: 'dodge', formats: ['dodge'], sets: 3, minutes: 5, starters: 10, cards: 0, steps: '1' },
  custom: { name: '직접 입력', format: 'halves', formats: ALL_FORMATS, minutes: 10, starters: 5, cards: 3, steps: '1' },
};

export const FORMAT_NAMES = {
  halves: '전·후반', quarters: '쿼터', single: '한 번에',
  sets: '세트', innings: '이닝(회)', dodge: '세트 (시간 + 전원 아웃)',
};

const TIMED_NAMES = { halves: ['전반', '후반'], quarters: ['1쿼터', '2쿼터', '3쿼터', '4쿼터'], single: ['경기'] };

export function gradeFromSport(sport, label) {
  const p = SPORTS[sport] || SPORTS.custom;
  return {
    label, sport: SPORTS[sport] ? sport : 'custom', sportName: '', format: p.format,
    minutes: p.minutes || 10, sets: p.sets || 3, setPoints: p.setPoints || 25, innings: p.innings || 3,
    starters: p.starters, cards: p.cards, reentry: false, steps: p.steps,
    // 이닝제 전용: detail 이 켜지면 타석마다 기록한다. rotate 는 공수 교대 방식(all 전원 타격제, out3 3아웃제).
    // maxAdv: 한 번 쳐서 갈 수 있는 최대 루 수(홈런 제외). 2면 3루타 단추가 없어진다.
    detail: false, rotate: 'all', maxAdv: 3,
  };
}

export const sportName = (grade) => (grade.sport === 'custom' ? grade.sportName || '종목' : (SPORTS[grade.sport] || SPORTS.custom).name);
export const isTimed = (grade) => grade.format in TIMED_NAMES;
export const hasClock = (grade) => isTimed(grade) || grade.format === 'dodge';
export const usesPicker = (grade) => isTimed(grade) || grade.format === 'innings';
export const partMs = (grade) => Math.max(1, Number(grade.minutes) || 1) * 60000;
// 같은 득점이 겹쳤는지 물어보는 시간(밀리초). 득점이 빠른 종목은 짧게.
export const dupWindow = (grade) => (grade.sport === 'basket' || grade.sport === 'netball' ? 5000 : 10000);

export function partCount(grade) {
  if (isTimed(grade)) return TIMED_NAMES[grade.format].length;
  if (grade.format === 'innings') return Math.max(1, Number(grade.innings) || 1);
  return Math.max(1, Number(grade.sets) || 1);
}

export function partName(grade, i, half) {
  if (isTimed(grade)) return TIMED_NAMES[grade.format][i] || '';
  if (grade.format === 'innings') return `${i + 1}회 ${half ? '말' : '초'}`;
  return `${i + 1}세트`;
}

export function newGame(gid, no, a, b) {
  return { gid, no, a, b, status: 'ready', cur: 0, half: 0, sa: 0, sb: 0 };
}

// 저장소가 빈 배열·빈 객체를 지우기 때문에, 읽은 경기에 빠진 칸을 채운다.
export function norm(g, grade) {
  const n = partCount(grade);
  const pad = (arr) => Array.from({ length: n }, (_, i) => Number((arr || [])[i]) || 0);
  g.pa = pad(g.pa); g.pb = pad(g.pb);
  g.wins = Array.isArray(g.wins) ? g.wins : Object.values(g.wins || {});
  g.why = Array.isArray(g.why) ? g.why : Object.values(g.why || {});
  g.used = { a: 0, b: 0, ...(g.used || {}) };
  g.lineup = { a: {}, b: {}, ...(g.lineup || {}) };
  g.st = { a: {}, b: {}, ...(g.st || {}) };
  g.remain = { a: 0, b: 0, ...(g.remain || {}) };
  g.r0 = { a: 0, b: 0, ...(g.r0 || {}) };
  g.cur = g.cur || 0; g.half = g.half || 0; g.sa = g.sa || 0; g.sb = g.sb || 0;
  if (grade.format === 'innings') {
    g.bases = { b1: '', b2: '', b3: '', ...(g.bases || {}) };
    g.outs = g.outs || 0; g.hb = g.hb || 0;
    g.bat = { a: 0, b: 0, ...(g.bat || {}) };
    const list = (v) => (Array.isArray(v) ? v : Object.values(v || {}));
    g.order = { a: list((g.order || {}).a), b: list((g.order || {}).b) };
  }
  return g;
}

export function clockLeft(g, now) {
  const c = g.clock;
  if (!c) return 0;
  return Math.max(0, c.run ? c.left - (now - c.at) : c.left);
}

export function fmtClock(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function tag(g, grade, now) {
  if (g.status === 'ready') return '경기 전';
  if (isTimed(grade)) {
    const total = partMs(grade);
    const min = Math.min(Math.max(1, Number(grade.minutes) || 1), Math.floor((total - clockLeft(g, now)) / 60000) + 1);
    return `${partName(grade, g.cur)} ${min}분`;
  }
  return partName(grade, g.cur, g.half);
}

const sum = (arr) => arr.reduce((x, y) => x + y, 0);

function recount(g, grade) {
  if (isTimed(grade) || grade.format === 'innings') { g.sa = sum(g.pa); g.sb = sum(g.pb); }
  else { g.sa = g.wins.filter((w) => w === 'a').length; g.sb = g.wins.filter((w) => w === 'b').length; }
}

const mk = (g, grade, ctx, type, text, extra) => ({ at: ctx.now, tag: tag(g, grade, ctx.now), type, text, by: ctx.uid || '', ...extra });
const live = (g) => { if (g.status !== 'live') throw new Error('진행 중인 경기가 아닙니다.'); };
const playerLabel = (ctx, team, pid) => {
  const p = ((ctx.rosters || {})[team] || {})[pid];
  return p ? `${p.no} ${p.name}`.trim() : '';
};

// ctx: { now, uid, names: {a,b}, rosters: {a: {pid: {no,name,bench}}, b: {...}} }
// 아래 함수는 모두 경기(g)를 그 자리에서 고치고, 남길 기록 목록을 돌려준다.

export function start(g, grade, ctx) {
  norm(g, grade);
  if (g.status !== 'ready') throw new Error('이미 시작한 경기입니다.');
  // 이닝제에서 학생이 미리 낸 타순(ctx.orders)이 있으면, 그 선수들이 그 순서대로 선발이 된다.
  const sent = { a: [], b: [] };
  for (const side of ['a', 'b']) {
    const roster = (ctx.rosters || {})[side] || {};
    const list = ((ctx.orders || {})[side] || {}).list;
    if (grade.format === 'innings') sent[side] = [...new Set(Array.isArray(list) ? list : Object.values(list || {}))].filter((pid) => roster[pid]);
    for (const pid of Object.keys(roster)) {
      const on = sent[side].length ? sent[side].includes(pid) : !roster[pid].bench;
      g.lineup[side][pid] = on ? 'on' : 'bench';
      if (on) g.st[side][pid] = true;
    }
    const onCount = Object.values(g.lineup[side]).filter((s) => s === 'on').length;
    g.r0[side] = onCount || Number(grade.starters) || 1;
    g.remain[side] = g.r0[side];
  }
  g.status = 'live'; g.startedAt = ctx.now; g.cur = 0; g.half = 0;
  if (grade.format === 'innings') {
    // 타순은 미리 받은 타순, 없으면 선발 선수의 번호 순. 두 팀 모두 선발이 있어야 타석 기록을 쓸 수 있다.
    for (const side of ['a', 'b']) {
      const roster = (ctx.rosters || {})[side] || {};
      g.order[side] = sent[side].length ? sent[side] : Object.keys(g.lineup[side]).filter((pid) => g.lineup[side][pid] === 'on').sort((x, y) => (Number(roster[x].no) || 0) - (Number(roster[y].no) || 0) || String(roster[x].name).localeCompare(String(roster[y].name), 'ko'));
    }
    g.detail = !!grade.detail && g.order.a.length > 0 && g.order.b.length > 0;
  }
  if (hasClock(grade)) g.clock = { run: true, left: partMs(grade), at: ctx.now };
  return [mk(g, grade, ctx, 'info', '경기 시작')];
}

export function toggleClock(g, grade, ctx) {
  norm(g, grade); live(g);
  if (!g.clock) return [];
  if (g.clock.run) g.clock = { run: false, left: clockLeft(g, ctx.now), at: ctx.now };
  else if (g.clock.left > 0) g.clock = { run: true, left: g.clock.left, at: ctx.now };
  return [];
}

// 시계가 0이 됐을 때 어느 기기에서든 부른다. 여러 번 불러도 한 번만 적용된다.
export function timeUp(g, grade, ctx) {
  norm(g, grade);
  if (g.status !== 'live' || !g.clock || !g.clock.run || clockLeft(g, ctx.now) > 0) return [];
  g.clock = { run: false, left: 0, at: ctx.now };
  if (grade.format !== 'dodge') return [mk(g, grade, ctx, 'info', `${partName(grade, g.cur)} 시간 종료`)];
  if (g.remain.a === g.remain.b) { g.tie = true; return [mk(g, grade, ctx, 'info', `시간 종료 · 남은 인원 ${g.remain.a} : ${g.remain.b} 동점`)]; }
  return endDodgeSet(g, grade, ctx, g.remain.a > g.remain.b ? 'a' : 'b', '시간 종료');
}

// 이닝제에서 지금 공격하는 팀. 초에는 먼저 적은 팀(a), 말에는 나중 팀(b).
export const attacker = (g) => (g.half ? 'b' : 'a');

// 경기 일정 글씨. 날짜와 교시(또는 시간)는 모두 선택이다. 예: "11월 20일(금) 3교시", "11월 20일(금) 오전 9시 30분"
export function whenText(g) {
  const out = [];
  if (g.date) {
    const [y, m, d] = String(g.date).split('-').map(Number);
    const day = new Date(y, m - 1, d);
    if (!Number.isNaN(day.getTime())) out.push(`${m}월 ${d}일(${'일월화수목금토'[day.getDay()]})`);
  }
  if (g.time) {
    const [h, min] = String(g.time).split(':').map(Number);
    out.push(`${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${min ? ` ${min}분` : ''}`);
  }
  else if (g.period) out.push(String(g.period));
  return out.join(' ');
}

export function score(g, grade, ctx, team, pts, pid) {
  norm(g, grade); live(g);
  if (grade.format === 'innings' && pts > 0 && team !== attacker(g)) throw new Error('지금은 수비 팀이라 점수를 올릴 수 없습니다.');
  const arr = team === 'a' ? g.pa : g.pb;
  arr[g.cur] = Math.max(0, arr[g.cur] + pts);
  recount(g, grade);
  if (pts > 0) g.last = { team, at: ctx.now, by: ctx.uid || '' };
  if (!usesPicker(grade)) return [];
  if (pts < 0) return [mk(g, grade, ctx, 'fix', `${ctx.names[team]} 점수 ${pts} (정정)`, { team })];
  const who = (pid && playerLabel(ctx, team, pid)) || '선수 기록 없음';
  return [mk(g, grade, ctx, 'goal', `${ctx.names[team]} 득점${pts > 1 ? ` +${pts}` : ''} · ${who}`, { team, pid: pid || '', pts, part: g.cur })];
}

function finish(g, grade, ctx, logs) {
  if (g.clock) g.clock = { run: false, left: clockLeft(g, ctx.now), at: ctx.now };
  g.status = 'done'; g.endedAt = ctx.now;
  logs.push({ at: ctx.now, tag: '종료', type: 'info', text: `경기 종료 ${g.sa} : ${g.sb}`, by: ctx.uid || '' });
  return logs;
}

// 전반 끝내기, 세트 끝내기, 공수 교대처럼 다음 구간으로 넘어간다. 마지막 구간이면 경기를 끝낸다.
export function nextPart(g, grade, ctx) {
  norm(g, grade); live(g);
  const n = partCount(grade);
  if (isTimed(grade)) {
    const logs = [mk(g, grade, ctx, 'info', `${partName(grade, g.cur)} 종료 ${g.sa} : ${g.sb}`)];
    if (g.cur >= n - 1) return finish(g, grade, ctx, logs);
    g.cur += 1; g.clock = { run: false, left: partMs(grade), at: ctx.now };
    return logs;
  }
  if (grade.format === 'innings') {
    const logs = [mk(g, grade, ctx, 'info', `${partName(grade, g.cur, g.half)} 끝 · 공수 교대`)];
    g.bases = { b1: '', b2: '', b3: '' }; g.outs = 0; g.hb = 0; g.halfDone = false; g.lb = ''; delete g.undo;
    if (!g.half) { g.half = 1; return logs; }
    if (g.cur >= n - 1) return finish(g, grade, ctx, logs);
    g.cur += 1; g.half = 0;
    return logs;
  }
  if (grade.format === 'sets') {
    const a = g.pa[g.cur], b = g.pb[g.cur];
    if (a === b) throw new Error('세트 점수가 같습니다. 점수를 확인해 주세요.');
    const w = a > b ? 'a' : 'b';
    const logs = [mk(g, grade, ctx, 'info', `${g.cur + 1}세트 ${ctx.names[w]} 승 ${a} : ${b}`)];
    g.wins[g.cur] = w; recount(g, grade);
    const need = Math.floor(n / 2) + 1;
    if (g.sa >= need || g.sb >= need || g.cur >= n - 1) return finish(g, grade, ctx, logs);
    g.cur += 1;
    return logs;
  }
  // 피구: 선생님이 직접 세트를 끝낼 때
  if (g.remain.a === g.remain.b) {
    if (g.clock) g.clock = { run: false, left: clockLeft(g, ctx.now), at: ctx.now };
    g.tie = true;
    return [mk(g, grade, ctx, 'info', `남은 인원 ${g.remain.a} : ${g.remain.b} 동점`)];
  }
  return endDodgeSet(g, grade, ctx, g.remain.a > g.remain.b ? 'a' : 'b', '선생님이 끝냄');
}

function endDodgeSet(g, grade, ctx, winner, reason) {
  const n = partCount(grade);
  const text = winner === 'd' ? `${g.cur + 1}세트 무승부 (${reason})` : `${g.cur + 1}세트 ${ctx.names[winner]} 승 (${reason})`;
  const logs = [mk(g, grade, ctx, 'info', text)];
  g.wins[g.cur] = winner; g.why[g.cur] = reason; g.tie = false; g.ext = false;
  recount(g, grade);
  const need = Math.floor(n / 2) + 1;
  if (g.sa >= need || g.sb >= need || g.cur >= n - 1) return finish(g, grade, ctx, logs);
  g.cur += 1; g.remain = { ...g.r0 };
  g.clock = { run: false, left: partMs(grade), at: ctx.now };
  return logs;
}

// 피구 아웃(-1)과 되살아남(+1). 0명이 되면 세트가 바로 끝난다. 연장 중에는 첫 아웃으로 끝난다.
export function dodgeOut(g, grade, ctx, team, delta) {
  norm(g, grade); live(g);
  if (g.tie) throw new Error('동점입니다. 무승부나 연장을 먼저 골라 주세요.');
  const other = team === 'a' ? 'b' : 'a';
  g.remain[team] = Math.max(0, g.remain[team] + delta);
  if (delta < 0 && g.ext) return endDodgeSet(g, grade, ctx, other, '연장');
  if (g.remain[team] === 0) {
    const left = clockLeft(g, ctx.now);
    return endDodgeSet(g, grade, ctx, other, left > 0 ? `전원 아웃 · ${fmtClock(left)} 남음` : '전원 아웃');
  }
  return [];
}

// 시간이 끝났는데 남은 인원이 같을 때: 무승부(draw) 또는 연장(ext)
export function dodgeTie(g, grade, ctx, choice) {
  norm(g, grade); live(g);
  if (!g.tie) return [];
  if (choice === 'ext') { g.tie = false; g.ext = true; return [mk(g, grade, ctx, 'info', `${g.cur + 1}세트 연장 · 먼저 아웃시키는 팀 승`)]; }
  return endDodgeSet(g, grade, ctx, 'd', '시간 종료 · 동점');
}

export function cardsLeft(g, grade, team) {
  const cards = Number(grade.cards) || 0;
  return cards ? Math.max(0, cards - ((g.used || {})[team] || 0)) : Infinity;
}

export function sub(g, grade, ctx, team, outPid, inPid) {
  norm(g, grade); live(g);
  const lu = g.lineup[team];
  if (lu[outPid] !== 'on') throw new Error('나가는 선수는 지금 뛰는 선수여야 합니다.');
  if (lu[inPid] !== 'bench') throw new Error('들어가는 선수는 대기 중인 선수여야 합니다.');
  if (cardsLeft(g, grade, team) <= 0) throw new Error('교체 카드를 모두 썼습니다.');
  lu[outPid] = grade.reentry ? 'bench' : 'out';
  lu[inPid] = 'on';
  g.used[team] += 1;
  if (grade.format === 'innings') {
    g.order[team] = g.order[team].map((pid) => (pid === outPid ? inPid : pid));
    for (const k of ['b1', 'b2', 'b3']) if (g.bases[k] === outPid) g.bases[k] = inPid;
  }
  const text = `${ctx.names[team]} 교체 · ${playerLabel(ctx, team, outPid)} 나감 → ${playerLabel(ctx, team, inPid)} 들어감`;
  return [mk(g, grade, ctx, 'sub', text, { team, pout: outPid, pin: inPid })];
}

// ---------- 이닝제 타석 기록 ----------
export const isDetail = (g, grade) => grade.format === 'innings' && !!g.detail;
const HIT = { h1: 1, h2: 2, h3: 3, hr: 4 };
export const RESULT_NAMES = { h1: '1루타', h2: '2루타', h3: '3루타', hr: '홈런', go: '땅볼 아웃', fo: '플라이 아웃', dp: '병살', e: '출루' };
// e(출루)는 안타는 아니지만 타자가 1루에 나간 경우다. 수업용이라 실책이라는 말은 기록에 남기지 않는다.
export const maxAdv = (grade) => Math.min(3, Math.max(1, Number(grade.maxAdv) || 3));
export const batterOf = (g) => { const side = attacker(g), order = (g.order || {})[side] || []; return order.length ? order[g.bat[side] % order.length] : ''; };
const snap = (g) => JSON.stringify({ pa: g.pa, pb: g.pb, sa: g.sa, sb: g.sb, bases: g.bases, outs: g.outs, hb: g.hb, bat: g.bat, lb: g.lb || '', halfDone: !!g.halfDone });
const keepUndo = (g, ctx) => { g.undo = { op: ctx.op || '', cur: g.cur, half: g.half, s: snap(g) }; };
const detailOnly = (g, grade) => { if (!isDetail(g, grade)) throw new Error('타석 기록을 쓰지 않는 경기입니다.'); };
// 공격이 끝났는지: 3아웃제는 3아웃, 전원 타격제는 타순이 한 바퀴 돌았을 때. 끝나도 자동으로 넘기지 않고 선생님이 "공수 교대"를 누른다.
function checkHalf(g, grade) {
  g.halfDone = grade.rotate === 'out3' ? g.outs >= 3 : g.hb >= g.order[attacker(g)].length;
}

// 타석 결과. 안타는 타자가 간 만큼 주자도 같이 가고, 홈에 들어오면 점수·득점·타점이 올라간다.
export function bat(g, grade, ctx, res) {
  norm(g, grade); live(g); detailOnly(g, grade);
  if (g.halfDone) throw new Error('이번 공격이 끝났습니다. "공수 교대"를 눌러 주세요.');
  if (!(res in RESULT_NAMES)) throw new Error('알 수 없는 타석 결과입니다.');
  if (res in HIT && res !== 'hr' && HIT[res] > maxAdv(grade)) throw new Error(`이 학년은 홈런이 아니면 ${maxAdv(grade)}루까지만 갈 수 있습니다.`);
  const side = attacker(g), pid = batterOf(g), arr = side === 'a' ? g.pa : g.pb;
  const firstRunner = [1, 2, 3].find((b) => g.bases[`b${b}`]);
  if (res === 'dp' && !firstRunner) throw new Error('주자가 없으면 병살이 될 수 없습니다.');
  const entry = mk(g, grade, ctx, 'pa', '', { team: side, pid, res, op: ctx.op || '' });
  keepUndo(g, ctx);
  const scored = [];
  const n = HIT[res] || (res === 'e' ? 1 : 0);
  if (n) {
    for (let b = 3; b >= 1; b--) {
      const r = g.bases[`b${b}`]; if (!r) continue;
      g.bases[`b${b}`] = '';
      if (b + n >= 4) scored.push(r); else g.bases[`b${b + n}`] = r;
    }
    if (n >= 4) scored.push(pid); else g.bases[`b${n}`] = pid;
  } else if (res === 'dp') { g.bases[`b${firstRunner}`] = ''; g.outs += 2; }
  else g.outs += 1;
  arr[g.cur] += scored.length; recount(g, grade);
  g.bat[side] = (g.bat[side] + 1) % g.order[side].length; g.hb += 1; g.lb = pid;
  checkHalf(g, grade);
  entry.rbi = res === 'e' ? 0 : scored.length; entry.scored = scored;
  entry.text = `${ctx.names[side]} ${playerLabel(ctx, side, pid)} · ${RESULT_NAMES[res]}${scored.length ? ` · ${scored.length}득점 (${scored.map((r) => playerLabel(ctx, side, r)).join(', ')})` : ''}`;
  return [entry];
}

// 주자를 손으로 고친다. op: adv(한 루 더, 3루면 홈인), home(홈인), out(주루 아웃)
export function runner(g, grade, ctx, base, op) {
  norm(g, grade); live(g); detailOnly(g, grade);
  const key = `b${base}`, r = g.bases[key];
  if (!r) throw new Error('그 루에 주자가 없습니다.');
  const side = attacker(g), arr = side === 'a' ? g.pa : g.pb, who = playerLabel(ctx, side, r);
  const entry = mk(g, grade, ctx, 'run', '', { team: side, pid: r, op: ctx.op || '' });
  if (op === 'adv' && base < 3) {
    if (g.bases[`b${base + 1}`]) throw new Error('앞 루에 주자가 있습니다. 앞 주자부터 옮겨 주세요.');
    keepUndo(g, ctx);
    g.bases[`b${base + 1}`] = r; g.bases[key] = '';
    entry.text = `${ctx.names[side]} ${who} · 진루 (${base}루 → ${base + 1}루)`;
  } else if (op === 'adv' || op === 'home') {
    keepUndo(g, ctx);
    g.bases[key] = ''; arr[g.cur] += 1; recount(g, grade);
    entry.scored = [r]; entry.rbiTo = g.lb && g.lb !== r ? g.lb : '';
    entry.text = `${ctx.names[side]} ${who} · 홈인`;
  } else if (op === 'out') {
    keepUndo(g, ctx);
    g.bases[key] = ''; g.outs += 1;
    entry.text = `${ctx.names[side]} ${who} · 주루 아웃 (${base}루)`;
    if (grade.rotate === 'out3') checkHalf(g, grade);
  } else throw new Error('알 수 없는 주자 처리입니다.');
  return [entry];
}

// 방금 한 타석·주자 기록 하나를 되돌린다. 돌려준 op 가 붙은 기록은 화면 쪽에서 취소 표시한다.
export function undo(g, grade) {
  norm(g, grade); live(g); detailOnly(g, grade);
  const u = g.undo;
  if (!u || u.cur !== g.cur || u.half !== g.half) throw new Error('되돌릴 기록이 없습니다.');
  Object.assign(g, JSON.parse(u.s));
  delete g.undo;
  return [];
}

export function endGame(g, grade, ctx) {
  norm(g, grade); live(g);
  return finish(g, grade, ctx, []);
}

// 끝난 경기 기준 순위표. 승 3점, 무 1점.
export function standings(teams, games) {
  const rows = {};
  for (const [id, t] of Object.entries(teams)) rows[id] = { id, name: t.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  for (const g of games) {
    if (g.status !== 'done' || !rows[g.a] || !rows[g.b]) continue;
    const A = rows[g.a], B = rows[g.b], sa = g.sa || 0, sb = g.sb || 0;
    A.p++; B.p++; A.gf += sa; A.ga += sb; B.gf += sb; B.ga += sa;
    if (sa > sb) { A.w++; B.l++; A.pts += 3; } else if (sa < sb) { B.w++; A.l++; B.pts += 3; } else { A.d++; B.d++; A.pts++; B.pts++; }
  }
  const list = Object.values(rows).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.name.localeCompare(y.name, 'ko'));
  list.forEach((r, i) => { const prev = list[i - 1]; r.rank = prev && prev.pts === r.pts && prev.gf - prev.ga === r.gf - r.ga && prev.gf === r.gf ? prev.rank : i + 1; });
  return list;
}

// 선수별 기록. games: [{id, ...경기}], logs: {경기id: {기록id: 기록}}
export function records(teams, games, logs) {
  const out = {};
  const row = (teamId, pid) => {
    const key = `${teamId}/${pid}`;
    const t = teams[teamId] || {}; const p = (t.players || {})[pid];
    if (!p) return null;
    return (out[key] = out[key] || { key, teamId, team: t.name, no: p.no, name: p.name, games: 0, starts: 0, goals: 0, subIn: 0, ab: 0, h: 0, h1: 0, h2: 0, h3: 0, hr: 0, rbi: 0, detail: [] });
  };
  for (const g of games) {
    if (g.status === 'ready') continue;
    const glogs = Object.values((logs || {})[g.id] || {}).filter((l) => !l.x);
    for (const side of ['a', 'b']) {
      const teamId = g[side]; const other = (teams[g[side === 'a' ? 'b' : 'a']] || {}).name || '';
      const st = (g.st || {})[side] || {};
      const cameIn = new Set(glogs.filter((l) => l.type === 'sub' && l.team === side).map((l) => l.pin));
      const pids = new Set([...Object.keys(st), ...cameIn]);
      for (const pid of pids) {
        const r = row(teamId, pid); if (!r) continue;
        const mine = glogs.filter((l) => l.team === side);
        const pas = mine.filter((l) => l.type === 'pa' && l.pid === pid);
        const hits = pas.filter((l) => l.res in HIT);
        const runs = mine.filter((l) => (l.type === 'pa' || l.type === 'run') && Object.values(l.scored || {}).includes(pid)).length;
        const rbi = sum(pas.map((l) => l.rbi || 0)) + mine.filter((l) => l.type === 'run' && l.rbiTo === pid).length;
        const goals = sum(mine.filter((l) => l.type === 'goal' && l.pid === pid).map((l) => l.pts || 1)) + runs;
        r.games++; if (st[pid]) r.starts++; else r.subIn++;
        r.goals += goals; r.ab += pas.length; r.h += hits.length; r.rbi += rbi;
        for (const l of hits) r[l.res] += 1;
        const bits = [st[pid] ? '선발' : '교체 투입'];
        if (pas.length) bits.push(`${pas.length}타석 ${hits.length}안타${rbi ? ` ${rbi}타점` : ''}`);
        if (goals) bits.push(`${goals}${pas.length || runs ? '득점' : '점'}`);
        r.detail.push(`${g.no}경기 ${other}전 · ${bits.join(', ')}`);
      }
    }
  }
  return Object.values(out);
}
