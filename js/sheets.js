// 휘슬! 종목별 기록지. 화면과 떨어져 있어서 node 로 바로 시험할 수 있다.
// 경기 중에는 큰 칸에 正자·빗금으로 세고, 끝난 뒤 칸 오른쪽 아래 작은 네모에 합계 숫자를 적는다.
// 칸 종류: tally 세는 칸(합계 네모) · nu 숫자만 · check 구간별 출전 · write 구간별 글 · boxes:n 네모 n개 · text 글
import * as L from './logic.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const LEVELS = [['e', '초등'], ['s', '중 · 고']];
export const levelOf = (meta) => ((meta || {}).level === 's' ? 's' : 'e');
export const levelName = (lv) => (lv === 's' ? '중 · 고' : '초등');

// 종목 → 기록지 종류. 야구·티볼(이닝제)은 앱의 타석 기록을 쓰므로 기록지가 없다.
export function sheetKind(gr) {
  if (!gr || gr.format === 'innings') return '';
  if (gr.format === 'dodge') return 'dodge';
  if (gr.sport === 'badminton' || gr.sport === 'tabletennis') return 'racket';
  if (gr.sport === 'futsal' || gr.sport === 'soccer') return 'soccer';
  if (gr.sport === 'basket' || gr.sport === 'netball' || gr.sport === 'volley') return gr.sport;
  return 'free';
}

// [머리글, 폭(mm), 종류, 기록 열쇠]
const DEFS = {
  basket: {
    e: { cols: [['출전', 24, 'check'], ['넣은 점수', 34, 'tally', 'pts'], ['도움', 26, 'tally', 'as'], ['리바운드', 26, 'tally', 'reb'], ['파울', 26, 'boxes:5']],
      team: [['작전 시간', 'boxes:4']], notes: '넣은 점수는 넣은 만큼 점수로 셉니다(2점 슛이면 빗금 두 개). 파울은 할 때마다 네모를 하나씩 칠합니다(5개면 퇴장).' },
    s: { cols: [['출전', 20, 'check'], ['자유투\n성공', 15, 'tally', 'ft'], ['2점\n성공', 17, 'tally', 'p2'], ['3점\n성공', 15, 'tally', 'p3'], ['득점\n합계', 12, 'nu'], ['리바운드', 17, 'tally', 'reb'], ['어시스트', 15, 'tally', 'as'], ['스틸', 13, 'tally', 'stl'], ['블록', 12, 'tally', 'blk'], ['파울', 22, 'boxes:5']],
      team: [['팀 파울', 'partsboxes5'], ['작전 시간', 'boxes:4']], notes: '득점 합계 = 자유투×1 + 2점×2 + 3점×3. 파울은 할 때마다 네모를 하나씩 칠합니다(5개면 퇴장).' },
  },
  soccer: {
    e: { cols: [['출전', 18, 'check'], ['득점', 28, 'tally', 'goals'], ['도움', 28, 'tally', 'as'], ['막음\n(골키퍼)', 26, 'tally', 'sv'], ['경고', 14, 'boxes:2'], ['퇴장', 12, 'boxes:1'], ['비고', 28, 'text']],
      team: [], goals: true, notes: '경고는 받을 때마다 네모를 하나씩 칠합니다(2개면 퇴장). 아래 "득점 기록"은 적을 수 있을 때만 적습니다.' },
    s: { cols: [['출전', 14, 'check'], ['득점', 15, 'tally', 'goals'], ['도움', 15, 'tally', 'as'], ['슈팅', 19, 'tally', 'sh'], ['유효\n슈팅', 17, 'tally', 'sot'], ['선방\n(골키퍼)', 17, 'tally', 'sv'], ['파울', 17, 'tally', 'pf'], ['경고', 12, 'boxes:2'], ['퇴장', 10, 'boxes:1'], ['비고', 22, 'text']],
      team: [['코너킥', 'tallybox'], ['작전 시간', 'boxes:2']], goals: true, notes: '경고는 받을 때마다 네모를 하나씩 칠합니다(2개면 퇴장). 아래 "득점 기록"에는 시간, 넣은 선수, 도운 선수 번호를 적습니다.' },
  },
  netball: {
    e: { cols: [['자리 (구간별)\nGS GA WA C WD GD GK', 36, 'write'], ['슛 성공', 30, 'tally', 'goals'], ['도움', 28, 'tally', 'as'], ['가로채기', 28, 'tally', 'int'], ['비고', 26, 'text']],
      team: [], notes: '자리 칸에는 구간마다 선 자리를 적습니다. 안 뛴 구간은 비워 둡니다.' },
    s: { cols: [['자리 (구간별)\nGS GA WA C WD GD GK', 34, 'write'], ['슛\n성공', 17, 'tally', 'goals'], ['슛\n시도', 17, 'tally', 'att'], ['도움\n(피드)', 17, 'tally', 'as'], ['가로채기', 17, 'tally', 'int'], ['리바운드', 17, 'tally', 'reb'], ['반칙', 17, 'tally', 'pf'], ['비고', 22, 'text']],
      team: [['센터 패스 (먼저 한 팀에 ○)', 'text'], ['작전 시간', 'boxes:2']], notes: '자리 칸에는 구간마다 선 자리(GS, GA, WA, C, WD, GD, GK)를 적습니다. 안 뛴 구간은 비워 둡니다.' },
  },
  volley: {
    e: { cols: [['출전 세트', 26, 'check'], ['서브 득점', 32, 'tally', 'srv'], ['그 밖의 득점', 34, 'tally', 'pt'], ['비고', 44, 'text']],
      team: [], notes: '서브로 바로 점수를 따면 "서브 득점", 그 밖에 점수를 따면 "그 밖의 득점"에 셉니다. 세트 점수는 위 점수표에 적습니다.' },
    s: { cols: [['출전 세트', 22, 'check'], ['서브\n득점', 17, 'tally', 'srv'], ['공격\n득점', 19, 'tally', 'atk'], ['블로킹\n득점', 17, 'tally', 'blk'], ['득점\n합계', 12, 'nu'], ['서브\n범실', 15, 'tally', 'srvErr'], ['리시브\n성공', 17, 'tally', 'rcv'], ['범실', 15, 'tally', 'err'], ['비고', 24, 'text']],
      team: [['작전 시간 (세트마다 2회)', 'boxes:x2'], ['선수 교대', 'tallybox']], notes: '득점 합계 = 서브 득점 + 공격 득점 + 블로킹 득점. 세트 점수는 위 점수표에 적습니다.' },
  },
  dodge: {
    e: { cols: [['출전 세트', 22, 'check'], ['아웃시킴', 32, 'tally', 'ko'], ['공 받기', 30, 'tally', 'catch'], ['아웃됨', 28, 'tally', 'outd'], ['비고', 30, 'text']],
      team: [['세트 끝 남은 인원', 'partswrite']], notes: '아웃시킨 사람과 공을 받아 낸 사람만 세어도 충분합니다.' },
    s: { cols: [['출전 세트', 18, 'check'], ['아웃시킴', 22, 'tally', 'ko'], ['공 받기\n(캐치)', 20, 'tally', 'catch'], ['아웃됨', 18, 'tally', 'outd'], ['되살아남', 18, 'tally', 'revive'], ['반칙', 15, 'tally', 'pf'], ['비고', 29, 'text']],
      team: [['세트 끝 남은 인원', 'partswrite'], ['작전 시간', 'boxes:2']], notes: '아웃시킨 사람, 공을 받아 낸 사람, 아웃된 횟수를 셉니다.' },
  },
  racket: {
    e: { cols: [['서브 득점', 44, 'tally', 'srv'], ['비고', 100, 'text']],
      team: [], notes: '위 "점수 흐름"에 점수를 딸 때마다 딴 쪽 숫자에 빗금만 그어도 됩니다. 단식은 한 줄, 복식은 두 줄을 씁니다.' },
    s: { cols: [['서브\n득점', 24, 'tally', 'srv'], ['공격 득점\n(스매시·드라이브)', 30, 'tally', 'atk'], ['상대\n범실로 얻음', 28, 'tally', 'opp'], ['내 범실', 24, 'tally', 'err'], ['서브\n범실', 22, 'tally', 'srvErr'], ['비고', 30, 'text']],
      team: [], notes: '위 "점수 흐름"에는 점수를 딸 때마다 딴 쪽 줄의 숫자에 빗금을 긋습니다. 단식은 선수 한 줄, 복식은 두 줄을 씁니다.' },
  },
  free: {
    e: { cols: [['출전', 24, 'check'], ['득점', 32, 'tally', 'goals'], ['도움', 30, 'tally', 'as'], ['( )', 30, 'tally', 'x1'], ['비고', 30, 'text']],
      team: [], notes: '( ) 칸에는 그 종목에서 세고 싶은 것을 직접 적어 씁니다.' },
    s: { cols: [['출전', 20, 'check'], ['득점', 19, 'tally', 'goals'], ['도움', 19, 'tally', 'as'], ['( )', 19, 'tally', 'x1'], ['( )', 19, 'tally', 'x2'], ['( )', 19, 'tally', 'x3'], ['반칙', 17, 'tally', 'pf'], ['비고', 26, 'text']],
      team: [['작전 시간', 'boxes:4']], notes: '( ) 칸에는 그 종목에서 세고 싶은 것을 직접 적어 씁니다.' },
  },
};

const SHORT = { halves: ['전반', '후반'], quarters: ['1Q', '2Q', '3Q', '4Q'], single: ['경기'] };

// 그 학년 규칙(전·후반인지 쿼터인지, 몇 세트인지)에 맞춘 구간 이름
export function partsOf(gr) {
  if (L.isTimed(gr)) return SHORT[gr.format].slice();
  return Array.from({ length: Math.max(1, Number(gr.sets) || 1) }, (_, i) => `${i + 1}세트`);
}

export function sheetOf(gr, level) {
  const kind = sheetKind(gr);
  if (!kind) return null;
  const d = DEFS[kind][level === 's' ? 's' : 'e'], parts = partsOf(gr);
  const name = L.sportName(gr);
  return { kind, name, level: level === 's' ? 's' : 'e', parts, timed: L.isTimed(gr), cols: d.cols, team: d.team, notes: d.notes, goals: !!d.goals, racket: kind === 'racket' };
}

// 경기 뒤 입력표에 쓰는 칸: [열쇠, 이름]
export function statCols(gr, level) {
  const sh = sheetOf(gr, level);
  return sh ? sh.cols.filter((c) => c[3]).map((c) => [c[3], c[0].replace(/\n/g, ' ')]) : [];
}
const ALL_LABELS = (() => { const m = {}; for (const k of Object.values(DEFS)) for (const d of Object.values(k)) for (const c of d.cols) if (c[3] && !m[c[3]]) m[c[3]] = c[0].replace(/\n/g, ' '); return m; })();
export const statLabel = (key) => ALL_LABELS[key] || key;

// 한 선수의 입력값에서 득점을 뽑는다. 적은 것이 없으면 null(경기 중 기록을 그대로 쓴다).
export function pointsFrom(s) {
  if (!s) return null;
  const n = (k) => (s[k] === undefined || s[k] === '' || s[k] === null ? null : Number(s[k]) || 0);
  if (n('goals') !== null) return n('goals');
  if (n('pts') !== null) return n('pts');
  const bk = [n('ft'), n('p2'), n('p3')];
  if (bk.some((v) => v !== null)) return (bk[0] || 0) + 2 * (bk[1] || 0) + 3 * (bk[2] || 0);
  const vb = [n('srv'), n('atk'), n('blk'), n('pt')];
  if (vb.slice(1).some((v) => v !== null)) return vb.reduce((a, v) => a + (v || 0), 0);
  return null;
}

// ---------- 기록지 그리기 ----------
const short = (p) => p.replace('세트', '');
function cell(kind, parts) {
  if (kind === 'tally') return '<td class="tally"><i></i></td>';
  if (kind === 'nu') return '<td class="nu"></td>';
  if (kind.startsWith('boxes:')) return `<td class="bx">${'<b></b>'.repeat(Number(kind.slice(6)))}</td>`;
  if (kind === 'check') return `<td class="ck">${parts.map((x) => `<span>${esc(short(x))}</span>`).join('')}</td>`;
  if (kind === 'write') return `<td class="wr">${parts.map((x) => `<span><em>${esc(short(x))}</em></span>`).join('')}</td>`;
  return '<td></td>';
}
function teamExtra(kind, parts) {
  if (kind === 'tallybox') return '<span class="line"></span><b class="sum"></b>';
  if (kind === 'text') return '<span class="line"></span>';
  if (kind === 'boxes:x2') return `<span class="bx">${'<b></b>'.repeat(parts.length * 2)}</span>`;
  if (kind.startsWith('boxes:')) return `<span class="bx">${'<b></b>'.repeat(Number(kind.slice(6)))}</span>`;
  if (kind === 'partsboxes5') return parts.map((p) => `<span class="grp"><em>${esc(short(p))}</em><span class="bx">${'<b></b>'.repeat(5)}</span></span>`).join('');
  if (kind === 'partswrite') return parts.map((p) => `<span class="grp"><em>${esc(short(p))}</em><b class="sum"></b></span>`).join('');
  return '';
}
function teamTable(sh, side, team, rows) {
  const head = sh.cols.map(([h, w]) => `<th style="width:${w}mm">${esc(h).replace(/\n/g, '<br>')}</th>`).join('');
  const ps = (team && team.players) || [];
  const body = Array.from({ length: rows }, (_, i) => `<tr><td class="no">${esc((ps[i] || {}).no ?? '')}</td><td class="nm">${esc((ps[i] || {}).name ?? '')}</td>${sh.cols.map(([, , k]) => cell(k, sh.parts)).join('')}</tr>`).join('');
  const extras = sh.team.map(([t, k]) => `<span class="tx"><em>${esc(t)}</em>${teamExtra(k, sh.parts)}</span>`).join('');
  const nm = team && team.name ? `<span class="line fill">${esc(team.name)}</span>` : '<span class="line"></span>';
  return `<div class="team ${side}"><div class="tname"><b>${sh.racket ? '선수' : '팀'} ${side === 'a' ? 'A' : 'B'}</b>${nm}${extras}</div>
<table class="ps"><thead><tr><th style="width:9mm">번호</th><th>이름</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function scoreTable(sh) {
  const ps = sh.timed ? [...sh.parts, '연장'] : sh.parts;
  const row = (n) => `<tr><td class="l">${n}</td>${'<td></td>'.repeat(ps.length)}<td class="tot"></td></tr>`;
  return `<table class="sc"><thead><tr><th class="l">${sh.timed ? '구간' : '세트'}별 점수</th>${ps.map((p) => `<th>${esc(p)}</th>`).join('')}<th>${sh.timed ? '최종' : '세트 승'}</th></tr></thead><tbody>${row('A')}${row('B')}</tbody></table>`;
}
function flow(sh) {
  const nums = Array.from({ length: 30 }, (_, i) => `<i>${i + 1}</i>`).join('');
  const one = (p) => `<div class="fl"><em>${esc(p)}</em><div><span><b>A</b>${nums}</span><span><b>B</b>${nums}</span></div></div>`;
  return `<div class="flow"><div class="cap">점수 흐름 · 점수를 딸 때마다 딴 쪽 숫자에 빗금</div>${sh.parts.slice(0, 5).map(one).join('')}</div>`;
}
function goalsBox() {
  const row = `<tr>${'<td></td>'.repeat(5)}</tr>`;
  const t = `<table class="gl"><thead><tr><th>시간</th><th>팀</th><th>넣은 선수</th><th>도운 선수</th><th>점수</th></tr></thead><tbody>${row.repeat(5)}</tbody></table>`;
  return `<div class="goals"><div class="cap">득점 기록</div><div class="two">${t}${t}</div></div>`;
}

// 한 팀 줄 수와 줄 높이(mm). 명단이 있으면 그 인원에 빈 줄을 조금 더한다.
export function rowsFor(sh, a, b) {
  const most = Math.max(((a || {}).players || []).length, ((b || {}).players || []).length);
  if (sh.racket) return { rows: Math.max(2, Math.min(most, 4)), rh: 17 };
  const rows = most ? Math.min(18, Math.max(6, most + 2)) : sh.kind === 'soccer' || sh.kind === 'dodge' || sh.kind === 'free' ? 14 : 12;
  const room = (sh.goals ? 164 : 196) - (sh.kind === 'netball' ? 6 : 0);
  return { rows, rh: Math.round(Math.max(4.4, Math.min(9, room / (rows * 2))) * 10) / 10 };
}

// info: { title 대회 이름, game '3경기', when, a: { name, players: [{ no, name }] }, b }
export function sheetHtml(gr, level, info = {}) {
  const sh = sheetOf(gr, level);
  if (!sh) return '';
  const { rows, rh } = rowsFor(sh, info.a, info.b);
  const who = sh.racket ? '선수' : '팀';
  const f = (label, v, cls = '') => `<span class="${cls}"><em>${label}</em><i>${esc(v || '')}</i></span>`;
  return `<section class="page" style="--rh:${rh}mm">
<header><div class="ttl"><b>${esc(sh.name)} 기록지</b><span>${levelName(sh.level)}용 · 휘슬! Whistle</span></div>
<div class="meta">${f('대회', info.title)}${f('경기', info.game, 's')}${f('날짜·교시', info.when, 's')}${f('장소', '', 's')}</div>
<div class="meta">${f(`A ${who}`, (info.a || {}).name)}${f(`B ${who}`, (info.b || {}).name)}${f('기록한 사람', '', 's')}</div></header>
${scoreTable(sh)}
${sh.racket ? flow(sh) : ''}
${teamTable(sh, 'a', info.a, rows)}
${teamTable(sh, 'b', info.b, rows)}
${sh.goals ? goalsBox() : ''}
<footer><p>${esc(sh.notes)} 세는 칸은 경기 중에 正자나 빗금으로 세고, 끝난 뒤 칸 오른쪽 아래 작은 네모에 합계 숫자를 적습니다.</p>
<div class="sign"><span><em>심판 확인</em><i></i></span><span><em>A 확인</em><i></i></span><span><em>B 확인</em><i></i></span></div></footer>
</section>`;
}
