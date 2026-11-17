// 대회 편성: 풀리그 / 토너먼트 / 조별 예선 뒤 결선 / 원형 예선 뒤 결선.
// 추첨 순서(order)와 설정(plan)으로 경기 목록을 짜고, 예선·앞 경기가 끝나면 결선 자리에 팀을 채운다.
// 화면도 저장소도 모르는 순수 계산만 둔다.
import { standings } from './logic.js';

export const MODES = { league: '풀리그', cup: '토너먼트', groups: '조별 예선 + 결선', ring: '원형 예선 + 결선', swiss: '스위스 + 결선' };
export const MODE_NOTES = {
  league: '모든 팀이 한 번씩 만납니다. 순위표로 순위를 가립니다.',
  cup: '지면 탈락합니다. 팀 수가 4, 8처럼 딱 맞지 않으면 부전승이 생깁니다.',
  groups: '조를 나눠 조 안에서 한 번씩 만난 뒤, 조별 상위 팀이 결선 토너먼트를 합니다.',
  swiss: '8팀 또는 16팀일 때 씁니다. 승패가 같은 팀끼리 추첨으로 만나고, 정해진 승수를 먼저 채우면 결선에 오르고 같은 수만큼 지면 탈락합니다. 다음 라운드는 앞 라운드가 끝나면 자동으로 짜집니다.',
  ring: '팀이 적을 때 좋습니다. 원으로 둘러앉아 양옆 팀과만 한 번씩(팀마다 2경기) 하고, 상위 팀이 결선을 합니다.',
};
const GROUP_NAMES = 'ABCDEFGH';
export const groupName = (i) => `${GROUP_NAMES[i] || i + 1}조`;
export const roundName = (teams) => (teams === 2 ? '결승' : teams === 4 ? '준결승' : `${teams}강`);
// 아직 정해지지 않은 팀 자리는 "?글"로 적는다. 화면에는 ? 뒤의 글이 그대로 팀 이름처럼 보인다.
export const isOpen = (id) => typeof id === 'string' && id.startsWith('?');
export const openName = (id) => id.slice(1);
// 스위스: 8팀은 2승 진출·2패 탈락, 16팀은 3승 진출·3패 탈락. 그 밖의 팀 수는 승패 묶음이 홀수가 되어 짤 수 없다.
export const swissWins = (n) => (n === 16 ? 3 : n === 8 ? 2 : 0);
export const winnerOf = (g) => (g.status !== 'done' ? '' : g.sa > g.sb ? 'a' : g.sb > g.sa ? 'b' : g.win === 'a' || g.win === 'b' ? g.win : '');

export function shuffle(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const pow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || lo));

// 설정을 팀 수에 맞게 다듬는다.
export function normPlan(plan, n) {
  const p = { mode: 'league', groups: 2, adv: 2, third: false, ...(plan || {}) };
  if (!MODES[p.mode]) p.mode = 'league';
  p.groups = clamp(p.groups, 2, Math.max(2, Math.min(8, Math.floor(n / 2))));
  if (p.mode === 'groups') p.adv = clamp(p.adv, 1, Math.max(1, Math.floor(n / p.groups) - 0));
  else if (p.mode === 'ring') p.adv = clamp(p.adv, 2, Math.max(2, n - 1));
  p.third = !!p.third;
  p.show = p.show === 'pop' ? 'pop' : 'balls';   // 전광판 추첨 연출: 공 뽑기(기본) / 이름만
  return p;
}

// 조 나누기: 추첨 순서대로 한 명씩 돌아가며 넣는다(1번→A조, 2번→B조 …).
export function groupsOf(plan, order) {
  if (plan.mode !== 'groups') return [order];
  const gs = Array.from({ length: plan.groups }, () => []);
  order.forEach((id, i) => gs[i % plan.groups].push(id));
  return gs;
}

// 한 조 안에서 모두 한 번씩 만나는 순서(라운드별). 팀이 홀수면 한 팀씩 쉰다.
function roundRobin(ids) {
  const list = ids.length % 2 ? [...ids, null] : [...ids];
  const n = list.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) { const a = list[i], b = list[n - 1 - i]; if (a && b) pairs.push(r % 2 && i === 0 ? [b, a] : [a, b]); }
    rounds.push(pairs);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

// 원형 예선: 옆자리 팀끼리만. 한 팀이 연달아 뛰지 않게 하나 건너씩 먼저 짠다.
function ringPairs(ids) {
  const n = ids.length;
  if (n < 3) return n === 2 ? [[[ids[0], ids[1]]]] : [];
  const edges = ids.map((id, i) => [id, ids[(i + 1) % n]]);
  const even = edges.filter((_, i) => i % 2 === 0), odd = edges.filter((_, i) => i % 2 === 1);
  if (n % 2) { const last = even.pop(); return [even, odd, [last]]; }
  return [even, odd];
}

// 시드 순서대로 대진표 자리 번호를 만든다. 8강이면 [1,8,4,5,2,7,3,6].
function seedOrder(size) {
  let o = [1];
  while (o.length < size) { const n = o.length * 2; o = o.flatMap((s) => [s, n + 1 - s]); }
  return o;
}

// 결선에 오르는 자리 목록. 토너먼트는 추첨 순서의 팀, 조별·원형은 "A조 1위" 같은 자리.
function entrants(plan, order) {
  if (plan.mode === 'cup') return order.map((id) => ({ team: id }));
  if (plan.mode === 'ring') return Array.from({ length: plan.adv }, (_, i) => ({ grp: 0, rank: i + 1, text: `예선 ${i + 1}위` }));
  // 조 2위 이하는 줄을 돌려 가며, 첫 결선 경기에서 같은 조끼리 만나는 일이 가장 적은 배치를 고른다.
  const n = plan.groups, size = pow2(n * plan.adv), spots = seedOrder(size);
  const build = (shift) => {
    const out = [];
    for (let r = 1; r <= plan.adv; r++) out.push(...Array.from({ length: n }, (_, i) => { const g = r === 1 ? i : (i + shift * (r - 1)) % n; return { grp: g, rank: r, text: `${groupName(g)} ${r}위` }; }));
    return out;
  };
  const clashes = (list) => { let c = 0; for (let i = 0; i < size; i += 2) { const x = list[spots[i] - 1], y = list[spots[i + 1] - 1]; if (x && y && x.grp === y.grp) c++; } return c; };
  let best = build(0);
  for (let sft = 1; sft < n && clashes(best); sft++) { const cand = build(sft); if (clashes(cand) < clashes(best)) best = cand; }
  return best;
}

// 편성 요약: 예선·결선 경기 수와 설명.
export function planInfo(planIn, n) {
  const plan = normPlan(planIn, n);
  const sizes = plan.mode === 'groups' ? Array.from({ length: plan.groups }, (_, i) => Math.floor(n / plan.groups) + (i < n % plan.groups ? 1 : 0)) : [n];
  const W = swissWins(n);
  const prelim = plan.mode === 'swiss' ? (n === 16 ? 33 : n === 8 ? 10 : 0) : plan.mode === 'league' ? (n * (n - 1)) / 2 : plan.mode === 'groups' ? sizes.reduce((s, k) => s + (k * (k - 1)) / 2, 0) : plan.mode === 'ring' ? (n < 3 ? (n === 2 ? 1 : 0) : n) : 0;
  const ent = plan.mode === 'swiss' ? (W ? n / 2 : 0) : plan.mode === 'cup' ? n : plan.mode === 'groups' ? plan.groups * plan.adv : plan.mode === 'ring' ? plan.adv : 0;
  const third = plan.third && ent >= 4;
  const ko = ent ? ent - 1 + (third ? 1 : 0) : 0;
  const problems = [];
  if (n < 2) problems.push('팀이 두 팀 이상 있어야 합니다.');
  if (plan.mode === 'groups' && Math.min(...sizes) < 2) problems.push('조마다 두 팀 이상이 되게 조 개수를 줄여 주세요.');
  if (plan.mode === 'groups' && plan.adv > Math.min(...sizes)) problems.push('조별 진출 팀 수가 조의 팀 수보다 많습니다.');
  if (plan.mode === 'ring' && n < 3) problems.push('원형 예선은 세 팀 이상일 때 쓸 수 있습니다.');
  if (plan.mode === 'ring' && plan.adv >= n) problems.push('결선에 오르는 팀 수가 전체 팀 수보다 적어야 합니다.');
  if (plan.mode === 'swiss' && !W) problems.push('스위스 방식은 8팀(2승 진출 · 2패 탈락) 또는 16팀(3승 진출 · 3패 탈락)일 때 쓸 수 있습니다.');
  const size = ent ? pow2(ent) : 0;
  const bits = [];
  if (plan.mode === 'league') bits.push(`${n}팀 풀리그 ${prelim}경기`);
  if (plan.mode === 'groups') bits.push(`${plan.groups}개 조(${[...new Set(sizes)].sort((a, b) => a - b).join('~')}팀씩) 예선 ${prelim}경기`);
  if (plan.mode === 'ring') bits.push(`${n}팀 원형 예선 ${prelim}경기(팀마다 2경기)`);
  if (plan.mode === 'swiss') bits.push(`${n}팀 스위스 ${prelim}경기(${W}승 진출 · ${W}패 탈락)`);
  if (ent) bits.push(`${plan.mode === 'cup' ? `${n}팀` : `상위 ${ent}팀`} ${roundName(size)}부터 토너먼트 ${ko}경기${size > ent ? ` · 부전승 ${size - ent}팀` : ''}${third ? ' · 3·4위전 포함' : ''}`);
  return { plan, sizes, prelim, ent, ko, total: prelim + ko, size, third, problems, text: bits.join(' → ') };
}

// 경기 목록을 짠다. id() 는 새 경기 ID를 만드는 함수, firstNo 는 첫 경기 번호.
// 돌려주는 값: { 경기ID: 경기 } (경기에는 stage, grp, label, src 가 붙는다)
export function buildGames(planIn, order, gid, id, firstNo = 1, newGame) {
  const info = planInfo(planIn, order.length), plan = info.plan;
  if (info.problems.length) throw new Error(info.problems[0]);
  const out = {};
  let no = firstNo;
  const add = (a, b, extra) => { const key = id(); out[key] = { ...newGame(gid, no++, a, b), ...extra }; return key; };

  if (plan.mode !== 'cup' && plan.mode !== 'swiss') {
    const gs = groupsOf(plan, order);
    const rounds = gs.map((ids) => (plan.mode === 'ring' ? ringPairs(ids) : roundRobin(ids)));
    const most = Math.max(...rounds.map((r) => r.length));
    for (let r = 0; r < most; r++) gs.forEach((_, g) => (rounds[g][r] || []).forEach(([a, b]) => add(a, b, plan.mode === 'league' ? { stage: 'L', label: '리그' } : { stage: 'G', grp: g, label: plan.mode === 'ring' ? '예선' : groupName(g) })));
  }
  if (!info.ent) return out;

  if (plan.mode === 'swiss') {
    for (let i = 0; i < order.length; i += 2) add(order[i], order[i + 1], { stage: 'S', round: 1, label: '스위스 1R', rec: '0승 0패' });
    return out;
  }
  const ent = entrants(plan, order);
  knock(seedOrder(info.size).map((sd) => ent[sd - 1] || null), plan.third, add);
  return out;
}

// 결선 대진을 만든다. level 은 대진표 자리 순서대로 놓은 목록(빈 자리는 null → 부전승).
function knock(first, third, add) {
  let level = first;
  const ref = (e) => (e.team ? e.team : `?${e.text}`);
  const src = (e) => (e.team ? null : e.game ? { game: e.game, take: 'win' } : { grp: e.grp, rank: e.rank });
  let teams = level.length; const semis = [];
  while (level.length > 1) {
    const next = [], made = [];
    for (let i = 0; i < level.length; i += 2) {
      const [x, y] = [level[i], level[i + 1]];
      if (!x || !y) { next.push(x || y); continue; }
      made.push({ x, y, at: next.length }); next.push(null);
    }
    if (teams === 2 && third && semis.length === 2) {
      add(`?${semis[0].name} 패자`, `?${semis[1].name} 패자`, { stage: 'K', round: 3, label: '3·4위전', src: { a: { game: semis[0].key, take: 'lose' }, b: { game: semis[1].key, take: 'lose' } } });
    }
    made.forEach((m, k) => {
      const name = `${roundName(teams)}${made.length > 1 ? ` ${k + 1}` : ''}`;
      const sc = { a: src(m.x), b: src(m.y) };
      const key = add(ref(m.x), ref(m.y), { stage: 'K', round: teams, label: name, ...(sc.a || sc.b ? { src: { ...(sc.a ? { a: sc.a } : {}), ...(sc.b ? { b: sc.b } : {}) } } : {}) });
      next[m.at] = { game: key, text: `${name} 승자`, name };
      if (teams === 4) semis.push({ key, name });
    });
    level = next; teams /= 2;
  }
}

// 스위스 순위: 팀별 승패와 상태(in 결선 진출, out 탈락, play 진행 중).
export function swissTable(games, teams) {
  const S = games.filter((g) => g.stage === 'S');
  const ids = [...new Set(S.flatMap((g) => [g.a, g.b]))].filter((t) => teams[t]);
  const W = swissWins(ids.length);
  const rows = Object.fromEntries(ids.map((t) => [t, { id: t, name: teams[t].name, w: 0, l: 0, at: 0 }]));
  for (const g of [...S].sort((x, y) => x.round - y.round)) {
    const w = winnerOf(g); if (!w || !rows[g.a] || !rows[g.b]) continue;
    const win = rows[g[w]], lose = rows[g[w === 'a' ? 'b' : 'a']];
    win.w++; lose.l++;
    if (win.w === W) win.at = g.round;
    if (lose.l === W) lose.at = g.round;
  }
  const list = Object.values(rows);
  for (const r of list) r.state = W && r.w >= W ? 'in' : W && r.l >= W ? 'out' : 'play';
  const rank = { in: 0, play: 1, out: 2 };
  list.sort((x, y) => rank[x.state] - rank[y.state] || (x.state === 'out' ? y.w - x.w || y.at - x.at : x.l - y.l || y.w - x.w || x.at - y.at) || x.name.localeCompare(y.name, 'ko'));
  return { rows: list, W };
}

// 스위스의 다음 일을 짠다: 지금 라운드가 모두 끝났으면 다음 라운드, 스위스가 끝났으면 결선 대진.
// 결선은 무패로 올라온 두 팀을 양 끝에 두고(결승에서만 만남) 마지막 라운드에 올라온 팀 가운데 추첨한 팀과 붙이며, 남은 팀은 추첨으로 놓는다.
export function swissNext(games, teams, plan, gid, id, firstNo, newGame, rnd = Math.random) {
  const S = games.filter((g) => g.stage === 'S');
  if (!S.length || games.some((g) => g.stage === 'K')) return {};
  const round = Math.max(...S.map((g) => g.round));
  if (!S.filter((g) => g.round === round).every((g) => winnerOf(g))) return {};
  const { rows, W } = swissTable(games, teams);
  if (!W) return {};
  const out = {}; let no = firstNo;
  const add = (a, b, extra) => { const key = id(); out[key] = { ...newGame(gid, no++, a, b), ...extra }; return key; };
  const playing = rows.filter((r) => r.state === 'play');
  if (playing.length) {
    const met = new Set(S.map((g) => [g.a, g.b].sort().join('|')));
    const groups = {};
    for (const r of playing) (groups[`${r.w}-${r.l}`] = groups[`${r.w}-${r.l}`] || []).push(r);
    for (const key of Object.keys(groups).sort((x, y) => Number(y.split('-')[0]) - Number(x.split('-')[0]))) {
      // 이미 만난 팀끼리 다시 만나는 일이 가장 적은 추첨을 고른다.
      let best = null, bestBad = Infinity;
      for (let k = 0; k < 60 && bestBad; k++) {
        const o = shuffle(groups[key], rnd); let bad = 0;
        for (let i = 0; i + 1 < o.length; i += 2) if (met.has([o[i].id, o[i + 1].id].sort().join('|'))) bad++;
        if (bad < bestBad) { best = o; bestBad = bad; }
      }
      const [w, l] = key.split('-');
      for (let i = 0; i + 1 < best.length; i += 2) add(best[i].id, best[i + 1].id, { stage: 'S', round: round + 1, label: `스위스 ${round + 1}R`, rec: `${w}승 ${l}패` });
    }
    return out;
  }
  const Q = rows.filter((r) => r.state === 'in');
  const top = shuffle(Q.filter((r) => r.l === 0), rnd), low = shuffle(Q.filter((r) => r.l === W - 1), rnd);
  let level;
  if (top.length === 2 && low.length >= 2 && (Q.length === 4 || Q.length === 8)) {
    const rest = shuffle(Q.filter((r) => !top.includes(r) && r !== low[0] && r !== low[1]), rnd);
    level = [top[0], low[0], ...rest, low[1], top[1]];
  } else level = shuffle(Q, rnd);
  knock(level.map((r) => ({ team: r.id })), plan.third, add);
  return out;
}

// 예선 조(또는 원형 예선)의 순위. 조의 모든 경기가 끝났을 때만 done 이 참이다.
export function groupTable(games, teams, grp) {
  const mine = games.filter((g) => g.stage === 'G' && (g.grp || 0) === grp);
  const ids = [...new Set(mine.flatMap((g) => [g.a, g.b]))].filter((t) => teams[t]);
  const rows = standings(Object.fromEntries(ids.map((t) => [t, teams[t]])), mine);
  return { rows, done: mine.length > 0 && mine.every((g) => g.status === 'done'), games: mine };
}

// 결선 자리에 들어갈 팀을 다시 계산한다. 아직 시작하지 않은 결선 경기만 고친다.
// 돌려주는 값: { 경기ID: { a?: 팀, b?: 팀 } } (바뀌는 것만)
export function resolve(games, teams) {
  const byId = Object.fromEntries(games.map((g) => [g.id, g]));
  const tables = {};
  const want = (g, side) => {
    const s = (g.src || {})[side];
    if (!s) return g[side];
    if (s.game) {
      const from = byId[s.game];
      const label = from ? `?${from.label} ${s.take === 'lose' ? '패자' : '승자'}` : g[side];
      const w = from ? winnerOf(from) : '';
      if (!w) return label;
      const team = from[s.take === 'lose' ? (w === 'a' ? 'b' : 'a') : w];
      return isOpen(team) || !teams[team] ? label : team;
    }
    const t = tables[s.grp] || (tables[s.grp] = groupTable(games, teams, s.grp));
    const isRing = t.games.some((x) => x.label === '예선');
    const label = `?${isRing ? '예선' : groupName(s.grp)} ${s.rank}위`;
    return t.done && t.rows[s.rank - 1] ? t.rows[s.rank - 1].id : label;
  };
  const up = {};
  for (const g of games) {
    if (g.stage !== 'K' || g.status !== 'ready') continue;
    for (const side of ['a', 'b']) { const v = want(g, side); if (v !== g[side]) (up[g.id] = up[g.id] || {})[side] = v; }
  }
  return up;
}
