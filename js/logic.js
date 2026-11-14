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
  for (const side of ['a', 'b']) {
    const roster = (ctx.rosters || {})[side] || {};
    for (const pid of Object.keys(roster)) {
      const on = !roster[pid].bench;
      g.lineup[side][pid] = on ? 'on' : 'bench';
      if (on) g.st[side][pid] = true;
    }
    const onCount = Object.values(g.lineup[side]).filter((s) => s === 'on').length;
    g.r0[side] = onCount || Number(grade.starters) || 1;
    g.remain[side] = g.r0[side];
  }
  g.status = 'live'; g.startedAt = ctx.now; g.cur = 0; g.half = 0;
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

export function score(g, grade, ctx, team, pts, pid) {
  norm(g, grade); live(g);
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
  const text = `${ctx.names[team]} 교체 · ${playerLabel(ctx, team, outPid)} 나감 → ${playerLabel(ctx, team, inPid)} 들어감`;
  return [mk(g, grade, ctx, 'sub', text, { team, pout: outPid, pin: inPid })];
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
    return (out[key] = out[key] || { key, teamId, team: t.name, no: p.no, name: p.name, games: 0, starts: 0, goals: 0, subIn: 0, detail: [] });
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
        const goals = sum(glogs.filter((l) => l.type === 'goal' && l.team === side && l.pid === pid).map((l) => l.pts || 1));
        r.games++; if (st[pid]) r.starts++; else r.subIn++;
        r.goals += goals;
        const bits = [st[pid] ? '선발' : '교체 투입']; if (goals) bits.push(`${goals}점`);
        r.detail.push(`${g.no}경기 ${other}전 · ${bits.join(', ')}`);
      }
    }
  }
  return Object.values(out);
}
