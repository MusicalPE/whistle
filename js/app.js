// 휘슬! 화면. 주소에 따라 선생님 화면, 학생 화면(?v=대회), 전광판(?b=대회)으로 열린다.
import { VERSION } from './version.js';
import * as L from './logic.js';
import * as P from './plan.js';
import { createStore, forceDemo, CONFIGURED, TRY, TID_KEY } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const MODE = params.get('v') ? 'student' : params.get('b') ? 'board' : params.get('o') ? 'order' : 'teacher';
const BASE = location.origin + location.pathname;
// 체험용 미리보기(?demo)에서는 학생 화면·전광판 주소에도 demo 를 붙여 같은 지어낸 대회를 보게 한다.
const DQ = TRY ? '&demo' : '', HOME = BASE + (TRY ? '?demo' : '');
const S = {
  store: null, tid: null, T: null, M: {}, my: [], gid: null, sheet: null, tab: 'live', teamId: null,
  sub: {}, rec: { team: '', sort: 'goals', key: null }, boardGame: null, off: [], dirty: false, code: '',
  school: {}, classId: null, offSchool: null, ord: { side: null, picks: [], done: false },
};

// ---------- 자료 읽기 ----------
const T = () => S.T || {};
const uid = () => (S.store.user ? S.store.user.uid : '');
const isOwner = () => !!T().meta && T().meta.owner === uid();
// 권한 단계: owner(대회 만든 사람) > admin(모든 설정) > editor(경기 진행 + 팀 명단·경기 일정) > ref(경기 진행만)
const ROLE_NAMES = { ref: '경기 진행만', editor: '경기 진행 + 팀 명단·경기 일정', admin: '모든 설정' };
const myRole = () => (isOwner() ? 'owner' : ((S.M || {})[uid()] || {}).role || 'ref');
const canRules = () => ['owner', 'admin'].includes(myRole());
const canTeams = () => ['owner', 'admin', 'editor'].includes(myRole());
const gradeList = () => Object.entries(T().grades || {}).map(([id, g]) => ({ id, ...g })).sort((a, b) => (a.order || 0) - (b.order || 0));
const grade = () => { const list = gradeList(); return list.find((g) => g.id === S.gid) || list[0] || null; };
const teamsOf = (gid) => Object.fromEntries(Object.entries(T().teams || {}).filter(([, t]) => t.gid === gid));
const teamName = (id) => (P.isOpen(id) ? P.openName(id) : ((T().teams || {})[id] || {}).name || '(지워진 팀)');
const playersOf = (teamId) => Object.entries(((T().teams || {})[teamId] || {}).players || {}).map(([pid, p]) => ({ pid, ...p })).sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0) || String(a.name).localeCompare(String(b.name), 'ko'));
const gameOf = (id) => {
  const g = (T().games || {})[id]; const gr = g && (T().grades || {})[g.gid];
  return gr ? L.norm({ id, ...JSON.parse(JSON.stringify(g)) }, gr) : null;
};
const gamesOf = (gid) => Object.keys(T().games || {}).map(gameOf).filter((g) => g && g.gid === gid).sort((a, b) => a.no - b.no);
const logsOf = (gameId) => Object.entries((T().logs || {})[gameId] || {}).map(([id, l]) => ({ id, ...l })).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
const ordersOf = (gameId) => (T().orders || {})[gameId] || {};
const orderList = (gameId, side, g) => { const l = (ordersOf(gameId)[side] || {}).list; const ok = new Set(playersOf(g[side]).map((p) => p.pid)); return [...new Set(Array.isArray(l) ? l : Object.values(l || {}))].filter((pid) => ok.has(pid)); };
const ctxFor = (g, gameId) => ({
  orders: ordersOf(gameId),
  now: S.store.now(), uid: uid(), names: { a: teamName(g.a), b: teamName(g.b) },
  rosters: { a: ((T().teams || {})[g.a] || {}).players || {}, b: ((T().teams || {})[g.b] || {}).players || {} },
});
// 학교 명단(선택): 내 계정에만 저장되는 학년·반 명단. 팀 명단을 만들 때 체크해서 불러온다.
const schoolPath = () => `u/${uid()}/school`;
const classList = () => Object.entries(S.school || {}).map(([id, c]) => ({ id, ...c })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko', { numeric: true }));
const studentsOf = (cid) => Object.entries(((S.school || {})[cid] || {}).students || {}).map(([sid, p]) => ({ sid, ...p })).sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0) || String(a.name).localeCompare(String(b.name), 'ko'));
// "번호 이름" 줄들을 읽는다. 번호가 없으면 이어서 매긴다.
function parseLines(text, lastNo) {
  let n = lastNo;
  return text.split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 60).map((line) => {
    const m = line.match(/^(\d{1,3})[\s.,번)-]*(.+)$/);
    if (m) n = Math.max(n, Number(m[1]));
    return { no: m ? m[1] : String(++n), name: (m ? m[2] : line).trim().slice(0, 12) };
  });
}
// 피구: 이번 세트에 아직 안에 있는 선수 / 아웃된 선수
const dodgeIn = (g, side) => playersOf(g[side]).filter((p) => g.lineup[side][p.pid] === 'on' && !(g.dout[side] || {})[p.pid]);
const dodgeOutList = (g, side) => playersOf(g[side]).filter((p) => (g.dout[side] || {})[p.pid]);
// 시작 전 선발·교체: 설정의 선발 인원까지만 선발, 넘는 선수는 교체로 보여 준다(시작할 때도 똑같이 선다).
const preIds = (g, side) => L.starterIds(((T().teams || {})[g[side]] || {}).players || {}, T().grades[g.gid].starters);
const preOn = (g, side) => { const ids = preIds(g, side); return playersOf(g[side]).filter((p) => ids.includes(p.pid)); };
const preBench = (g, side) => { const ids = preIds(g, side); return playersOf(g[side]).filter((p) => !ids.includes(p.pid) && !p.off); };
// 명단이 설정과 안 맞는 까닭(없으면 빈 목록). 맞지 않으면 경기를 시작할 수 없다.
const slotOf = (p) => (p.off ? 'off' : p.bench ? 'bench' : 'on');
const rosterIssues = (teamId, gr) => {
  const ps = playersOf(teamId), n = Number(gr.starters) || 1, m = Number(gr.subs) || 0;
  const on = ps.filter((p) => slotOf(p) === 'on').length, bench = ps.filter((p) => slotOf(p) === 'bench').length;
  const out = [];
  if (on > n) out.push(`선발이 ${on}명입니다(설정 ${n}명)`);
  else if (on < n && ps.length > on) out.push(`선발이 ${on}명뿐입니다(설정 ${n}명)`);
  if (m && bench > m) out.push(`후보가 ${bench}명입니다(설정 ${m}명)`);
  return out;
};
const preOver = (g, side) => rosterIssues(g[side], T().grades[g.gid]);
// 새로 넣는 선수의 자리: 선발이 차면 후보, 후보 인원도 차면 빠짐
const nextSlot = (ps) => {
  const gr = grade(), m = Number(gr.subs) || 0;
  if (ps.filter((p) => slotOf(p) === 'on').length < Number(gr.starters)) return { bench: false, off: false };
  return m && ps.filter((p) => slotOf(p) === 'bench').length >= m ? { bench: true, off: true } : { bench: true, off: false };
};
const lineupOf = (g, side, state) => playersOf(g[side]).filter((p) => g.lineup[side][p.pid] === state);
const statusText = (g) => (g.status === 'ready' ? '예정' : g.status === 'done' ? '종료' : g.clock && !g.clock.run ? '멈춤' : '진행 중');
const scoreText = (g) => (g.status === 'ready' ? 'vs' : `${g.sa} : ${g.sb}`);

const friendly = (e) => (/permission/i.test((e && e.message) || '') ? '권한이 없습니다. 대회 만든 사람만 할 수 있거나, 보안 규칙이 아직 설정되지 않았습니다.' : (e && e.message) || '문제가 생겼습니다.');

// 지운 것을 15초 동안 되돌릴 수 있는 알림 줄
function undoBar(msg, run) {
  const el = document.getElementById('toast');
  clearTimeout(toast.t); undoBar.run = run;
  const left = () => Math.max(0, Math.ceil((undoBar.until - Date.now()) / 1000));
  undoBar.until = Date.now() + 15000;
  el.innerHTML = `${esc(msg)} <button class="undo" data-act="undoDel">되돌리기 (<span>15</span>초)</button>`;
  clearInterval(undoBar.i);
  undoBar.i = setInterval(() => { const n = el.querySelector('.undo span'); if (left() <= 0 || !n) { clearInterval(undoBar.i); undoBar.run = null; el.textContent = ''; } else n.textContent = left(); }, 1000);
}
function toast(msg) {
  clearInterval(undoBar.i); undoBar.run = null;
  const el = document.getElementById('toast');
  el.textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.textContent = ''; }, 2600);
}

// 경기를 고친다. 여러 선생님이 동시에 눌러도 서로 덮어쓰지 않게 저장소의 묶음 처리(tx)를 쓴다.
async function act(gameId, fn) {
  const g0 = (T().games || {})[gameId];
  if (!g0) return false;
  const gr = T().grades[g0.gid];
  let logs = [];
  try {
    await S.store.tx(`t/${S.tid}/games/${gameId}`, (g) => { logs = fn(g, gr, ctxFor(g, gameId)) || []; return JSON.parse(JSON.stringify(g)); });
    for (const l of logs) await S.store.push(`t/${S.tid}/logs/${gameId}`, l);
    if (g0.stage) await syncBracket(g0.gid);
    return true;
  } catch (e) { toast(friendly(e)); return false; }
}

// ---------- 공통 조각 ----------
const brand = () => `<div class="brand"><img src="icons/icon.svg" alt=""><b>휘슬!</b><span>Whistle</span></div>`;
const demoBar = () => (S.store.demo ? `<div class="demo">${TRY ? '미리보기 · 지어낸 대회입니다. 눌러 본 것은 이 기기에만 남습니다' : '미리보기 · 이 기기 안에만 저장됩니다'}</div>` : '');
// 선생님 경기 화면의 기록 줄: 득점 기록은 눌러서 넣은 선수·어시스트를 나중에 고칠 수 있다.
const teacherLogRow = (gameId) => (l) => (l.type === 'goal' && !l.x
  ? `<button class="log edit" data-act="editGoal" data-id="${gameId}" data-log="${l.id}" aria-label="득점 기록 고치기"><b>${esc(l.tag)}</b><span>${esc(l.text)}</span><i>${l.pid ? '고치기' : '선수 넣기'}</i></button>`
  : logRow(l));
// 이 경기 명단에 든 선수 모두(뛰는 중·교체 대기·나간 선수). 나중에 고칠 때는 지금 뛰는 선수만으로는 모자라다.
const gamePlayers = (g, side) => playersOf(g[side]).filter((p) => (g.lineup[side] || {})[p.pid]);
const logRow = (l) => `<div class="log${l.x ? ' cut' : ''}"><b>${esc(l.tag)}</b><span>${esc(l.text)}${l.x ? ' (취소)' : ''}</span></div>`;
const clockSpan = (g, cls = '') => `<span class="num ${cls}" data-clock="${g.id}">${L.fmtClock(L.clockLeft(g, S.store.now()))}</span>`;
function qrSvg(url) {
  try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch { return ''; }
}
// 어느 화면에서나 여는 간략 사용법
const helpBtn = (cls = '') => `<button class="helpbtn ${cls}" data-act="help"><span class="q" aria-hidden="true">?</span>사용 안내</button>`;
const HELP = [
  ['처음 준비', ['대회를 만들고 홈에서 "+ 학년 추가"로 학년과 종목을 고릅니다.', '홈의 "팀 명단"에서 팀을 만들고 번호와 이름을 붙여 넣습니다. 선발 · 후보 · 빠짐을 정해 둡니다.', '경기 시간, 선발 인원, 교체 카드 같은 규칙은 홈의 "종목·규칙"에서 바꿉니다.', '"경기" 탭에서 "+ 경기 추가"로 맞붙을 두 팀을 고릅니다.']],
  ['대회 편성 (선택)', ['경기를 하나씩 넣는 대신 홈의 "대회 편성"에서 풀리그, 토너먼트, 조별 예선 + 결선, 원형 예선 + 결선, 스위스 + 결선 가운데 골라 한꺼번에 짤 수 있습니다.', '"추첨하기"로 팀을 섞고, 전광판에 추첨을 띄워 함께 볼 수 있습니다.', '예선이나 앞 경기가 끝나면 결선 자리에 팀이 자동으로 들어갑니다. 결선이 동점이면 연장을 열거나 승자를 고릅니다.']],
  ['경기 진행', ['경기를 누르고 "경기 시작"을 누르면 시계가 돕니다.', '"+1 득점"을 누르고 넣은 선수를 고릅니다. 바쁘면 "선수 없이 점수만 올리기"를 누르세요.', '점수만 올린 득점은 나중에 경기 기록에서 그 줄을 눌러 선수와 어시스트를 넣을 수 있습니다. 끝난 경기도 됩니다.', '"선수 교체"에서 나가는 선수와 들어가는 선수를 누릅니다. 교체 카드는 알아서 줄어듭니다.', '잘못 올린 점수는 "−"로 뺍니다.']],
  ['학생 화면과 전광판', ['"경기" 탭의 학생용 QR을 크게 띄워 보여 줍니다. 학생은 로그인 없이 보기만 합니다.', '학생 화면은 몇 초마다 새로 읽어서 5초쯤 늦게 바뀝니다.', '"전광판 모드"를 TV나 전자칠판에 띄우면 큰 점수판이 됩니다.', 'QR과 주소는 우리 학교 학생과 학부모에게만 공유해 주세요.']],
  ['함께 심판 보기', ['홈 오른쪽 위 "함께하는 선생님 · 초대"에서 초대 QR이나 코드를 보냅니다.', '선생님마다 경기 진행만, 팀 명단과 일정까지, 모든 설정까지 가운데 권한을 정합니다.']],
  ['대회가 끝나면', ['홈의 "개인 기록"에서 학생별 출전 · 득점 기록을 봅니다. 선생님만 볼 수 있고, 전광판에 띄워 보여 줄 수 있습니다.', '순위표는 학생 화면의 "경기 결과"에 함께 나옵니다.']],
];
const nav = (on) => {
  const items = [['home', '홈'], ['games', '경기']];
  items.push(['settings', '대회 설정']);
  return `<nav class="nav"><a class="navbrand" href="#home" aria-label="휘슬! 홈으로">${brand()}</a>${items.map(([h, t]) => `<a href="#${h}" class="${on === h ? 'on' : ''}">${t}</a>`).join('')}${helpBtn('innav')}</nav>`;
};
const gradeSelect = () => `<select class="input" style="width:auto" data-change="pickGrade" aria-label="학년">${gradeList().map((g) => `<option value="${g.id}"${grade() && g.id === grade().id ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select>`;

// 티볼 타석 기록: 루 그림. 주자가 있는 루는 주황으로 칠하고 등번호를 적는다.
function diamond(g, size, dark) {
  const side = L.attacker(g), P = Object.fromEntries(playersOf(g[side]).map((p) => [p.pid, p]));
  const pos = { 1: [165, 88], 2: [100, 23], 3: [35, 88] }, empty = dark ? '#0B0F17' : '#FFFFFF';
  const base = (b) => {
    const [x, y] = pos[b], r = g.bases[`b${b}`];
    return `<rect x="${x - 14}" y="${y - 14}" width="28" height="28" transform="rotate(45 ${x} ${y})" fill="${r ? '#E8743B' : empty}" stroke="${r ? '#E8743B' : '#6B7280'}" stroke-width="2"/>${r && P[r] ? `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="#111827">${esc(P[r].no)}</text>` : ''}`;
  };
  return `<svg viewBox="0 0 200 176" width="${size}" style="flex:0 0 auto;max-width:100%" role="img" aria-label="루 상황: ${[1, 2, 3].map((b) => `${b}루 ${g.bases[`b${b}`] ? '주자 있음' : '비어 있음'}`).join(', ')}"><path d="M100 153 L165 88 L100 23 L35 88 Z" fill="none" stroke="${dark ? '#39424F' : '#D7DBE2'}" stroke-width="3"/><path d="M100 141 l12 12 l-12 12 l-12 -12 z" fill="${empty}" stroke="#6B7280" stroke-width="2"/>${base(1)}${base(2)}${base(3)}</svg>`;
}
const batterText = (g) => { const p = playersOf(g[L.attacker(g)]).find((x) => x.pid === L.batterOf(g)); return p ? `${p.no} ${p.name}` : ''; };
const outsText = (g, gr) => (gr.rotate === 'out3' ? `아웃 ${Math.min(g.outs, 3)} / 3` : `이번 공격 ${g.hb} / ${g.order[L.attacker(g)].length}명 · 아웃 ${g.outs}`);

function batBox(g, gr) {
  const side = L.attacker(g), order = g.order[side], P = Object.fromEntries(playersOf(g[side]).map((p) => [p.pid, p]));
  const nm = (pid) => (P[pid] ? `${esc(P[pid].no)} ${esc(P[pid].name)}` : '선수');
  const dis = g.halfDone ? ' disabled' : '';
  const SHORT = { h1: '1루타', h2: '2루타', h3: '3루타', hr: '홈런', go: '땅볼', fo: '플라이', dp: '병살', e: '출루' };
  const rb = (res, cls) => `<button class="btn sm ${cls}" style="padding:0" data-act="bat" data-id="${g.id}" data-res="${res}"${dis}>${SHORT[res]}</button>`;
  const mv = (b, op, t) => `<button class="btn sm" style="padding:0 10px;font-size:13px" data-act="runner" data-id="${g.id}" data-base="${b}" data-op="${op}">${t}</button>`;
  const runners = [3, 2, 1].filter((b) => g.bases[`b${b}`]).map((b) => `<div class="row" style="gap:6px"><b style="flex:0 0 32px">${b}루</b><span class="grow">${nm(g.bases[`b${b}`])}</span>${b < 3 ? mv(b, 'adv', '한 루 더') : ''}${mv(b, 'home', '홈인')}${mv(b, 'out', '아웃')}</div>`).join('');
  const canUndo = g.undo && g.undo.cur === g.cur && g.undo.half === g.half;
  return `<section class="card p stack" style="margin:10px 20px 0">
<div class="row" style="gap:14px">${diamond(g, 132)}<div class="stack grow" style="gap:4px"><span class="label">지금 타자 · ${(g.bat[side] % order.length) + 1}번</span><b style="font-size:20px" data-batter>${g.halfDone ? '-' : nm(L.batterOf(g))}</b><span class="note">${outsText(g, gr)}</span></div></div>
${g.halfDone ? `<b>${gr.rotate === 'out3' ? '3아웃입니다.' : '타자가 모두 쳤습니다.'} 주자 정리가 끝났으면 "공수 교대"를 눌러 주세요.</b>` : ''}
<span class="label">안타${L.maxAdv(gr) < 3 ? ` · 홈런이 아니면 ${L.maxAdv(gr)}루까지` : ''}</span><div class="grid2" style="grid-template-columns:repeat(${L.maxAdv(gr) + 1},minmax(0,1fr));gap:6px">${['h1', 'h2', 'h3'].slice(0, L.maxAdv(gr)).map((r) => rb(r, 'primary')).join('')}${rb('hr', 'primary')}</div>
<span class="label">아웃 · 그 밖의 출루</span><div class="grid2" style="grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">${rb('go', '')}${rb('fo', '')}${rb('dp', '')}${rb('e', '')}</div>
${runners ? `<div class="stack" style="gap:6px;border-top:1px solid var(--soft);padding-top:10px"><span class="label">주자 · 실제와 다르면 고쳐 주세요</span>${runners}</div>` : ''}
<button class="btn plain" data-act="batUndo" data-id="${g.id}"${canUndo ? '' : ' disabled'}>방금 기록 취소</button></section>`;
}

// 경기 종류에 따라 큰 숫자와 가운데 글씨를 정한다. 학생 화면과 전광판이 같이 쓴다.
function mainScore(g, gr) {
  const done = g.status === 'done';
  if (L.isTimed(gr)) return { a: g.sa, b: g.sb, mid: done ? '종료' : clockSpan(g, 'clk'), sub: done ? '' : `${L.partName(gr, g.cur)} · 남은 시간`, clock: !done };
  if (gr.format === 'innings') return { a: g.sa, b: g.sb, mid: done ? '종료' : L.partName(gr, g.cur, g.half), sub: done ? '' : `${esc(teamName(g.half ? g.b : g.a))} 공격${L.isDetail(g, gr) ? ` · ${g.halfDone ? '공격 끝' : `타자 ${esc(batterText(g))}`} · 아웃 ${g.outs}` : ''}` };
  if (gr.format === 'sets') return done ? { a: g.sa, b: g.sb, mid: '종료', sub: '세트 스코어' } : { a: g.pa[g.cur], b: g.pb[g.cur], mid: `${g.sa} : ${g.sb}`, sub: `세트 스코어 · ${g.cur + 1}세트` };
  return done ? { a: g.sa, b: g.sb, mid: '종료', sub: '세트 스코어' } : { a: g.remain.a, b: g.remain.b, mid: clockSpan(g, 'clk'), sub: `${g.cur + 1}세트 · 남은 인원 · 세트 ${g.sa} : ${g.sb}${g.ext ? ' · 연장' : ''}`, clock: true };
}

function partsTable(g, gr) {
  const n = L.partCount(gr, g);
  if (L.isTimed(gr) && n < 2) return '';
  const cols = `minmax(0,1fr) repeat(${n}, 34px) 44px`;
  const head = Array.from({ length: n }, (_, i) => `<span>${gr.format === 'innings' ? i + 1 : L.isTimed(gr) ? L.partName(gr, i).replace('쿼터', 'Q') : `${i + 1}세트`}</span>`).join('');
  const cell = (arr, i) => (i > g.cur && g.status !== 'done' ? '<span class="muted">-</span>' : `<span>${arr[i]}</span>`);
  const row = (side, arr, total) => `<div class="tr" style="grid-template-columns:${cols}"><b class="l t${side}">${esc(teamName(g[side]))}</b>${arr.map((_, i) => cell(arr, i)).join('')}<b>${total}</b></div>`;
  if (gr.format === 'dodge') {
    return `<div class="card tbl"><div class="tr th" style="grid-template-columns:56px 1fr 1.3fr"><span class="l">세트</span><span class="l">이긴 팀</span><span class="l">끝난 까닭</span></div>${Array.from({ length: n }, (_, i) => {
      const w = g.wins[i];
      const who = w === 'd' ? '무승부' : w ? esc(teamName(g[w])) : i === g.cur && g.status === 'live' ? '진행 중' : '-';
      return `<div class="tr" style="grid-template-columns:56px 1fr 1.3fr"><b class="l">${i + 1}세트</b><span class="l">${who}</span><span class="l muted">${esc(g.why[i] || '')}</span></div>`;
    }).join('')}</div>`;
  }
  const cols2 = gr.format === 'sets' ? cols.replace('34px', '44px') : cols;
  return `<div class="card tbl"><div class="tr th" style="grid-template-columns:${cols2}"><span class="l">${gr.format === 'sets' ? '세트별 점수' : gr.format === 'innings' ? '회별 점수' : '구간별 점수'}</span>${head}<span>${gr.format === 'sets' ? '세트' : '합계'}</span></div>${row('a', g.pa, g.sa).replace(cols, cols2)}${row('b', g.pb, g.sb).replace(cols, cols2)}</div>`;
}

// 경기 일정 입력 칸. 날짜·교시·시간 모두 선택이다.
const PERIODS = ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시', '7교시', '8교시', '아침 활동', '점심시간', '방과 후'];
const whenFields = (g = {}) => {
  const [H, M] = g.time ? String(g.time).split(':').map(Number) : [null, null];
  const ap = H === null ? '' : H < 12 ? 'am' : 'pm';
  return `<div class="field"><label class="label" for="w-date">날짜 (선택)</label><input id="w-date" type="date" class="input" value="${esc(g.date || '')}"></div>
<div class="field"><label class="label" for="w-period">교시 (선택)</label><select id="w-period" class="input"><option value="">정하지 않음</option>${PERIODS.map((p) => `<option${g.period === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
<div class="field"><span class="label">또는 시간 (선택)</span><div class="row" style="gap:6px"><select id="w-ampm" class="input" style="flex:1.2" aria-label="오전 오후"><option value="">정하지 않음</option><option value="am"${ap === 'am' ? ' selected' : ''}>오전</option><option value="pm"${ap === 'pm' ? ' selected' : ''}>오후</option></select>
<input id="w-hour" class="input" style="flex:1" inputmode="numeric" maxlength="2" placeholder="시" aria-label="시" value="${H === null ? '' : H % 12 || 12}" data-change="whenHour"><b>시</b>
<input id="w-min" class="input" style="flex:1" inputmode="numeric" maxlength="2" placeholder="분" aria-label="분" value="${H === null ? '' : String(M).padStart(2, '0')}" data-change="whenMin"><b>분</b></div></div>
<p class="note">날짜, 교시, 시간은 적지 않아도 됩니다. 시에 23처럼 적으면 오후 11시로 바뀝니다. 교시와 시간을 둘 다 적으면 시간으로 표시하고, 학생 화면에도 보입니다.</p>`;
};
function readWhen() {
  const h = parseInt(val('w-hour'), 10), m = parseInt(val('w-min'), 10) || 0, ap = val('w-ampm');
  const time = Number.isNaN(h) ? null : `${String((h % 12) + (ap === 'pm' ? 12 : 0)).padStart(2, '0')}:${String(Math.min(59, Math.max(0, m))).padStart(2, '0')}`;
  return { date: val('w-date') || null, period: val('w-period') || null, time };
}

// ---------- 선생님 화면 ----------
function loginScreen() {
  return `<div class="app">${demoBar()}<div class="top" style="padding-top:72px;align-items:center;gap:12px">
<img src="icons/icon.svg" alt="" width="96" height="96" style="border-radius:22px">
<div class="center"><div class="title" style="font-size:44px">휘슬!</div><div class="num muted" style="font-size:24px;letter-spacing:.06em;font-weight:600">Whistle</div></div>
<p class="note center">스포츠클럽 리그전 경기 커맨드 센터<br>점수 · 교체 · 기록은 선생님 폰으로, 학생은 QR로 실시간</p></div>
<div class="pad stack mt"><button class="btn primary big block" data-act="signIn">${S.store.demo ? '미리보기로 시작' : '구글 계정으로 로그인'}</button>
${S.store.demo ? `<p class="note center">미리보기는 이 기기 안에만 저장되고 다른 기기와 연동되지 않습니다.</p>${CONFIGURED ? '<button class="btn plain" data-act="demoOff">구글 로그인 화면으로 돌아가기</button>' : ''}` : '<button class="btn plain" data-act="demoOn">로그인 없이 미리보기로 둘러보기</button>'}</div>
<div class="center" style="margin-top:8px">${helpBtn()}</div>
<div class="spacer"></div><div class="foot">음악적체육인 · v${VERSION}</div></div>`;
}

function listScreen() {
  const cards = S.my.map((t) => {
    const d = t.at ? new Date(t.at) : null, total = t.live + t.done + t.ready;
    return `<button class="card tcard" data-act="openT" data-tid="${t.tid}"><span class="row between"><span class="tagbox"${t.owner ? '' : ' style="background:var(--blue)"'}>${t.owner ? '내가 만든 대회' : '초대받은 대회'}</span><span class="small muted">${d ? `${d.getMonth() + 1}월 ${d.getDate()}일 만듦` : ''}</span></span>
<b class="tname">${esc(t.name)}</b><span class="small muted">${t.grades.map(esc).join(' · ') || '아직 학년이 없습니다'}</span>
<span class="row small" style="gap:6px;flex-wrap:wrap">${t.live ? `<span class="pill"><span class="dot"></span>진행 중 ${t.live}경기</span>` : ''}<span class="info">경기 ${total}개</span><span class="info">끝난 경기 ${t.done}개</span><span class="info">예정 ${t.ready}개</span></span>
<span class="btn sm primary">대회 열기</span></button>`;
  }).join('');
  return `<div class="app list">${demoBar()}<header class="hero"><img src="icons/icon.svg" alt="" width="76" height="76"><div><div class="hname">휘슬!</div><div class="hsub">Whistle</div></div><div class="hdesc"><b>교사용 대회 커맨드 센터</b><span>점수 · 교체 · 기록은 선생님 폰으로, 학생은 QR로 실시간</span></div></header>
<div class="top" style="padding-top:20px"><div class="row between"><h1 class="title" style="font-size:22px">내 대회</h1>${helpBtn()}</div></div>
<div class="pad stack">${cards ? `<div class="tcards">${cards}</div>` : '<p class="note">아직 대회가 없습니다. 아래에서 새 대회를 만들어 보세요.</p>'}
<div class="cols" style="gap:10px;margin-top:12px"><div class="card p stack" style="margin-bottom:10px"><label class="label" for="new-t">새 대회 만들기</label><input id="new-t" class="input" placeholder="예: 햇살초 스포츠클럽 리그" maxlength="40" data-enter="newT"><button class="btn primary" data-act="newT">대회 만들기</button></div>
<div class="card p stack"><label class="label" for="join-code">초대 코드로 참여 (심판 선생님)</label><input id="join-code" class="input" placeholder="예: HW4827" maxlength="12" value="${esc(S.code)}" data-enter="joinT"><button class="btn" data-act="joinT">참여하기</button></div></div>
<button class="btn plain" data-act="signOut">${S.store.demo ? '미리보기 끝내기' : '구글 계정 로그아웃'}</button></div>
<div class="spacer"></div><div class="foot">음악적체육인 · v${VERSION}</div></div>`;
}

function gameCard(g, href) {
  const live = g.status === 'live';
  const when = g.status === 'ready' ? L.whenText(g) : '';
  const st = live ? `<span class="pill"><span class="dot"></span>${statusText(g)}</span>` : `<span>${statusText(g)}${when ? ` · ${esc(when)}` : ''}</span>`;
  const gr = T().grades[g.gid];
  const part = live ? ` · ${L.partName(gr, g.cur, g.half)}` : '';
  const inner = `<div class="row between label"><span>${g.no}경기${g.label ? ` · ${esc(g.label)}${g.rec ? ` (${esc(g.rec)})` : ''}` : ''}${part}</span>${st}</div><div class="vs"><span class="ta">${esc(teamName(g.a))}</span><span class="num sc">${scoreText(g)}</span><span class="tb right">${esc(teamName(g.b))}</span></div>`;
  return href ? `<a class="card game${live ? ' live' : ''}" href="${href}">${inner}</a>` : `<div class="card game${live ? ' live' : ''}">${inner}</div>`;
}

const gradeChips = (add) => gradeList().map((g) => `<button class="chip${grade() && g.id === grade().id ? ' on' : ''}" data-act="pickGrade" data-gid="${g.id}">${esc(g.label)} ${esc(L.sportName(g))}</button>`).join('') + (add && canRules() ? `<button class="chip dash" data-act="addGrade">+ 학년 추가</button>` : '');

// 홈 위쪽: 대회 이름, 학년 고르기, 학년 메뉴. 고른 메뉴의 내용은 바로 아래에 그린다.
function homeTop(tab) {
  const gr = grade(), owner = isOwner();
  const item = (k, t) => `<a href="#${k}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}>${t}</a>`;
  return `<div class="app">${demoBar()}<header class="top">${brand()}
<div class="row between"><h1 class="title grow">${esc(T().meta.name)}</h1><button class="btn sm" style="flex:0 0 auto" data-act="leaveT">대회 목록</button></div>
<div class="row small muted" style="justify-content:flex-end;gap:14px">${helpBtn('inhome')}<a href="#members" class="bold" style="padding:10px 0">함께하는 선생님 ${Object.keys(S.M || {}).length || 1}명${owner ? ' · 초대' : ''}</a></div></header>
<div class="chips">${gradeChips(true)}</div>
${gr ? `<div class="submenu"><span class="label">${esc(gr.label)} ${esc(L.sportName(gr))}</span>${canTeams() ? item('teams', '팀 명단') : ''}${canRules() ? item('rules', '종목·규칙') : ''}${canRules() ? item('plan', '대회 편성') : ''}${item('records', '개인 기록')}${canRules() ? '<button class="del" data-act="delGradeAsk">학년 지우기</button>' : ''}</div>` : ''}`;
}

function homeScreen() {
  if (grade()) return canTeams() ? teamsScreen() : recordsScreen();
  return `${homeTop('')}<p class="note pad mt">${canRules() ? '위의 "+ 학년 추가"로 학년과 종목을 먼저 정해 주세요.' : '아직 학년이 없습니다.'}</p><div class="spacer"></div>${nav('home')}</div>`;
}

// 경기: 학생용 QR·전광판과 고른 학년의 모든 경기
function gamesScreen() {
  const gr = grade(), games = gr ? gamesOf(gr.id) : [], teamsOk = canTeams();
  const liveElse = gradeList().filter((g) => !gr || g.id !== gr.id).flatMap((g) => gamesOf(g.id)).filter((g) => g.status === 'live');
  return `<div class="app">${demoBar()}<header class="top"><h1 class="title" style="font-size:22px">경기</h1></header>
<div class="chips">${gradeChips(false)}</div>
<div class="cols"><div class="col"><section class="dark row" style="margin:12px 20px 0;gap:16px"><div class="qr" style="width:96px;height:96px;flex:0 0 96px">${qrSvg(`${BASE}?v=${S.tid}${DQ}`)}</div>
<div class="stack grow" style="gap:8px"><b>학생용 화면 QR</b><span class="note">로그인 없이 출전 명단과 점수를 실시간으로 봅니다.</span><button class="btn sm white" style="align-self:flex-start" data-act="showQR">크게 띄우기</button></div></section>
<div class="grid2" style="margin:10px 20px 0"><a class="btn sm" href="${BASE}?b=${S.tid}${DQ}">전광판 모드</a><button class="btn sm" data-act="copy" data-text="${BASE}?b=${S.tid}${DQ}" data-msg="전광판 주소를 복사했습니다.">전광판 주소 복사</button></div></div>
<div class="col"><section class="pad stack" style="padding-top:14px;padding-bottom:16px">${gr ? `<div class="row between"><h2 class="h2">${esc(gr.label)} 경기</h2><span class="small muted">${games.length}경기</span></div>
${games.map((g) => gameCard(g, `#game/${g.id}`)).join('') || `<p class="note">${teamsOk ? (Object.keys(teamsOf(gr.id)).length < 2 ? '먼저 홈의 "팀 명단"에서 팀을 두 팀 이상 만들어 주세요.' : '아래 단추로 첫 경기를 만들어 보세요.') : '아직 경기가 없습니다.'}</p>`}
${teamsOk ? `<button class="btn sm dash" data-act="addGame">+ 경기 추가</button>` : ''}
${liveElse.length ? `<h2 class="h2" style="margin-top:10px">다른 학년에서 진행 중</h2>${liveElse.map((g) => `<div class="label">${esc(T().grades[g.gid].label)} ${esc(L.sportName(T().grades[g.gid]))}</div>${gameCard(g, `#game/${g.id}`).replace('class="card game', 'class="other card game')}`).join('')}` : ''}` : '<p class="note">홈에서 학년을 먼저 추가해 주세요.</p>'}</section></div></div>
<div class="spacer"></div>${nav('games')}</div>`;
}

// ---------- 대회 편성 ----------
const planTeams = (gid) => Object.entries(teamsOf(gid)).sort(([, a], [, b]) => String(a.name).localeCompare(String(b.name), 'ko', { numeric: true })).map(([id]) => id);
const stagedOf = (gid) => gamesOf(gid).filter((g) => g.stage);
// 저장된 추첨 순서가 지금 팀 목록과 맞을 때만 쓴다.
const drawOrder = (gr) => { const ids = planTeams(gr.id), o = Array.isArray((gr.plan || {}).order) ? gr.plan.order : Object.values((gr.plan || {}).order || {}); return o.length === ids.length && ids.every((t) => o.includes(t)) ? o : null; };
const planOf = (gr) => P.normPlan(gr.plan, planTeams(gr.id).length);

// 추첨 결과 그림. at 이 있으면 그 시각부터 한 팀씩 차례로 나타난다(전광판 추첨).
function drawView(gr, order, at) {
  const plan = planOf(gr), n = order.length, step = 1.3;
  const el = at ? (S.store.now() - at) / 1000 : 1e6;
  const chip = (t, extra = '') => { const i = order.indexOf(t); return `<button class="dteam${S.swap === t ? ' on' : ''}${at ? ' pop' : ''}" ${at ? `style="animation-delay:${(i * step - el + 1).toFixed(2)}s"` : ''} data-act="swapTeam" data-team="${t}"${at ? ' disabled' : ''}>${extra}${esc(teamName(t))}</button>`; };
  if (plan.mode === 'groups') {
    return `<div class="dgroups" style="grid-template-columns:repeat(${Math.min(plan.groups, 4)},minmax(0,1fr))">${P.groupsOf(plan, order).map((ids, g) => `<div class="dgroup"><b>${P.groupName(g)}</b>${ids.map((t) => chip(t)).join('')}</div>`).join('')}</div>`;
  }
  if (plan.mode === 'ring') {
    return `<div class="dring" style="--n:${n}">${order.map((t, i) => `<div class="dseat" style="--i:${i}">${chip(t)}</div>`).join('')}<div class="dmid">옆자리 팀과<br>한 번씩</div></div>`;
  }
  if (plan.mode === 'cup') {
    let k = 0; const games = Object.values(P.buildGames(plan, order, gr.id, () => `p${k++}`, 1, L.newGame));
    const first = Math.max(...games.map((g) => g.round)), inFirst = games.filter((g) => g.round === first);
    const playing = new Set(inFirst.flatMap((g) => [g.a, g.b]));
    const byes = order.filter((t) => !playing.has(t));
    return `<div class="dcup">${inFirst.map((g) => `<div class="dpair"><span class="label">${esc(g.label)}</span>${chip(g.a)}<span class="muted">vs</span>${chip(g.b)}</div>`).join('')}${byes.length ? `<div class="dpair"><span class="label">부전승</span>${byes.map((t) => chip(t)).join('')}</div>` : ''}</div>`;
  }
  if (plan.mode === 'swiss') return `<div class="dcup">${Array.from({ length: Math.floor(n / 2) }, (_, i) => `<div class="dpair"><span class="label">스위스 1R</span>${chip(order[i * 2])}<span class="muted">vs</span>${chip(order[i * 2 + 1])}</div>`).join('')}</div>`;
  return `<div class="dcup"><div class="dpair">${order.map((t) => chip(t)).join('')}</div></div>`;
}

function groupTables(gr) {
  const games = gamesOf(gr.id), teams = teamsOf(gr.id);
  const grps = [...new Set(games.filter((g) => g.stage === 'G').map((g) => g.grp || 0))].sort((a, b) => a - b);
  const cols = '28px minmax(0,1fr) 30px 30px 30px 30px 38px';
  return grps.map((grp) => {
    const t = P.groupTable(games, teams, grp), name = t.games[0].label;
    return `<div class="stack" style="gap:6px"><h2 class="h2">${esc(name)} 순위 <span class="small muted" style="font-weight:500">· ${t.done ? '예선 끝' : '끝난 경기 기준'}</span></h2><div class="card tbl"><div class="tr th" style="grid-template-columns:${cols}"><span>순위</span><span class="l">팀</span><span>경기</span><span>승</span><span>무</span><span>패</span><span>승점</span></div>${t.rows.map((r) => `<div class="tr" style="grid-template-columns:${cols}"><b class="num">${r.rank}</b><b class="l">${esc(r.name)}</b><span>${r.p}</span><span>${r.w}</span><span>${r.d}</span><span>${r.l}</span><b>${r.pts}</b></div>`).join('')}</div></div>`;
  }).join('');
}

function swissBox(gr) {
  const games = gamesOf(gr.id);
  if (!games.some((g) => g.stage === 'S')) return '';
  const { rows, W } = P.swissTable(games, teamsOf(gr.id));
  const round = Math.max(...games.filter((g) => g.stage === 'S').map((g) => g.round));
  const cols = 'minmax(0,1fr) 40px 40px 76px', names = { in: '결선 진출', out: '탈락', play: '진행 중' };
  return `<div class="stack" style="gap:6px"><h2 class="h2">스위스 순위 <span class="small muted" style="font-weight:500">· ${W}승 진출 · ${W}패 탈락 · ${round}라운드</span></h2><div class="card tbl"><div class="tr th" style="grid-template-columns:${cols}"><span class="l">팀</span><span>승</span><span>패</span><span>상태</span></div>${rows.map((r) => `<div class="tr" style="grid-template-columns:${cols}"><b class="l${r.state === 'out' ? ' muted' : ''}">${esc(r.name)}</b><span>${r.w}</span><span>${r.l}</span><span class="${r.state === 'in' ? 'bold' : 'muted'}">${names[r.state]}</span></div>`).join('')}</div>
${games.some((g) => g.stage === 'K') ? '' : '<span class="small muted">스위스가 끝나면 결선 대진을 추첨합니다. 무패로 올라온 두 팀은 결승에서만 만나게 양 끝에 놓입니다.</span>'}</div>`;
}

function bracketList(gr) {
  const ko = gamesOf(gr.id).filter((g) => g.stage === 'K');
  if (!ko.length) return '';
  const side = (g, s) => { const w = P.winnerOf(g); return `<span class="${P.isOpen(g[s]) ? 'muted' : w === s ? 'bold' : ''}">${esc(teamName(g[s]))}</span>`; };
  return `<div class="stack" style="gap:6px"><h2 class="h2">결선 대진</h2><div class="card tbl">${ko.map((g) => `<div class="tr" style="grid-template-columns:76px minmax(0,1fr) 56px minmax(0,1fr)"><span class="l label">${esc(g.label)}</span>${side(g, 'a')}<b class="num">${g.status === 'ready' ? 'vs' : `${g.sa} : ${g.sb}`}</b>${side(g, 'b')}</div>`).join('')}</div></div>`;
}

function planScreen() {
  const gr = grade();
  if (!gr) return homeScreen();
  const ids = planTeams(gr.id), n = ids.length, info = P.planInfo(gr.plan, n), plan = info.plan, staged = stagedOf(gr.id), order = drawOrder(gr);
  const showing = T().display && T().display.mode === 'draw' && T().display.gid === gr.id;
  const boardBtn = `<button class="btn sm" data-act="drawBoard">${showing ? '전광판 추첨 닫기' : '전광판에 추첨 띄우기'}</button>`;
  let body;
  if (staged.length) {
    const started = staged.some((g) => g.status !== 'ready');
    body = `<div class="card p stack"><b>${esc(P.MODES[plan.mode])}</b><span class="note">${esc(info.text)}</span><span class="small muted">편성된 경기 ${staged.length}개는 "경기" 탭에 있습니다. ${plan.mode === 'swiss' ? '한 라운드가 모두 끝나면 승패가 같은 팀끼리 추첨해 다음 라운드를 자동으로 짭니다. 이미 만난 팀은 되도록 피합니다.' : '예선이나 앞 경기가 끝나면 결선 자리에 팀이 자동으로 들어갑니다.'}</span>
<div class="grid2">${order && plan.mode !== 'league' ? boardBtn : ''}<button class="btn sm" data-act="planSync">${plan.mode === 'swiss' ? '다음 라운드 · 결선 짜기' : '결선 자리 다시 채우기'}</button></div></div>
${groupTables(gr)}${swissBox(gr)}${bracketList(gr)}
<button class="btn plain" data-act="planClearAsk">${started ? '시작하지 않은 편성 경기 지우기' : '편성 지우고 다시 짜기'}</button>`;
  } else {
    const stepper = (key, val, unit, min, max, label) => `<div class="stepper"><button data-act="planStep" data-key="${key}" data-d="-1" data-min="${min}" data-max="${max}" aria-label="${label} 줄이기">−</button><b>${val}${unit}</b><button data-act="planStep" data-key="${key}" data-d="1" data-min="${min}" data-max="${max}" aria-label="${label} 늘리기">+</button></div>`;
    const opts = `${plan.mode === 'groups' ? `<div class="set"><span>조 개수</span>${stepper('groups', plan.groups, '개 조', 2, Math.max(2, Math.min(8, Math.floor(n / 2))), '조 개수')}</div><div class="set"><span>조마다 결선에 오르는 팀</span>${stepper('adv', plan.adv, '팀', 1, 4, '조별 진출 팀')}</div>` : ''}
${plan.mode === 'ring' ? `<div class="set"><span>결선에 오르는 팀</span>${stepper('adv', plan.adv, '팀', 2, Math.max(2, n - 1), '결선 진출 팀')}</div>` : ''}
${info.ent >= 4 ? `<div class="set"><span>3·4위전</span><div class="seg"><button class="${plan.third ? 'on' : ''}" data-act="planSet" data-key="third" data-val="1">함</button><button class="${plan.third ? '' : 'on'}" data-act="planSet" data-key="third" data-val="">안 함</button></div></div>` : ''}`;
    const ok = !info.problems.length;
    body = `<div class="card stack" style="gap:0"><div class="set" style="flex-wrap:wrap;gap:8px"><span>대회 방식</span><div class="modes">${Object.entries(P.MODES).map(([k, t]) => `<button class="chip${plan.mode === k ? ' on' : ''}" data-act="planSet" data-key="mode" data-val="${k}">${t}</button>`).join('')}</div></div>
<div class="set"><span class="note">${esc(P.MODE_NOTES[plan.mode])}</span></div>${opts}</div>
<div class="card p stack"><span class="label">이렇게 짜집니다 · ${n}팀</span>${ok ? `<b>${esc(info.text)}</b><span class="small muted">모두 ${info.total}경기${info.ent ? ' · 결선이 동점으로 끝나면 연장을 열거나 승자를 고릅니다' : ''}</span>` : `<b style="color:#B42318">${esc(info.problems[0])}</b>`}</div>
${ok && plan.mode !== 'league' ? `<div class="card p stack"><div class="row between"><b>추첨</b>${order ? '<span class="small muted">두 팀을 차례로 누르면 자리를 바꿉니다</span>' : ''}</div>
${order ? drawView(gr, order) : '<span class="note">팀을 무작위로 섞어 자리에 넣습니다.</span>'}
<div class="grid2"><button class="btn sm ${order ? '' : 'primary'}" data-act="planDraw">${order ? '다시 뽑기' : '추첨하기'}</button>${order ? boardBtn : ''}</div></div>` : ''}
${ok ? `<button class="btn primary big" data-act="planMake"${plan.mode !== 'league' && !order ? ' disabled' : ''}>${plan.mode !== 'league' && !order ? '추첨한 뒤 경기를 짤 수 있습니다' : `이대로 경기 ${info.total}개 짜기`}</button>` : ''}
${gamesOf(gr.id).length ? `<p class="note">지금 있는 경기 ${gamesOf(gr.id).length}개는 그대로 두고 그 뒤에 이어서 짭니다.</p>` : ''}`;
  }
  return `${homeTop('plan')}<div class="tabbody narrowin"><div class="pad stack" style="padding-top:12px;gap:12px">${n < 2 ? '<p class="note">먼저 "팀 명단"에서 팀을 두 팀 이상 만들어 주세요.</p>' : body}</div></div><div class="spacer"></div>${nav('home')}</div>`;
}

// 예선이나 앞 경기 결과에 맞춰 결선 자리의 팀을 채운다(되돌려야 하면 되돌린다).
async function syncBracket(gid) {
  let games = gamesOf(gid);
  const gr = (T().grades || {})[gid];
  // 스위스: 라운드가 끝났으면 다음 라운드(또는 결선)를 짠다. 경기를 새로 만드는 일이라 팀 명단 권한이 있어야 한다.
  if (gr && canTeams() && games.some((g) => g.stage === 'S') && !syncBracket.busy) {
    syncBracket.busy = true;
    try {
      const more = P.swissNext(games, teamsOf(gid), P.normPlan(gr.plan, Object.keys(teamsOf(gid)).length), gid, S.store.id, Math.max(0, ...games.map((g) => g.no)) + 1, L.newGame);
      if (Object.keys(more).length) { await S.store.update(`t/${S.tid}/games`, more); toast(Object.values(more)[0].stage === 'S' ? `${Object.values(more)[0].label} 경기를 짰습니다.` : '스위스가 끝나 결선 대진을 추첨했습니다.'); games = gamesOf(gid); }
    } catch (e) { /* 다음 기회에 다시 */ } finally { syncBracket.busy = false; }
  }
  if (!games.some((g) => g.stage === 'K')) return;
  const up = {}, res = P.resolve(games, teamsOf(gid));
  for (const [id, sides] of Object.entries(res)) for (const [s, v] of Object.entries(sides)) up[`${id}/${s}`] = v;
  if (Object.keys(up).length) await S.store.update(`t/${S.tid}/games`, up).catch(() => {});
}

function controls(g, gr) {
  const n = L.partCount(gr, g), last = g.cur >= n - 1;
  const clockBtn = L.hasClock(gr) ? `<button class="btn primary" data-act="gClock" data-id="${g.id}"${g.clock.left <= 0 && !g.clock.run ? ' disabled' : ''}>${g.clock.run ? '일시 정지' : g.clock.left <= 0 ? '시간 종료' : '시계 시작'}</button>` : '';
  let next;
  if (L.isTimed(gr)) next = last ? '경기 종료' : `${L.partName(gr, g.cur)} 끝내기`;
  else if (gr.format === 'innings') next = last && g.half ? '경기 종료' : '공수 교대';
  else next = `${g.cur + 1}세트 끝내기`;
  const nextBtn = `<button class="btn${clockBtn ? '' : ' primary'}" data-act="${next === '경기 종료' ? 'gEndAsk' : 'gNext'}" data-id="${g.id}">${next}</button>`;
  const endBtn = next === '경기 종료' ? '' : `<button class="btn plain" data-act="gEndAsk" data-id="${g.id}">경기 바로 끝내기</button>`;
  return `<section class="grid2" style="margin:10px 20px 0">${clockBtn}${nextBtn}${clockBtn ? '' : endBtn ? `<button class="btn" data-act="gEndAsk" data-id="${g.id}">경기 끝내기</button>` : ''}</section>${clockBtn && endBtn ? `<div class="center">${endBtn}</div>` : ''}`;
}

function cardsRow(g, gr) {
  const one = (side) => {
    const left = L.cardsLeft(g, gr, side), cards = Number(gr.cards) || 0;
    const pips = cards ? `<span class="row" style="gap:4px" aria-hidden="true">${Array.from({ length: cards }, (_, i) => `<span style="width:10px;height:14px;border-radius:3px;${i < left ? `background:var(--${side === 'a' ? 'blue' : 'orange'})` : 'border:1px solid #6B7280'}"></span>`).join('')}</span>` : '';
    return `<div class="card p stack" style="gap:6px"><div class="row between"><span class="label">${esc(teamName(g[side]))}</span>${pips}</div><b style="font-size:17px">${cards ? `교체 카드 ${left}장 남음` : '교체 제한 없음'}</b><a class="btn sm ${side === 'a' ? 'blue' : 'orange'}" href="#sub/${g.id}/${side}">선수 교체</a></div>`;
  };
  return `<section class="grid2" style="margin:10px 20px 0">${one('a')}${one('b')}</section>`;
}

function gameScreen(id) {
  const g = gameOf(id);
  if (!g) return `<div class="app"><div class="bar"><a class="back" href="#games">‹ 경기</a></div><p class="note pad">경기를 찾을 수 없습니다.</p></div>`;
  const gr = T().grades[g.gid];
  const head = `<header class="bar"><a class="back" href="#games">‹ 경기</a><b style="font-size:15px">${g.no}경기${g.label ? ` · ${esc(g.label)}` : ''}${g.status === 'live' ? ` · ${L.partName(gr, g.cur, g.half)}` : ''}</b><span class="pill">${g.status === 'live' ? '<span class="dot"></span>' : ''}${statusText(g)}</span></header>`;
  const logs = logsOf(id);
  const logBox = logs.length ? `<section class="pad stack" style="gap:4px;margin-top:12px"><h2 class="label">경기 기록 · 득점 기록을 누르면 넣은 선수를 고칠 수 있습니다</h2>${logs.slice(0, g.status === 'done' ? 40 : 6).map(L.usesPicker(gr) ? teacherLogRow(g.id) : logRow).join('')}</section>` : '';
  const tied = g.status === 'done' && (g.stage === 'K' || g.stage === 'S') && g.sa === g.sb;
  const tieBox = tied ? `<section class="pad" style="margin-top:12px"><div class="card p stack" style="border-color:#C2410C;background:#FFF4E5"><b>${g.win ? `동점 · ${esc(teamName(g[g.win]))} 승리로 정했습니다` : (g.stage === 'S' ? '동점입니다. 스위스는 승패가 있어야 다음 라운드를 짤 수 있습니다.' : '동점입니다. 결선은 승자가 있어야 다음 경기가 정해집니다.')}</b>
<div class="grid2"><button class="btn sm primary" data-act="gExtend" data-id="${g.id}">연장 열기</button><button class="btn sm" data-act="winAsk" data-id="${g.id}">${g.win ? '승자 바꾸기' : '승자 고르기'}</button></div><span class="small muted">연장은 시간제 종목은 한 구간의 절반, 그 밖의 종목은 한 세트·한 회를 더 합니다. 승부차기 등으로 정했다면 승자를 골라 주세요.</span></div></section>` : '';
  if (g.status === 'ready') {
    const inn = gr.format === 'innings';
    const sentRos = (side) => { const list = orderList(id, side, g), P = Object.fromEntries(playersOf(g[side]).map((p) => [p.pid, p])); return `<div class="card lineup ${side}"><b class="t${side}">${esc(teamName(g[side]))}</b><span class="label">받은 타순</span>${list.map((pid, i) => `<span><b>${i + 1}번</b> ${esc(P[pid].no)} ${esc(P[pid].name)}</span>`).join('')}<span class="label">교체</span>${playersOf(g[side]).filter((p) => !list.includes(p.pid)).map((p) => `<span class="muted"><b>${esc(p.no)}</b> ${esc(p.name)}</span>`).join('') || '<span class="muted">없음</span>'}</div>`; };
    const anySent = inn && (orderList(id, 'a', g).length || orderList(id, 'b', g).length);
    const ros = (side) => (inn && orderList(id, side, g).length ? sentRos(side) : rosPlain(side));
    const rosPlain = (side) => `<div class="card lineup ${side}"><b class="t${side}">${esc(teamName(g[side]))}</b>${inn ? '<span class="small muted">타순을 아직 안 냄 · 선발이 번호 순으로 섭니다</span>' : ''}${!(inn && orderList(g.id, side, g).length) && preOver(g, side).length ? `<span class="small" style="color:#7A3E00">${preOver(g, side).join(', ')} · 팀 명단에서 맞춰야 시작할 수 있습니다</span>` : ''}<span class="label">선발</span>${preOn(g, side).map((p) => `<span><b>${esc(p.no)}</b> ${esc(p.name)}</span>`).join('') || '<span class="muted">없음</span>'}<span class="label">교체</span>${preBench(g, side).map((p) => `<span class="muted"><b>${esc(p.no)}</b> ${esc(p.name)}</span>`).join('') || '<span class="muted">없음</span>'}</div>`;
    return `<div class="app">${demoBar()}${head}<div class="cols"><div class="col"><section class="dark stack center" style="margin:0 20px"><span class="label">${esc(gr.label)} ${esc(L.sportName(gr))} · ${L.FORMAT_NAMES[gr.format]}</span><div style="font-size:22px;font-weight:900"><span class="ta">${esc(teamName(g.a))}</span> vs <span class="tb">${esc(teamName(g.b))}</span></div>${L.whenText(g) ? `<b>${esc(L.whenText(g))}</b>` : ''}<button class="btn big white block" data-act="gStart" data-id="${id}">경기 시작</button><span class="note">시작하면 지금 팀 명단의 선발·교체가 이 경기에 적용됩니다.${inn ? ' 타순을 낸 팀은 낸 타순대로 섭니다.' : ''}</span>${inn ? `<button class="btn sm block" data-act="orderQR" data-id="${id}">타순 제출 QR 띄우기</button><span class="note">기록 방식: ${gr.detail ? `타석 기록 (${gr.rotate === 'out3' ? '3아웃제' : '전원 타격제'})` : '점수만 · 타석마다 안타·아웃을 기록하려면 시작하기 전에 "종목·규칙"에서 타석 기록으로 바꿔 주세요'}</span>` : ''}</section>${canTeams() ? `<div class="grid2" style="margin:12px 20px 0"><button class="btn sm" data-act="whenAsk" data-id="${id}">일정 ${L.whenText(g) ? '바꾸기' : '넣기'}</button><button class="btn sm plain" data-act="delGame" data-id="${id}">이 경기 지우기</button></div>${anySent ? `<div class="center"><button class="btn plain" data-act="orderClear" data-id="${id}">받은 타순 지우기</button></div>` : ''}` : ''}</div>
<div class="col"><section class="grid2" style="margin:12px 20px 0">${ros('a')}${ros('b')}</section></div></div>${nav('games')}</div>`;
  }
  const liveNow = g.status === 'live';
  const btns = (side) => {
    if (!liveNow) return '';
    if (gr.format === 'dodge') return `<div class="btns"><button class="btn s${side} grow" data-act="dOut" data-id="${id}" data-team="${side}" data-d="-1">아웃 −1</button><button class="btn minus" data-act="dOut" data-id="${id}" data-team="${side}" data-d="1" aria-label="${esc(teamName(g[side]))} 한 명 되살아남">+1</button></div>`;
    if (L.isDetail(g, gr)) return '';
    const steps = L.stepsOf(gr);
    const defend = gr.format === 'innings' && L.attacker(g) !== side;
    return `<div class="btns"><button class="btn minus" data-act="gMinus" data-id="${id}" data-team="${side}" aria-label="${esc(teamName(g[side]))} 점수 1점 빼기">−</button>${steps.map((p) => `<button class="btn s${side} grow" style="padding:0" data-act="gPlus" data-id="${id}" data-team="${side}" data-pts="${p}"${defend ? ' disabled' : ''}>${defend ? '수비 중' : `+${p}${steps.length === 1 ? ' 득점' : ''}`}</button>`).join('')}</div>`;
  };
  let topBox, a, b, hint = '';
  if (L.isTimed(gr)) {
    topBox = `<div class="stack center" style="gap:2px"><span class="label">${liveNow ? '남은 시간' : '최종 점수'}</span>${liveNow ? clockSpan(g, 'clock') : ''}<span class="note">${L.FORMAT_NAMES[gr.format]} · 구간마다 ${gr.minutes}분</span></div>`;
    a = g.sa; b = g.sb; hint = liveNow ? `+를 누르면 득점 선수${gr.assist ? '와 어시스트 선수' : ''}를 고릅니다` : '';
  } else if (gr.format === 'innings') {
    topBox = `<div class="stack center" style="gap:2px"><span class="label">${liveNow ? '지금' : '최종 점수'}</span>${liveNow ? `<b style="font-size:24px">${L.partName(gr, g.cur, g.half)} · ${esc(teamName(g.half ? g.b : g.a))} 공격</b>` : ''}<span class="note">${gr.innings}회 경기 · ${L.isDetail(g, gr) ? `${gr.rotate === 'out3' ? '3아웃제' : '전원 타격제'} · 타석 결과를 누르면 점수가 자동으로 올라갑니다` : '공격하는 팀만 점수를 올릴 수 있습니다'}</span></div>`;
    a = g.sa; b = g.sb;
  } else if (gr.format === 'sets') {
    topBox = `<div class="stack center" style="gap:2px"><span class="label">세트 스코어</span><span class="num" style="font-size:44px">${g.sa} : ${g.sb}</span><span class="note">${gr.sets}세트 중 ${Math.floor(gr.sets / 2) + 1}세트 먼저 · 세트마다 ${gr.setPoints}점</span></div>`;
    a = liveNow ? g.pa[g.cur] : g.sa; b = liveNow ? g.pb[g.cur] : g.sb;
    if (liveNow && Math.max(a, b) >= Number(gr.setPoints)) hint = `${gr.setPoints}점이 됐습니다. 세트를 끝내려면 아래 "${g.cur + 1}세트 끝내기"를 누르세요.`;
  } else {
    topBox = `<div class="grid2 center"><div class="stack" style="gap:2px"><span class="label">세트 스코어</span><span class="num" style="font-size:44px">${g.sa} : ${g.sb}</span><span class="note">${gr.sets}세트 중 ${Math.floor(gr.sets / 2) + 1}세트 먼저</span></div><div class="stack" style="gap:2px"><span class="label">${g.ext ? '연장' : '세트 남은 시간'}</span><span style="font-size:44px;line-height:1">${clockSpan(g, '')}</span><span class="note">한 세트 ${gr.minutes}분</span></div></div>`;
    a = liveNow ? g.remain.a : g.sa; b = liveNow ? g.remain.b : g.sb;
    hint = liveNow ? (g.ext ? '연장입니다. 먼저 한 명을 아웃시키는 팀이 이깁니다.' : `숫자는 남은 인원입니다. 0명이 되면 세트가 바로 끝납니다.${gr.outDetail ? ' 아웃을 누르면 선수를 고릅니다.' : ''}`) : '';
  }
  const tie = g.tie ? `<section class="card p stack" style="margin:10px 20px 0;border:2px solid var(--ink)"><b style="font-size:17px">시간 종료 · 남은 인원이 같습니다 (${g.remain.a} : ${g.remain.b})</b><span class="note">이 세트를 어떻게 할까요?</span><div class="grid2"><button class="btn primary" data-act="dTie" data-id="${id}" data-choice="draw">무승부로 끝내기</button><button class="btn" data-act="dTie" data-id="${id}" data-choice="ext">연장 하기</button></div></section>` : '';
  const role = (side) => (liveNow && gr.format === 'innings' ? ` <span class="tagbox" style="${L.attacker(g) === side ? 'background:#fff;color:var(--ink)' : 'background:transparent;border:1px solid #6B7280;color:var(--dim)'}">${L.attacker(g) === side ? '공격' : '수비'}</span>` : '');
  const board = `<section class="dark stack" style="margin:0 20px;gap:10px">${topBox}<div class="score">
<div><span class="name ta">${esc(teamName(g.a))}${role('a')}</span><span class="num big" data-score="a">${a}</span>${btns('a')}</div>
<div><span class="name tb">${esc(teamName(g.b))}${role('b')}</span><span class="num big" data-score="b">${b}</span>${btns('b')}</div></div>${hint ? `<span class="note center">${hint}</span>` : ''}</section>`;
  const table = partsTable(g, gr);
  return `<div class="app">${demoBar()}${head}<div class="cols"><div class="col">${board}${tieBox}${tie}${liveNow && L.isDetail(g, gr) ? batBox(g, gr) : ''}${liveNow && !g.tie ? controls(g, gr) : ''}</div><div class="col">${liveNow ? cardsRow(g, gr) : ''}${table ? `<section style="margin:10px 20px 0">${table}</section>` : ''}${logBox}${canTeams() ? `<div class="center mt"><button class="btn plain" data-act="delGame" data-id="${id}">이 경기 지우기</button></div>` : ''}</div></div><div style="height:16px"></div>${nav('games')}</div>`;
}

function subScreen(id, side) {
  const g = gameOf(id);
  if (!g || g.status !== 'live') return gameScreen(id);
  const gr = T().grades[g.gid];
  const left = L.cardsLeft(g, gr, side), cards = Number(gr.cards) || 0;
  const sel = S.sub.id === id && S.sub.side === side ? S.sub : (S.sub = { id, side });
  const on = lineupOf(g, side, 'on'), bench = lineupOf(g, side, 'bench'), out = lineupOf(g, side, 'out');
  const pl = (p, kind) => `<button class="pl${sel[kind] === p.pid ? ' on' : ''}" data-act="subPick" data-kind="${kind}" data-pid="${p.pid}" aria-pressed="${sel[kind] === p.pid}"><b>${esc(p.no)}</b>${esc(p.name)}</button>`;
  const pOut = on.find((p) => p.pid === sel.out), pIn = bench.find((p) => p.pid === sel.in);
  const subs = logsOf(id).filter((l) => l.type === 'sub' && l.team === side);
  return `<div class="app">${demoBar()}<header class="bar" style="justify-content:flex-start"><a class="back" href="#game/${id}">‹ 경기로</a><h1>선수 교체 · <span class="t${side}">${esc(teamName(g[side]))}</span></h1></header>
<div class="cols"><div class="col"><section class="dark row between" style="margin:4px 20px 0"><div class="stack" style="gap:2px"><span class="label">교체 카드</span><b style="font-size:20px">${cards ? `${left}장 남음` : '제한 없음'}</b><span class="note">${cards ? `${cards}장 중 ${cards - left}장 사용 · 자동으로 셉니다` : '설정에서 교체 카드 수를 0으로 두었습니다'}</span></div></section>
<section class="pad stack" style="padding-top:16px"><h2 class="h2" style="font-size:14px">나가는 선수 <span class="muted" style="font-weight:500">· 지금 뛰는 ${on.length}명</span></h2><div class="grid2" style="gap:8px">${on.map((p) => pl(p, 'out')).join('')}</div></section>
<section class="pad stack" style="padding-top:16px"><h2 class="h2" style="font-size:14px">들어가는 선수 <span class="muted" style="font-weight:500">· 대기 중</span></h2><div class="grid2" style="gap:8px">${bench.map((p) => pl(p, 'in')).join('')}${out.map((p) => `<button class="pl off" disabled><b>${esc(p.no)}</b>${esc(p.name)} · 나감</button>`).join('')}</div>${bench.length ? '' : '<p class="note">들어갈 수 있는 선수가 없습니다.</p>'}</section>
</div><div class="col">${subs.length ? `<section class="pad stack" style="gap:4px;margin-top:14px"><h2 class="label">이번 경기 교체 기록</h2>${subs.map(logRow).join('')}</section>` : ''}
<div class="pad stack" style="padding-top:16px;padding-bottom:20px"><div class="card p row between"><div class="stack" style="gap:2px"><span class="label">나감</span><b>${pOut ? `${esc(pOut.no)} ${esc(pOut.name)}` : '고르세요'}</b></div><b aria-hidden="true">→</b><div class="stack right" style="gap:2px"><span class="label t${side}">들어감</span><b>${pIn ? `${esc(pIn.no)} ${esc(pIn.name)}` : '고르세요'}</b></div></div>
<button class="btn primary big block" data-act="subGo"${pOut && pIn && left > 0 ? '' : ' disabled'}>${left > 0 ? `교체 확정${cards ? ' · 카드 1장 사용' : ''}` : '교체 카드를 모두 썼습니다'}</button><p class="note center">확정하면 경기 기록에 남고, 학생 화면 명단도 바로 바뀝니다.</p></div></div></div><div class="spacer"></div>${nav('games')}</div>`;
}

function teamsScreen() {
  const gr = grade();
  if (!gr) return `${homeTop('teams')}<p class="note pad">홈에서 학년을 먼저 추가해 주세요.</p><div class="spacer"></div>${nav('home')}</div>`;
  const teams = teamsOf(gr.id), ids = Object.keys(teams);
  if (!teams[S.teamId]) S.teamId = ids[0] || null;
  const t = teams[S.teamId], ps = t ? playersOf(S.teamId) : [];
  const starters = ps.filter((p) => slotOf(p) === 'on').length, benchN = ps.filter((p) => slotOf(p) === 'bench').length, issues = t ? rosterIssues(S.teamId, gr) : [];
  const card = t ? `<section class="card" style="margin:12px 20px 0"><div class="set"><label for="t-name">팀 이름</label><input id="t-name" class="input" value="${esc(t.name)}" maxlength="20" data-change="teamName"></div>
<div class="set" style="border-bottom:1px solid var(--line)"><span class="muted small">선수 ${ps.length}명 · 선발 ${starters}/${gr.starters} · 후보 ${benchN}${Number(gr.subs) ? `/${gr.subs}` : ''} · 빠짐 ${ps.length - starters - benchN}</span></div>
${issues.length ? `<div class="set" style="flex-wrap:wrap;background:#FFF4E5;border-bottom:1px solid var(--line)"><b style="color:#7A3E00">${issues.join(', ')}. 맞춰야 경기를 시작할 수 있습니다.</b><button class="btn sm primary" data-act="trimStarters">번호 순으로 맞추기</button></div>` : ''}
${ps.map((p) => `<div class="prow"><span class="no">${esc(p.no)}</span><span class="grow">${esc(p.name)}</span><div class="seg">${[['on', '선발'], ['bench', '후보'], ['off', '빠짐']].map(([k, n]) => `<button class="${slotOf(p) === k ? 'on' : ''}" data-act="setBench" data-pid="${p.pid}" data-slot="${k}" aria-pressed="${slotOf(p) === k}">${n}</button>`).join('')}</div><button class="x" data-act="delPlayer" data-pid="${p.pid}" aria-label="${esc(p.name)} 지우기">×</button></div>`).join('')}
<div class="prow" style="gap:6px;padding:8px"><input id="p-no" class="input" style="width:64px" inputmode="numeric" placeholder="번호" maxlength="3" aria-label="등번호"><input id="p-name" class="input" placeholder="이름" maxlength="12" aria-label="선수 이름" data-enter="addPlayer"><button class="btn sm primary" style="flex:0 0 auto;white-space:nowrap" data-act="addPlayer">추가</button></div>
<div class="grid2" style="padding:0 8px 8px"><button class="btn sm" data-act="importAsk">학교 명단에서 불러오기</button><button class="btn sm" data-act="pasteAsk">명단 붙여넣기</button></div>
<div class="center" style="padding-bottom:6px"><button class="btn sm plain" data-act="delTeam">이 팀 지우기</button></div></section>` : `<p class="note pad mt">"+ 팀 추가"로 팀을 만들어 주세요.</p>`;
  return `${homeTop('teams')}<div class="tabbody narrowin">
<div class="chips">${ids.map((id) => `<button class="chip${id === S.teamId ? ' on' : ''}" data-act="pickTeam" data-id="${id}">${esc(teams[id].name)}</button>`).join('')}<button class="chip dash" data-act="addTeam">+ 팀 추가</button></div>${card}
<p class="note pad" style="padding-top:10px;padding-bottom:16px">선발과 교체는 경기 전에 정해 두면, 경기를 시작할 때 그대로 적용됩니다.</p></div><div class="spacer"></div>${nav('home')}</div>`;
}

function rulesScreen() {
  const gr = grade();
  const stepper = (key, val, unit, min, max, label) => `<div class="stepper"><button data-act="step" data-key="${key}" data-d="-1" data-min="${min}" data-max="${max}" aria-label="${label} 줄이기">−</button><b>${val}${unit}</b><button data-act="step" data-key="${key}" data-d="1" data-min="${min}" data-max="${max}" aria-label="${label} 늘리기">+</button></div>`;
  const seg = (key, val, opts) => `<div class="seg" style="margin-right:6px">${opts.map(([v, t]) => `<button class="${String(val) === String(v) ? 'on' : ''}" data-act="setGrade" data-key="${key}" data-val="${v}" aria-pressed="${String(val) === String(v)}">${t}</button>`).join('')}</div>`;
  let rules = '';
  if (gr) {
    const f = gr.format, sp = L.SPORTS[gr.sport] || L.SPORTS.custom;
    rules = `<section class="card" style="margin:4px 20px 0">
<div class="set"><label for="g-label">학년 이름</label><input id="g-label" class="input" value="${esc(gr.label)}" maxlength="12" data-change="gradeField" data-key="label"></div>
<div class="set"><label for="g-sport">종목</label><select id="g-sport" class="input" data-change="gradeSport">${Object.entries(L.SPORTS).map(([k, s]) => `<option value="${k}"${k === gr.sport ? ' selected' : ''}>${s.name}</option>`).join('')}</select></div>
${gr.sport === 'custom' ? `<div class="set"><label for="g-sname">종목 이름</label><input id="g-sname" class="input" value="${esc(gr.sportName || '')}" maxlength="12" placeholder="예: 킨볼" data-change="gradeField" data-key="sportName"></div>` : ''}
<div class="set"><label for="g-format">경기 방식</label><select id="g-format" class="input" data-change="gradeField" data-key="format">${sp.formats.map((k) => `<option value="${k}"${k === f ? ' selected' : ''}>${L.FORMAT_NAMES[k]}</option>`).join('')}</select></div>
${L.hasClock(gr) ? `<div class="set"><span>${f === 'dodge' ? '한 세트 시간' : f === 'single' ? '경기 시간' : '구간마다 시간'}</span>${stepper('minutes', gr.minutes, '분', 1, 60, '시간')}</div>` : ''}
${f === 'dodge' ? `<div class="set"><span>아웃 기록</span>${seg('outDetail', gr.outDetail ? 1 : 0, [[1, '선수까지'], [0, '인원만']])}</div>` : ''}
${f === 'sets' || f === 'dodge' ? `<div class="set"><span>세트 수</span>${stepper('sets', gr.sets, '세트', 1, 9, '세트 수')}</div>` : ''}
${f === 'sets' ? `<div class="set"><span>세트 점수</span>${stepper('setPoints', gr.setPoints, '점', 5, 50, '세트 점수')}</div>` : ''}
${f === 'innings' ? `<div class="set"><span>이닝 수</span>${stepper('innings', gr.innings, '회', 1, 9, '이닝 수')}</div>
<div class="set"><span>기록 방식</span>${seg('detail', gr.detail ? 1 : 0, [[0, '점수만'], [1, '타석 기록']])}</div>
${gr.detail ? `<div class="set"><span>공수 교대</span>${seg('rotate', gr.rotate || 'all', [['all', '전원 타격제'], ['out3', '3아웃제']])}</div>
<div class="set"><span>최대 진루 <span class="muted">(홈런 제외)</span></span>${stepper('maxAdv', L.maxAdv(gr), '루', 1, 3, '최대 진루')}</div>
<div class="set"><span>지난 공격에서 남은 주자</span>${seg('keepRunners', gr.keepRunners ? 1 : 0, [[1, '다음 공격에 유지'], [0, '비우기']])}</div>` : ''}` : ''}
<div class="set"><span>선발 인원</span>${stepper('starters', gr.starters, '명', 1, 30, '선발 인원')}</div>
<div class="set"><span>후보 인원 <span class="muted">(팀마다 · 0은 제한 없음)</span></span>${stepper('subs', Number(gr.subs) || 0, '명', 0, 30, '후보 인원')}</div>
<div class="set"><span>교체 카드 <span class="muted">(팀마다 · 0은 제한 없음)</span></span>${stepper('cards', gr.cards, '장', 0, 20, '교체 카드')}</div>
<div class="set"><span>나간 선수 다시 들어가기</span>${seg('reentry', gr.reentry ? 1 : 0, [[1, '허용'], [0, '금지']])}</div>
${L.canStep(gr) ? `<div class="set"><span>득점 단추</span>${seg('steps', gr.steps, [['1', '1점씩'], ['123', '1·2·3점']])}</div>` : ''}
${L.isTimed(gr) ? `<div class="set"><span>어시스트 기록</span>${seg('assist', gr.assist ? 1 : 0, [[1, '기록'], [0, '안 함']])}</div>` : ''}</section>
${f === 'innings' && gr.detail ? '<p class="note pad" style="padding-top:6px">타석 기록은 타석마다 결과(1루타, 땅볼 등)를 누르는 방식입니다. 루 상황이 전광판과 학생 화면에 보이고, 안타·타점·득점이 개인 기록에 쌓입니다. 두 팀 모두 선발 명단이 있어야 켜집니다.</p>' : ''}
<p class="note pad" style="padding-top:6px">종목을 바꾸면 규칙이 그 종목 기본값으로 채워집니다. 이미 시작한 경기가 있을 때는 경기 방식을 바꾸지 않는 것이 좋습니다.</p>
<div class="center"><button class="btn plain" data-act="delGradeAsk">${esc(gr.label)} 지우기</button></div>`;
  }
  return `${homeTop('rules')}<div class="tabbody narrowin">
${rules || '<p class="note pad mt">홈에서 학년을 먼저 추가해 주세요.</p>'}</div><div class="spacer"></div>${nav('home')}</div>`;
}

function settingsScreen() {
  return `<div class="app narrow">${demoBar()}<header class="top"><h1 class="title" style="font-size:22px">대회 설정</h1></header>
${canRules() ? `<h2 class="label" style="padding:6px 20px">대회 (모든 학년 공통)</h2><section class="card" style="margin:0 20px"><div class="set"><label for="t-title">대회 이름</label><input id="t-title" class="input" style="flex:1;max-width:none;margin-left:16px;text-align:left" value="${esc(T().meta.name)}" maxlength="40" data-change="tName"></div></section>
<p class="note pad" style="padding-top:6px">학년별 팀 명단과 종목·규칙은 홈에서 학년을 고르면 그 아래에 있습니다.</p>` : `<p class="note pad">내 권한: ${ROLE_NAMES[myRole()] || ''}. 바꾸려면 대회 만든 선생님께 부탁해 주세요.</p>`}
${canTeams() ? `<div class="pad" style="padding-top:10px"><a class="btn sm block" href="#school">학교 명단 등록 (선택)</a><p class="note" style="padding-top:6px">학년·반 명단을 한 번 등록해 두면, 팀 명단을 만들 때 체크해서 불러올 수 있습니다.</p></div>` : ''}
<div class="pad" style="padding-top:10px"><a class="btn sm block" href="#members">함께하는 선생님${isOwner() ? ' · 초대와 권한' : ''}</a></div>
<div class="center mt"><button class="btn plain" data-act="signOut">${S.store.demo ? '미리보기 끝내기' : '구글 계정 로그아웃'}</button></div><div class="spacer"></div><div class="foot">음악적체육인 · v${VERSION}</div>${nav('settings')}</div>`;
}

function schoolScreen() {
  const list = classList();
  if (!S.school[S.classId]) S.classId = (list[0] || {}).id || null;
  const c = S.school[S.classId], ps = c ? studentsOf(S.classId) : [];
  const card = c ? `<section class="card" style="margin:12px 20px 0"><div class="set" style="border-bottom:1px solid var(--line)"><b>${esc(c.name)}</b><span class="muted small" style="margin-right:6px">${ps.length}명</span></div>
${ps.map((p) => `<div class="prow"><span class="no">${esc(p.no)}</span><span class="grow">${esc(p.name)}</span><button class="x" data-act="delStudent" data-sid="${p.sid}" aria-label="${esc(p.name)} 지우기">×</button></div>`).join('')}
<div class="prow" style="gap:6px;padding:8px"><input id="s-no" class="input" style="width:64px" inputmode="numeric" placeholder="번호" maxlength="3" aria-label="번호"><input id="s-name" class="input" placeholder="이름" maxlength="12" aria-label="학생 이름" data-enter="addStudent"><button class="btn sm primary" data-act="addStudent">추가</button></div>
<div class="grid2" style="padding:0 8px 10px"><button class="btn sm" data-act="pasteSchoolAsk">명단 붙여넣기</button><button class="btn sm plain" data-act="delClassAsk">이 반 지우기</button></div></section>` : `<p class="note pad mt">"+ 반 추가"로 반을 만들어 주세요.</p>`;
  return `<div class="app narrow">${demoBar()}<header class="bar" style="justify-content:flex-start"><a class="back" href="#settings">‹ 대회 설정</a><h1>학교 명단 <span class="muted" style="font-size:13px;font-weight:500">· 선택</span></h1></header>
<p class="note pad" style="padding-bottom:10px">학년·반 명단을 한 번 등록해 두면, 팀 명단을 만들 때 체크해서 불러올 수 있습니다. 쓰지 않아도 됩니다. 이 명단은 내 계정에만 저장되고, 학생 화면이나 다른 선생님에게는 보이지 않습니다.</p>
<div class="chips">${list.map((x) => `<button class="chip${x.id === S.classId ? ' on' : ''}" data-act="pickClass" data-id="${x.id}">${esc(x.name)}</button>`).join('')}<button class="chip dash" data-act="addClass">+ 반 추가</button></div>${card}<div style="height:16px"></div>${nav('settings')}</div>`;
}

function membersScreen() {
  const owner = isOwner();
  const list = Object.entries(S.M || {}).sort((a, b) => (a[1].role === 'owner' ? -1 : 1) - (b[1].role === 'owner' ? -1 : 1));
  const codeBox = owner ? `<section class="dark stack" style="margin:4px 20px 0"><span class="label">${esc(T().meta.name)} · 초대 코드</span><span class="num" style="font-size:52px;letter-spacing:.08em">${esc(S.code || '······')}</span><span class="note">초대받은 선생님이 구글로 로그인하고 코드를 넣으면, 이 대회의 경기를 함께 진행할 수 있습니다.</span>
${S.code ? `<div class="row" style="gap:14px"><div class="qr" style="width:120px;height:120px;flex:0 0 120px">${qrSvg(`${BASE}?join=${S.code}`)}</div><span class="note">QR을 찍으면 초대 링크로 바로 들어옵니다. 구글 로그인만 하면 코드를 따로 넣지 않아도 됩니다.</span></div>` : ''}
<div class="grid2"><button class="btn sm white" data-act="copy" data-text="${BASE}?join=${esc(S.code)}" data-msg="초대 링크를 복사했습니다.">초대 링크 복사</button><button class="btn sm" data-act="newCode">코드 새로 만들기</button></div></section>` : '';
  const people = `<section class="pad stack" style="padding-top:18px"><h2 class="h2" style="font-size:14px">참여 중 <span class="muted" style="font-weight:500">· ${list.length}명</span></h2><div class="card">${list.map(([id, m]) => `<div class="set" style="min-height:60px;flex-wrap:wrap"><b>${id === uid() ? '나' : esc(m.name)}</b>${m.role === 'owner' ? '<span class="tagbox" style="margin-right:6px">대회 만든 사람</span>' : owner ? `<span class="row" style="gap:4px"><select class="input" style="max-width:none;text-align:left" aria-label="${esc(m.name)} 권한" data-change="memberRole" data-uid="${id}">${Object.entries(ROLE_NAMES).map(([k, t]) => `<option value="${k}"${(m.role || 'ref') === k ? ' selected' : ''}>${t}</option>`).join('')}</select><button class="btn plain" data-act="kick" data-uid="${id}">내보내기</button></span>` : `<span class="small muted" style="margin-right:6px">${ROLE_NAMES[m.role] || ROLE_NAMES.ref}</span>`}</div>`).join('')}</div></section>`;
  const info = `<section class="card p stack" style="margin:16px 20px 0;gap:6px"><h2 class="h2" style="font-size:13px">선생님마다 권한을 정할 수 있습니다</h2><p class="note"><b>경기 진행만</b>: 경기 시작·종료, 점수, 득점 선수, 선수 교체. 처음 들어오면 이 권한입니다.</p><p class="note"><b>경기 진행 + 팀 명단·경기 일정</b>: 팀과 선수 명단, 경기 추가·삭제·일정, 전광판에 개인 기록 띄우기까지.</p><p class="note"><b>모든 설정</b>: 학년 추가·삭제, 종목·규칙, 대회 이름까지.</p><p class="note">초대, 내보내기, 권한 바꾸기는 대회 만든 사람만 합니다. 한 경기를 여러 선생님이 같이 조작할 수 있습니다.</p></section>`;
  return `<div class="app">${demoBar()}<header class="bar" style="justify-content:flex-start"><a class="back" href="#home">‹ 홈</a><h1>함께하는 선생님</h1></header>
<div class="cols"><div class="col">${codeBox}${owner ? info : people}</div><div class="col">${owner ? people : info}</div></div>
${owner ? '' : `<div class="center mt"><button class="btn plain" data-act="quitT">이 대회에서 나가기</button></div>`}<div class="spacer"></div>${nav('home')}</div>`;
}

// 개인 기록 표의 열. 타석 기록 학년, 어시스트를 쓰는 학년, 그 밖으로 나뉜다.
const recCols = (gr) => (gr.format === 'innings' && gr.detail ? [['타석', 'ab'], ['안타', 'h'], ['타점', 'rbi'], ['득점', 'goals']]
  : L.isTimed(gr) && gr.assist ? [['출전', 'games'], ['득점', 'goals'], ['어시스트', 'as']]
  : gr.format === 'dodge' ? [['출전', 'games'], ['아웃시킴', 'ko'], ['교체 투입', 'subIn']] : [['출전', 'games'], ['득점', 'goals'], ['교체 투입', 'subIn']]);
const recMain = (gr) => (gr.format === 'dodge' ? 'ko' : 'goals');
const recCells = (gr, r, tag) => recCols(gr).map(([, k]) => (k === recMain(gr) ? `<${tag === 'td' ? 'td><b' : 'b'}>${r[k]}</b>${tag === 'td' ? '</td>' : ''}` : `<${tag}>${r[k]}</${tag}>`)).join('');

function recordRows() {
  const gr = grade();
  if (!gr) return [];
  let rows = L.records(T().teams || {}, gamesOf(gr.id), T().logs || {});
  if (S.rec.team) rows = rows.filter((r) => r.teamId === S.rec.team);
  const by = S.rec.sort, m = recMain(gr);
  rows.sort((x, y) => (by === 'no' ? (Number(x.no) || 0) - (Number(y.no) || 0) : by === 'games' ? y.games - x.games || y[m] - x[m] : y[m] - x[m] || y.games - x.games) || String(x.name).localeCompare(String(y.name), 'ko'));
  rows.forEach((r, i) => { const p = rows[i - 1]; r.rank = by === 'goals' && p && p[m] === r[m] ? p.rank : i + 1; });
  return rows;
}

function recordsScreen() {
  const gr = grade(), rows = recordRows(), sel = rows.find((r) => r.key === S.rec.key) || rows[0];
  const shown = T().display && T().display.mode === 'records';
  const tee = gr && gr.format === 'innings' && gr.detail, withAs = gr && L.isTimed(gr) && gr.assist;
  const cols = tee ? '28px minmax(0,1fr) 36px 36px 36px 36px' : '28px minmax(0,1fr) 40px 40px 52px';
  if (!gr) return `${homeTop('records')}<p class="note pad">학년이 없습니다.</p><div class="spacer"></div>${nav('home')}</div>`;
  const filters = `<div class="grid3">${gradeSelect()}<select class="input" aria-label="팀 고르기" data-change="recTeam"><option value="">모든 팀</option>${Object.entries(teamsOf(gr.id)).map(([id, t]) => `<option value="${id}"${S.rec.team === id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
<select class="input" aria-label="정렬" data-change="recSort">${[['goals', gr.format === 'dodge' ? '아웃시킴 순' : '득점 순'], ['games', '출전 순'], ['no', '번호 순']].map(([v, t]) => `<option value="${v}"${S.rec.sort === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`;
  const table = rows.length ? `<div class="card tbl"><div class="tr th" style="grid-template-columns:${cols}"><span>순위</span><span class="l">선수</span>${recCols(gr).map(([t]) => `<span>${t}</span>`).join('')}</div>${rows.map((r) => `<button class="tr${sel && r.key === sel.key ? ' sel' : ''}" style="grid-template-columns:${cols}" data-act="recPick" data-key="${r.key}"><b class="num" style="font-size:20px">${r.rank}</b><span class="l"><b>${esc(r.no)} ${esc(r.name)}</b> <span class="small">${esc(r.team)}</span></span>${recCells(gr, r, 'span')}</button>`).join('')}</div>` : '<p class="note">아직 기록이 없습니다. 경기를 시작하면 자동으로 모입니다.</p>';
  const detail = sel ? `<section class="dark stack"><div class="row between"><b style="font-size:18px">${esc(sel.no)} ${esc(sel.name)}</b><span class="label">${esc(sel.team)}</span></div><div class="grid3 center">${(tee ? [['타석', sel.ab], ['안타', sel.h], ['타점', sel.rbi], ['득점', sel.goals], ['홈런', sel.hr], ['출전 경기', sel.games]] : withAs ? [['출전 경기', sel.games], ['득점', sel.goals], ['어시스트', sel.as]] : gr.format === 'dodge' ? [['출전 경기', sel.games], ['아웃시킴', sel.ko], ['선발 출전', sel.starts]] : [['출전 경기', sel.games], ['득점', sel.goals], ['선발 출전', sel.starts]]).map(([t, v]) => `<div class="stack" style="gap:2px"><span class="num" style="font-size:36px">${v}</span><span class="note">${t}</span></div>`).join('')}</div><div class="note" style="border-top:1px solid #39424F;padding-top:8px;line-height:1.6">${tee ? `1루타 ${sel.h1} · 2루타 ${sel.h2} · 3루타 ${sel.h3} · 홈런 ${sel.hr}<br>` : ''}${sel.detail.map(esc).join('<br>')}</div></section>` : '';
  return `${homeTop('records')}<div class="tabbody"><div class="label" style="padding:12px 20px 0">개인 기록 · 선생님만 볼 수 있습니다</div>
<div class="cols"><div class="col pad stack">${filters}${table}</div>
<div class="col pad stack colgap">${canTeams() ? `<button class="btn ${shown ? '' : 'primary'} block" data-act="recBoard">${shown ? '전광판에서 내리기' : '전광판에 띄워서 보여 주기'}</button>` : ''}${detail}<p class="note">학생 화면(QR)에는 나오지 않습니다. 선생님이 전광판에 띄울 때만 보입니다.</p></div></div></div><div class="spacer"></div>${nav('home')}</div>`;
}

// ---------- 학생 화면 ----------
// 타석 기록 경기에서 지금 타석에 선 선수(공격 팀일 때만). 없으면 빈 글자.
const nowBatter = (g, gr, side) => (g.status === 'live' && L.isDetail(g, gr) && L.attacker(g) === side && !g.halfDone ? L.batterOf(g) : '');

function lineupCard(g, side, gr) {
  const row = (p, cls = '') => `<span class="${cls}"><b>${esc(p.no)}</b> ${esc(p.name)}</span>`;
  const started = g.status !== 'ready';
  const on = started ? lineupOf(g, side, 'on') : preOn(g, side);
  const bench = started ? lineupOf(g, side, 'bench') : preBench(g, side);
  const out = started ? lineupOf(g, side, 'out') : [];
  const cards = Number(gr.cards) || 0;
  const byOrder = started && gr.format === 'innings' && g.order[side].length;
  const P = Object.fromEntries(playersOf(g[side]).map((p) => [p.pid, p])), now = nowBatter(g, gr, side);
  const outNow = (p) => gr.format === 'dodge' && g.status === 'live' && (g.dout[side] || {})[p.pid];
  const row2 = (p) => (outNow(p) ? `<span class="muted" style="text-decoration:line-through"><b>${esc(p.no)}</b> ${esc(p.name)}</span>` : row(p));
  return `<div class="card lineup ${side}"><b class="t${side}">${esc(teamName(g[side]))}</b><span class="label">${byOrder ? '타순' : started ? '뛰는 중' : '선발'}</span>${byOrder ? g.order[side].filter((pid) => P[pid]).map((pid, i) => `<span${pid === now ? ' class="nowbat"' : ''}><b>${i + 1}번</b> ${esc(P[pid].name)}${pid === now ? ' · 타석' : ''}</span>`).join('') : on.map((p) => row2(p)).join('') || '<span class="muted">-</span>'}
<span class="label" style="border-top:1px solid var(--soft);padding-top:6px;margin-top:4px">교체 선수</span>${bench.map((p) => row(p, 'muted')).join('')}${out.map((p) => `<span class="muted"><b>${esc(p.no)}</b> ${esc(p.name)} <span class="small">나감</span></span>`).join('')}${bench.length + out.length ? '' : '<span class="muted">-</span>'}
${started && cards ? `<b class="small" style="padding-top:4px">교체 카드 ${L.cardsLeft(g, gr, side)}장 남음</b>` : ''}</div>`;
}

function liveBlock(g, gr, withLogs = true) {
  const m = mainScore(g, gr);
  const logs = withLogs ? logsOf(g.id).filter((l) => !l.x).slice(0, 6) : [];
  return `<section class="dark stack" style="gap:10px"><div class="row between small bold"><span class="muted">${g.no}경기${g.status === 'live' ? ` · ${L.partName(gr, g.cur, g.half)}` : g.status === 'ready' && L.whenText(g) ? ` · ${esc(L.whenText(g))}` : ''}</span><span class="row" style="gap:6px">${g.status === 'live' ? '<span class="dot"></span>실시간' : statusText(g)}</span></div>
<div class="row between"><b class="grow ta" style="font-size:16px">${esc(teamName(g.a))}</b><span class="num" style="font-size:64px">${g.status === 'ready' ? 'vs' : `${m.a} : ${m.b}`}</span><b class="grow tb right" style="font-size:16px">${esc(teamName(g.b))}</b></div>
${g.status === 'ready' ? '' : `<div class="row" style="justify-content:center;align-items:baseline;gap:8px"><span class="note">${m.sub}</span><span class="num" style="font-size:28px">${m.mid}</span></div>`}${g.status === 'live' && (gr.format === 'dodge' || gr.format === 'sets') ? `<div class="row" style="justify-content:center;gap:10px"><span class="tagbox" style="background:#fff;color:var(--ink);font-size:14px;padding:4px 10px">세트 스코어 ${g.sa} : ${g.sb}</span><span class="note">${gr.sets}세트 중 ${Math.floor(gr.sets / 2) + 1}세트 먼저</span></div>` : ''}</section>
${g.status === 'live' && L.isDetail(g, gr) ? `<section class="card p row" style="gap:14px">${diamond(g, 120)}<div class="stack grow" style="gap:4px"><span class="label">${esc(teamName(g[L.attacker(g)]))} 공격 · 지금 타자</span><b style="font-size:18px">${g.halfDone ? '공격 끝' : esc(batterText(g))}</b><span class="note">${outsText(g, gr)}</span></div></section>` : ''}
${g.status !== 'ready' ? partsTable(g, gr) : ''}
<div class="grid2">${lineupCard(g, 'a', gr)}${lineupCard(g, 'b', gr)}</div>${logs.length ? `<section class="stack" style="gap:4px"><h2 class="h2">경기 기록</h2>${logs.map(logRow).join('')}</section>` : ''}`;
}

function standingsTable(gr) {
  const staged = stagedOf(gr.id);
  if (staged.some((g) => g.stage !== 'L')) return `${groupTables(gr)}${swissBox(gr)}${bracketList(gr)}`;
  const rows = L.standings(teamsOf(gr.id), gamesOf(gr.id));
  if (!rows.length) return '';
  const cols = '32px minmax(0,1fr) 36px 36px 36px 36px 44px';
  return `<section class="stack" style="gap:8px"><h2 class="h2">순위표 <span class="small muted" style="font-weight:500">· 끝난 경기 기준</span></h2><div class="card tbl"><div class="tr th" style="grid-template-columns:${cols}"><span>순위</span><span class="l">팀</span><span>경기</span><span>승</span><span>무</span><span>패</span><span>승점</span></div>${rows.map((r) => `<div class="tr" style="grid-template-columns:${cols}"><b class="num" style="font-size:20px">${r.rank}</b><b class="l">${esc(r.name)}</b><span>${r.p}</span><span>${r.w}</span><span>${r.d}</span><span>${r.l}</span><b>${r.pts}</b></div>`).join('')}</div></section>`;
}

function studentScreen() {
  if (!T().meta) return `<div class="app"><div class="top">${brand()}</div><p class="note pad">${S.T === null && S.loaded ? '대회를 찾을 수 없습니다. 선생님께 QR을 다시 받아 주세요.' : '불러오는 중입니다.'}</p></div>`;
  const gr = grade();
  const games = gr ? gamesOf(gr.id) : [];
  const live = games.filter((g) => g.status === 'live');
  const next = games.find((g) => g.status === 'ready');
  const body = !gr ? '<p class="note">아직 경기가 준비되지 않았습니다.</p>' : S.tab === 'live'
    ? (live.map((g) => liveBlock(g, gr)).join('') || `<p class="note">지금 진행 중인 경기가 없습니다.</p>${next ? liveBlock(next, gr, false) : ''}`)
    : `${games.map((g) => gameCard(g, '')).join('') || '<p class="note">아직 경기가 없습니다.</p>'}${standingsTable(gr)}`;
  return `<div class="app"><header class="top" style="gap:12px"><div class="row between">${brand()}<span class="label">학생용 · 보기 전용</span></div><div class="row between"><h1 class="title" style="font-size:21px">${esc(T().meta.name)}</h1>${gradeList().length > 1 ? gradeSelect() : ''}</div>
${gr ? `<div class="label">${esc(gr.label)} ${esc(L.sportName(gr))}</div>` : ''}<div class="tabs"><button class="${S.tab === 'live' ? 'on' : ''}" data-act="tab" data-tab="live">지금 경기</button><button class="${S.tab === 'res' ? 'on' : ''}" data-act="tab" data-tab="res">경기 결과</button></div></header>
<div class="pad stack" style="gap:14px;padding-bottom:24px">${body}</div><div class="spacer"></div><div class="foot">음악적체육인</div></div>`;
}

// ---------- 타순 제출 화면 (?o=대회&g=경기) ----------
function orderScreen() {
  const wrap = (body) => `<div class="app"><header class="top" style="gap:10px"><div class="row between">${brand()}<span class="label">타순 제출</span></div>${body}</div>`;
  if (!T().meta) return wrap(`</header><p class="note pad">${S.loaded ? '대회를 찾을 수 없습니다. 선생님께 QR을 다시 받아 주세요.' : '불러오는 중입니다.'}</p>`);
  const g = gameOf(params.get('g'));
  if (!g) return wrap('</header><p class="note pad">경기를 찾을 수 없습니다. 선생님께 QR을 다시 받아 주세요.</p>');
  const head = `<h1 class="title" style="font-size:21px">${g.no}경기 타순 제출</h1><div class="label"><span class="ta">${esc(teamName(g.a))}</span> vs <span class="tb">${esc(teamName(g.b))}</span>${L.whenText(g) ? ` · ${esc(L.whenText(g))}` : ''}</div></header>`;
  if (g.status !== 'ready') return wrap(`${head}<p class="note pad" style="font-size:14px">이미 시작한 경기라 타순을 바꿀 수 없습니다.</p>`);
  const O = S.ord;
  if (!O.side) return wrap(`${head}<div class="pad stack"><p class="note" style="font-size:14px">우리 팀을 고르세요.</p>${['a', 'b'].map((side) => `<button class="btn big ${side === 'a' ? 'blue' : 'orange'}" data-act="ordSide" data-side="${side}">${esc(teamName(g[side]))}${orderList(g.id, side, g).length ? ' · 제출됨' : ''}</button>`).join('')}</div>`);
  const ps = playersOf(g[O.side]), P = Object.fromEntries(ps.map((p) => [p.pid, p]));
  // 선발 인원까지만 타순이 되고, 그 뒤에 누른 선수와 안 누른 선수는 교체 멤버가 된다.
  const N = Math.max(1, Number(T().grades[g.gid].starters) || 1);
  const lineupPicks = O.picks.slice(0, N), benchCount = ps.length - lineupPicks.length;
  if (O.done) return wrap(`${head}<div class="pad stack"><section class="dark stack"><b style="font-size:18px">${esc(teamName(g[O.side]))} 타순을 냈습니다</b>${lineupPicks.map((pid, i) => `<span><b>${i + 1}번</b> ${esc(P[pid].no)} ${esc(P[pid].name)}</span>`).join('')}${benchCount ? `<span class="label" style="border-top:1px solid #39424F;padding-top:8px">교체 멤버</span><span class="muted">${ps.filter((p) => !lineupPicks.includes(p.pid)).map((p) => `${esc(p.no)} ${esc(p.name)}`).join(' · ')}</span>` : ''}</section><p class="note">경기가 시작되기 전까지는 다시 고쳐서 낼 수 있습니다.</p><button class="btn" data-act="ordTog" data-pid="">다시 고치기</button></div>`);
  return wrap(`${head}<div class="pad stack"><div class="row between"><b class="t${O.side}" style="font-size:17px">${esc(teamName(g[O.side]))}</b><button class="btn plain" style="height:44px;padding:0" data-act="ordBack">다른 팀 고르기</button></div>
<p class="note" style="font-size:14px">타석에 설 순서대로 이름을 누르세요. 다시 누르면 빠집니다. 선발은 ${N}명이라, ${N}명을 누른 뒤에 누르는 선수와 누르지 않은 선수는 교체 멤버가 됩니다.</p>
<div class="grid2" style="gap:8px">${ps.map((p) => { const i = O.picks.indexOf(p.pid); return `<button class="pl${i >= 0 ? ' on' : ''}" data-act="ordTog" data-pid="${p.pid}" aria-pressed="${i >= 0}">${i >= N ? `<span class="tagbox" style="background:var(--accent);color:var(--ink);margin-right:8px">교체</span>` : i >= 0 ? `<span class="tagbox" style="background:#fff;color:var(--ink);margin-right:8px">${i + 1}번</span>` : `<b>${esc(p.no)}</b>`}${esc(p.name)}</button>`; }).join('') || '<p class="note">팀 명단이 아직 없습니다. 선생님께 알려 주세요.</p>'}</div>
<div class="grid2"><button class="btn sm" data-act="ordAll">번호 순으로 모두</button><button class="btn sm" data-act="ordNone">모두 지우기</button></div>
<button class="btn primary big" data-act="ordSend"${O.picks.length ? '' : ' disabled'}>타순 제출 (${lineupPicks.length}명${lineupPicks.length && benchCount ? ` · 교체 ${benchCount}명` : ''})</button></div><div class="spacer"></div><div class="foot">음악적체육인</div>`);
}

// ---------- 전광판 ----------
function boardScreen() {
  if (!T().meta) return `<div class="board"><p>${S.loaded ? '대회를 찾을 수 없습니다.' : '불러오는 중입니다.'}</p></div>`;
  const all = gradeList().flatMap((g) => gamesOf(g.id));
  const hd = (sub) => `<div class="hd"><div><h1>${esc(T().meta.name)}</h1><p>휘슬! · ${sub}</p></div><div class="row" style="gap:16px"><a class="pick row" href="${HOME}" style="text-decoration:none">선생님 화면</a><div class="qr">${qrSvg(`${BASE}?v=${S.tid}${DQ}`)}</div></div></div>`;
  const d = T().display;
  const dgr = d && d.mode === 'draw' && (T().grades || {})[d.gid] ? { ...T().grades[d.gid], id: d.gid } : null;
  if (dgr && drawOrder(dgr)) {
    const gr = dgr, order = drawOrder(gr), info = P.planInfo(gr.plan, order.length);
    return `<div class="board">${hd(`${esc(gr.label)} ${esc(L.sportName(gr))} · 추첨`)}<div class="drawbox"><h2>${esc(P.MODES[info.plan.mode])} 추첨</h2>${drawView(gr, order, d.at || 1)}<p class="sub">${esc(info.text)}</p></div></div>`;
  }
  if (d && d.mode === 'records' && (T().grades || {})[d.gid]) {
    S.gid = d.gid;
    const keep = S.rec; S.rec = { team: '', sort: 'goals', key: null };
    const rows = recordRows().slice(0, 10); S.rec = keep;
    const gr = T().grades[d.gid];
    return `<div class="board">${hd(`${esc(gr.label)} ${esc(L.sportName(gr))} · 개인 기록`)}<table><tr><th>순위</th><th class="l">선수</th><th class="l">팀</th>${recCols(gr).map(([t]) => `<th>${t}</th>`).join('')}</tr>${rows.map((r) => `<tr><td class="num">${r.rank}</td><td class="l"><b>${esc(r.no)} ${esc(r.name)}</b></td><td class="l">${esc(r.team)}</td>${recCells(gr, r, 'td')}</tr>`).join('') || '<tr><td colspan="7">아직 기록이 없습니다.</td></tr>'}</table></div>`;
  }
  const live = all.filter((g) => g.status === 'live').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const g = live.find((x) => x.id === S.boardGame) || live[0] || all.filter((x) => x.status === 'done').sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0] || all.find((x) => x.status === 'ready');
  if (!g) return `<div class="board">${hd('전광판')}<div class="mid" style="grid-template-columns:1fr"><p class="sub">아직 경기가 없습니다.</p></div></div>`;
  const gr = T().grades[g.gid], m = mainScore(g, gr);
  const byOrder = g.status !== 'ready' && gr.format === 'innings' && g.order.a.length && g.order.b.length;
  const orderLine = (side) => { const P = Object.fromEntries(playersOf(g[side]).map((p) => [p.pid, p])), now = nowBatter(g, gr, side); return g.order[side].filter((pid) => P[pid]).map((pid, i) => `<span class="${pid === now ? 'nowbat' : ''}" style="white-space:nowrap">${i + 1}번 ${esc(P[pid].name)}</span>`).join(' · '); };
  const box = (side) => (byOrder ? `<div class="box ${side}"><div class="row between label"><span>타순</span>${Number(gr.cards) ? `<span>교체 카드 ${L.cardsLeft(g, gr, side)}장 남음</span>` : ''}</div><div style="line-height:1.8">${orderLine(side)}</div><div class="label">교체 선수 · ${lineupOf(g, side, 'bench').map((p) => `${esc(p.no)} ${esc(p.name)}`).join(' · ') || '-'}</div></div>` : boxPlain(side));
  const boxPlain = (side) => `<div class="box ${side}"><div class="row between label"><span>${g.status === 'ready' ? '선발' : '뛰는 중'}</span>${g.status !== 'ready' && Number(gr.cards) ? `<span>교체 카드 ${L.cardsLeft(g, gr, side)}장 남음</span>` : ''}</div><div>${(g.status === 'ready' ? preOn(g, side) : lineupOf(g, side, 'on')).map((p) => `${esc(p.no)} ${esc(p.name)}`).join(' · ') || '-'}</div><div class="label">교체 선수 · ${(g.status === 'ready' ? preBench(g, side) : lineupOf(g, side, 'bench')).map((p) => `${esc(p.no)} ${esc(p.name)}`).join(' · ') || '-'}</div></div>`;
  const logs = logsOf(g.id).filter((l) => !l.x).slice(0, 3);
  const setBadge = (side) => (g.status === 'live' && (gr.format === 'dodge' || gr.format === 'sets') ? `<div class="setbadge">세트 ${side === 'a' ? g.sa : g.sb}</div>` : '');
  return `<div class="board">${hd(`${esc(gr.label)} ${esc(L.sportName(gr))} · ${g.no}경기${g.status === 'live' ? ` ${L.partName(gr, g.cur, g.half)}` : ` ${statusText(g)}`}${g.status === 'ready' && L.whenText(g) ? ` · ${esc(L.whenText(g))}` : ''}`)}
<div class="mid"><div><div class="name ta">${esc(teamName(g.a))}</div><div class="num pts">${g.status === 'ready' ? '-' : m.a}</div>${setBadge('a')}</div><div><div class="sub">${m.sub || ''}</div><div class="num clk">${g.status === 'ready' ? 'vs' : m.mid}</div>${g.status === 'live' && L.isDetail(g, gr) ? diamond(g, 170, true) : ''}${live.length > 1 ? `<button class="pick" data-act="boardNext">다른 경기 보기 (${live.length})</button>` : ''}</div><div><div class="name tb">${esc(teamName(g.b))}</div><div class="num pts">${g.status === 'ready' ? '-' : m.b}</div>${setBadge('b')}</div></div>
<div class="low">${box('a')}<div class="box"><div class="label">경기 기록</div>${logs.map((l) => `<div><b>${esc(l.tag)}</b> ${esc(l.text)}</div>`).join('') || '<div class="label">-</div>'}</div>${box('b')}</div></div>`;
}

// ---------- 아래에서 올라오는 창 ----------
function sheetHtml() {
  const s = S.sheet;
  if (!s) return '';
  const close = `<button class="btn" style="border:0;background:var(--bg)" data-act="closeSheet">취소</button>`;
  if (s.type === 'pick') {
    const g = gameOf(s.id); if (!g) return '';
    return `<div class="sheet" role="dialog" aria-label="득점 선수 고르기"><div><div class="label">${esc(teamName(g[s.team]))} 득점${s.pts > 1 ? ` +${s.pts}` : ''}</div><h2>누가 넣었나요?</h2></div>
<div class="grid2" style="gap:8px">${lineupOf(g, s.team, 'on').map((p) => `<button class="pl" style="height:56px;border-color:var(--ink);font-weight:700" data-act="gScore" data-pid="${p.pid}"><b>${esc(p.no)}</b>${esc(p.name)}</button>`).join('')}</div>
<button class="btn dash" data-act="gScore" data-pid="">선수 없이 점수만 올리기 (자책골 등)</button>${close}</div>`;
  }
  if (s.type === 'dout') {
    const g = gameOf(s.id); if (!g) return '';
    const other = s.team === 'a' ? 'b' : 'a';
    const pl = (p) => `<button class="pl" style="height:56px;border-color:var(--ink);font-weight:700" data-act="dPick" data-pid="${p.pid}"><b>${esc(p.no)}</b>${esc(p.name)}</button>`;
    if (s.delta > 0) return `<div class="sheet" role="dialog" aria-label="되살아난 선수 고르기"><div><div class="label">${esc(teamName(g[s.team]))}</div><h2>누가 되살아났나요?</h2></div><div class="grid2" style="gap:8px">${dodgeOutList(g, s.team).map(pl).join('')}</div><button class="btn dash" data-act="dPick" data-pid="">선수 없이 인원만 +1</button>${close}</div>`;
    if (s.pid === null) return `<div class="sheet" role="dialog" aria-label="아웃된 선수 고르기"><div><div class="label">${esc(teamName(g[s.team]))} 아웃</div><h2>누가 아웃됐나요?</h2></div><div class="grid2" style="gap:8px">${dodgeIn(g, s.team).map(pl).join('')}</div><button class="btn dash" data-act="dPick" data-pid="">선수 없이 인원만 −1</button>${close}</div>`;
    const who = playersOf(g[s.team]).find((p) => p.pid === s.pid);
    return `<div class="sheet" role="dialog" aria-label="아웃시킨 선수 고르기"><div><div class="label">${esc(teamName(g[s.team]))} ${who ? `${esc(who.no)} ${esc(who.name)}` : ''} 아웃</div><h2>누가 아웃시켰나요?</h2></div><div class="grid2" style="gap:8px">${dodgeIn(g, other).map(pl).join('')}</div><button class="btn dash" data-act="dPick" data-pid="-">고르지 않기</button>${close}</div>`;
  }
  if (s.type === 'editGoal') {
    const g = gameOf(s.id), l = g && logsOf(s.id).find((x) => x.id === s.log); if (!l) return '';
    const pl = (p) => `<button class="pl${(s.pid === null ? l.pid : l.apid) === p.pid ? ' on' : ''}" style="height:56px;border-color:var(--ink);font-weight:700" data-act="editGoalPick" data-pid="${p.pid}"><b>${esc(p.no)}</b>${esc(p.name)}</button>`;
    const list = gamePlayers(g, l.team);
    if (s.pid === null) return `<div class="sheet" role="dialog" aria-label="득점 선수 고치기"><div><div class="label">${esc(l.tag)} · ${esc(teamName(g[l.team]))} 득점 고치기</div><h2>누가 넣었나요?</h2></div>
<div class="grid2" style="gap:8px;max-height:46vh;overflow:auto">${list.map(pl).join('')}</div>
<button class="btn dash" data-act="editGoalPick" data-pid="">선수 기록 없음으로 두기</button>${close}</div>`;
    const scorer = list.find((p) => p.pid === s.pid);
    return `<div class="sheet" role="dialog" aria-label="어시스트 선수 고치기"><div><div class="label">${esc(l.tag)} · ${scorer ? `${esc(scorer.no)} ${esc(scorer.name)}` : ''} 득점</div><h2>누가 어시스트 했나요?</h2></div>
<div class="grid2" style="gap:8px;max-height:46vh;overflow:auto">${list.filter((p) => p.pid !== s.pid).map(pl).join('')}</div>
<button class="btn dash" data-act="editGoalPick" data-pid="-">어시스트 없음</button>${close}</div>`;
  }
  if (s.type === 'assist') {
    const g = gameOf(s.id); if (!g) return '';
    const scorer = playersOf(g[s.team]).find((p) => p.pid === s.pid);
    return `<div class="sheet" role="dialog" aria-label="어시스트 선수 고르기"><div><div class="label">${esc(teamName(g[s.team]))} 득점 · ${scorer ? `${esc(scorer.no)} ${esc(scorer.name)}` : ''}</div><h2>누가 어시스트 했나요?</h2></div>
<div class="grid2" style="gap:8px">${lineupOf(g, s.team, 'on').filter((p) => p.pid !== s.pid).map((p) => `<button class="pl" style="height:56px;border-color:var(--ink);font-weight:700" data-act="gAssist" data-pid="${p.pid}"><b>${esc(p.no)}</b>${esc(p.name)}</button>`).join('')}</div>
<button class="btn dash" data-act="gAssist" data-pid="">어시스트 없음</button>${close}</div>`;
  }
  if (s.type === 'dup') {
    const g = gameOf(s.id); if (!g) return '';
    return `<div class="sheet" role="dialog" aria-label="같은 득점 확인"><h2>방금 ${esc(teamName(g[s.team]))} 득점이 기록됐습니다.</h2><p class="note" style="font-size:14px">다른 선생님이 이미 올린 득점일 수 있습니다. 한 번 더 올릴까요?</p>
<button class="btn primary big" data-act="closeSheet">올리지 않기</button><button class="btn" data-act="dupYes">새 득점이 맞음 · 한 번 더 올리기</button></div>`;
  }
  if (s.type === 'win') {
    const g = gameOf(s.id); if (!g) return '';
    return `<div class="sheet" role="dialog" aria-label="승자 고르기"><div><div class="label">${esc(g.label || '')} · ${g.sa} : ${g.sb} 동점</div><h2>어느 팀이 올라가나요?</h2></div>
${['a', 'b'].map((side) => `<button class="btn big ${side === 'a' ? 'blue' : 'orange'}" data-act="winPick" data-side="${side}">${esc(teamName(g[side]))}</button>`).join('')}${close}</div>`;
  }
  if (s.type === 'help') return `<div class="sheet help" role="dialog" aria-label="사용 안내"><div class="row between"><h2>휘슬! 간략 사용법</h2><button class="btn sm" style="flex:0 0 auto" data-act="closeSheet">닫기</button></div>
${HELP.map(([t, lines], i) => `<section><h3><span class="num">${i + 1}</span>${t}</h3><ul>${lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`).join('')}
${S.store.demo ? '' : `<a class="btn sm" href="${BASE}?demo" target="_blank" rel="noopener">지어낸 대회로 미리 눌러 보기</a>`}<button class="btn primary big" data-act="closeSheet">확인</button></div>`;
  if (s.type === 'notice') return `<div class="sheet" role="alertdialog" aria-label="안내"><h2>${esc(s.title)}</h2><p class="note" style="font-size:14px">${esc(s.text)}</p><button class="btn primary big" data-act="closeSheet">확인</button></div>`;
  if (s.type === 'confirm') return `<div class="sheet" role="dialog"><h2>${esc(s.title)}</h2>${s.text ? `<p class="note" style="font-size:14px">${esc(s.text)}</p>` : ''}<button class="btn primary big" ${s.danger ? 'style="background:#B42318;border-color:#B42318"' : ''} data-act="confirmYes">${esc(s.yes)}</button>${close}</div>`;
  if (s.type === 'qr') return `<div class="sheet" role="dialog" aria-label="학생용 QR"><h2>학생용 화면 QR</h2><div class="qr" style="width:min(100%,360px);aspect-ratio:1;align-self:center;border:1px solid var(--line)">${qrSvg(`${BASE}?v=${S.tid}${DQ}`)}</div><button class="btn" data-act="copy" data-text="${BASE}?v=${S.tid}${DQ}" data-msg="학생용 주소를 복사했습니다.">학생용 주소 복사</button>${close.replace('취소', '닫기')}</div>`;
  if (s.type === 'dp') {
    const g = gameOf(s.id); if (!g) return '';
    const P = Object.fromEntries(playersOf(g[L.attacker(g)]).map((p) => [p.pid, p]));
    return `<div class="sheet" role="dialog" aria-label="병살 주자 고르기"><div><div class="label">병살</div><h2>타자와 함께 아웃되는 주자는?</h2></div>${[1, 2, 3].filter((b) => g.bases[`b${b}`]).map((b) => { const p = P[g.bases[`b${b}`]]; return `<button class="pl" style="height:56px;border-color:var(--ink);font-weight:700" data-act="batDp" data-base="${b}"><b>${b}루</b>${p ? `${esc(p.no)} ${esc(p.name)}` : '주자'}</button>`; }).join('')}${close}</div>`;
  }
  if (s.type === 'orderQR') { const url = `${BASE}?o=${S.tid}&g=${s.id}${DQ}`; return `<div class="sheet" role="dialog" aria-label="타순 제출 QR"><h2>타순 제출 QR</h2><p class="note" style="font-size:14px">학생이 QR로 들어와 우리 팀을 고르고 타순을 냅니다. 경기를 시작하면 낸 타순대로 선발과 타순이 정해지고, 시작한 뒤에는 바꿀 수 없습니다.</p><div class="qr" style="width:min(100%,320px);aspect-ratio:1;align-self:center;border:1px solid var(--line)">${qrSvg(url)}</div><button class="btn" data-act="copy" data-text="${url}" data-msg="타순 제출 주소를 복사했습니다.">타순 제출 주소 복사</button>${close.replace('취소', '닫기')}</div>`; }
  if (s.type === 'grade') return `<div class="sheet" role="dialog"><h2>학년 추가</h2><div class="field"><label class="label" for="ng-label">학년 이름</label><input id="ng-label" class="input" placeholder="예: 6학년" maxlength="12" data-enter="saveGrade"></div>
<div class="field"><label class="label" for="ng-sport">종목</label><select id="ng-sport" class="input">${Object.entries(L.SPORTS).map(([k, sp]) => `<option value="${k}">${sp.name}</option>`).join('')}</select></div><p class="note">종목 기본 규칙이 채워지고, 설정에서 바꿀 수 있습니다.</p><button class="btn primary big" data-act="saveGrade">추가</button>${close}</div>`;
  if (s.type === 'team') return `<div class="sheet" role="dialog"><h2>팀 추가</h2><div class="field"><label class="label" for="nt-name">팀 이름</label><input id="nt-name" class="input" placeholder="예: 6-1 번개" maxlength="20" data-enter="saveTeam"></div><button class="btn primary big" data-act="saveTeam">추가</button>${close}</div>`;
  if (s.type === 'game') {
    const opts = Object.entries(teamsOf(grade().id)).map(([id, t]) => `<option value="${id}">${esc(t.name)}</option>`);
    return `<div class="sheet" role="dialog"><h2>경기 추가</h2><div class="grid2"><div class="field"><label class="label" for="ng-a">팀 1</label><select id="ng-a" class="input">${opts.join('')}</select></div><div class="field"><label class="label" for="ng-b">팀 2</label><select id="ng-b" class="input">${opts.slice(1).concat(opts.slice(0, 1)).join('')}</select></div></div>${grade().format === 'innings' ? '<p class="note">팀 1이 먼저 공격(초)합니다.</p>' : ''}${whenFields()}<button class="btn primary big" data-act="saveGame">추가</button>${close}</div>`;
  }
  if (s.type === 'when') return `<div class="sheet" role="dialog"><h2>경기 일정</h2>${whenFields((T().games || {})[s.id] || {})}<button class="btn primary big" data-act="saveWhen">저장</button>${close}</div>`;
  if (s.type === 'class') return `<div class="sheet" role="dialog"><h2>반 추가</h2><div class="field"><label class="label" for="nc-name">반 이름</label><input id="nc-name" class="input" placeholder="예: 6학년 1반" maxlength="20" data-enter="saveClass"></div><button class="btn primary big" data-act="saveClass">추가</button>${close}</div>`;
  if (s.type === 'import') {
    const ps = studentsOf(s.cid), n = Object.keys(s.picked).length;
    return `<div class="sheet" role="dialog" aria-label="학교 명단에서 불러오기"><h2>학교 명단에서 불러오기</h2><div class="field"><label class="label" for="im-class">반</label><select id="im-class" class="input" data-change="importClass">${classList().map((c) => `<option value="${c.id}"${c.id === s.cid ? ' selected' : ''}>${esc(c.name)} (${Object.keys(c.students || {}).length}명)</option>`).join('')}</select></div>
<div class="row between"><span class="label">${esc(teamName(S.teamId))}에 넣을 학생을 고르세요</span><button class="btn plain" style="height:44px;padding:0" data-act="importAll">${n && n === ps.length ? '모두 해제' : '모두 고르기'}</button></div>
<div class="grid2" style="gap:8px">${ps.map((p) => `<button class="pl${s.picked[p.sid] ? ' on' : ''}" data-act="importTog" data-sid="${p.sid}" aria-pressed="${!!s.picked[p.sid]}"><b>${esc(p.no)}</b>${esc(p.name)}</button>`).join('') || '<p class="note">이 반에는 아직 학생이 없습니다.</p>'}</div>
<button class="btn primary big" data-act="importGo"${n ? '' : ' disabled'}>${n}명 팀 명단에 넣기</button>${close}</div>`;
  }
  if (s.type === 'paste') return `<div class="sheet" role="dialog"><h2>명단 붙여넣기</h2><p class="note">한 줄에 한 명씩 "번호 이름"으로 적습니다. 번호가 없으면 순서대로 매깁니다.${s.to === 'school' ? '' : ' 앞에서부터 선발 인원만큼 선발이 됩니다.'}</p><textarea id="paste" class="input" placeholder="3 강태윤&#10;5 한지우&#10;7 오세린" aria-label="명단"></textarea><button class="btn primary big" data-act="savePaste">명단에 넣기</button>${close}</div>`;
  return '';
}

// ---------- 그리기 ----------
function route() { const [name, a, b] = (location.hash.slice(1) || 'home').split('/'); return { name, a, b }; }

function screenHtml() {
  if (MODE === 'student') return studentScreen();
  if (MODE === 'board') return boardScreen();
  if (MODE === 'order') return orderScreen();
  if (!S.store.user) return loginScreen();
  if (!S.tid || !T().meta) return S.tid && !S.loaded ? `<div class="app"><p class="note pad mt">불러오는 중입니다.</p></div>` : listScreen();
  const r = route();
  if (r.name === 'game') return gameScreen(r.a);
  if (r.name === 'sub') return subScreen(r.a, r.b === 'b' ? 'b' : 'a');
  if (r.name === 'games') return gamesScreen();
  if (r.name === 'members') return membersScreen();
  if (r.name === 'records') return recordsScreen();
  if (r.name === 'teams' && canTeams()) return teamsScreen();
  if (r.name === 'plan' && canRules()) return planScreen();
  if (r.name === 'settings') return settingsScreen();
  if (r.name === 'rules' && canRules()) return rulesScreen();
  if (r.name === 'school' && canTeams()) return schoolScreen();
  return homeScreen();
}

function render(force) {
  const ae = document.activeElement;
  if (!force && ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) { S.dirty = true; return; }
  S.dirty = false;
  const y = window.scrollY;
  document.getElementById('app').innerHTML = screenHtml();
  document.getElementById('sheet').innerHTML = sheetHtml();
  window.scrollTo(0, y);
}
const openSheet = (s) => { S.sheet = s; render(true); const el = document.querySelector('#sheet input, #sheet textarea'); if (el) el.focus(); };
const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

// ---------- 대회 열기 ----------
function closeT() { S.off.forEach((f) => f()); S.off = []; S.T = null; S.M = {}; S.loaded = false; S.code = ''; }
function openT(tid) {
  closeT(); S.tid = tid; S.gid = null; S.teamId = null;
  if (MODE === 'teacher') localStorage.setItem(TID_KEY, tid);
  S.off.push(S.store.on(`t/${tid}`, (v) => { S.T = v; S.loaded = true; if (MODE === 'teacher' && S.T && isOwner() && !S.code) loadCode(); render(); }));
  if (MODE === 'teacher') S.off.push(S.store.on(`m/${tid}`, (v) => { S.M = v || {}; render(); }));
}
async function loadCode() { try { S.code = ((await S.store.get(`s/${S.tid}`)) || {}).code || ''; render(); } catch { /* 주인만 읽을 수 있다 */ } }
async function freshCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let i = 0; i < 20; i++) {
    const code = A[Math.floor(Math.random() * A.length)] + A[Math.floor(Math.random() * A.length)] + String(Math.floor(1000 + Math.random() * 9000));
    if (!(await S.store.get(`codes/${code}`))) return code;
  }
  throw new Error('초대 코드를 만들지 못했습니다. 다시 눌러 주세요.');
}
async function loadMy() {
  const mine = (await S.store.get(`u/${uid()}/t`)) || {};
  const list = [];
  for (const tid of Object.keys(mine)) {
    const [meta, grades, games] = await Promise.all([S.store.get(`t/${tid}/meta`), S.store.get(`t/${tid}/grades`), S.store.get(`t/${tid}/games`)]);
    if (!meta) continue;
    const st = Object.values(games || {}).map((g) => g.status);
    list.push({
      tid, name: meta.name, owner: meta.owner === uid(), at: meta.createdAt || 0,
      grades: Object.values(grades || {}).sort((a, b) => (a.order || 0) - (b.order || 0)).map((g) => `${g.label} ${L.sportName(g)}`),
      live: st.filter((x) => x === 'live').length, done: st.filter((x) => x === 'done').length, ready: st.filter((x) => x === 'ready').length,
    });
  }
  S.my = list.sort((a, b) => b.at - a.at);
}
async function afterAuth() {
  closeT(); S.tid = null;
  if (S.offSchool) { S.offSchool(); S.offSchool = null; }
  S.school = {};
  if (S.store.user) {
    S.offSchool = S.store.on(schoolPath(), (v) => { S.school = v || {}; render(); });
    try { await loadMy(); } catch (e) { S.my = []; toast(friendly(e)); }
    const join = params.get('join');
    if (join) { S.code = join.toUpperCase(); history.replaceState(null, '', BASE); await actions.joinT(); }
    const last = localStorage.getItem(TID_KEY);
    if (!S.tid && last && S.my.some((t) => t.tid === last)) openT(last);
  }
  render(true);
}

// ---------- 단추가 하는 일 ----------
const gradePath = () => `t/${S.tid}/grades/${grade().id}`;
const teamPath = () => `t/${S.tid}/teams/${S.teamId}`;
const actions = {
  async signIn() { try { await S.store.signIn(); } catch (e) { toast('로그인하지 못했습니다.'); } },
  async signOut() { localStorage.removeItem(TID_KEY); await S.store.signOut(); },
  demoOn() { forceDemo(true); },
  demoOff() { forceDemo(false); },
  async newT() {
    const name = val('new-t'); if (!name) return toast('대회 이름을 적어 주세요.');
    const tid = S.store.id(), code = await freshCode(), me = S.store.user;
    await S.store.set(`t/${tid}/meta`, { name, owner: me.uid, createdAt: S.store.now() });
    await S.store.set(`m/${tid}/${me.uid}`, { name: me.name, role: 'owner' });
    await S.store.set(`s/${tid}`, { code });
    await S.store.set(`codes/${code}`, tid);
    await S.store.set(`u/${me.uid}/t/${tid}`, true);
    await loadMy(); location.hash = 'home'; openT(tid);
  },
  async joinT() {
    const code = (val('join-code') || S.code).toUpperCase().replace(/\s/g, ''); if (!code) return toast('초대 코드를 적어 주세요.');
    try {
      const tid = await S.store.get(`codes/${code}`); if (!tid) return toast('코드를 찾을 수 없습니다.');
      const me = S.store.user;
      const meta = await S.store.get(`t/${tid}/meta`);
      // 이미 참여 중이면 받은 권한을 그대로 둔다(다시 들어와도 '경기 진행만'으로 내려가지 않게).
      let already = false;
      try { already = !!(await S.store.get(`m/${tid}/${me.uid}`)); } catch { already = false; }
      if (meta && meta.owner !== me.uid && !already) {
        await S.store.set(`j/${tid}/${me.uid}`, code);
        await S.store.set(`m/${tid}/${me.uid}`, { name: me.name, role: 'ref' });
      }
      await S.store.set(`u/${me.uid}/t/${tid}`, true);
      S.code = ''; await loadMy(); location.hash = 'home'; openT(tid);
    } catch (e) { toast('참여하지 못했습니다. 코드를 다시 확인해 주세요.'); }
  },
  openT(d) { location.hash = 'home'; openT(d.tid); render(true); },
  async leaveT() { localStorage.removeItem(TID_KEY); closeT(); S.tid = null; await loadMy(); render(true); },
  async quitT() {
    await S.store.remove(`m/${S.tid}/${uid()}`); await S.store.remove(`u/${uid()}/t/${S.tid}`);
    await actions.leaveT();
  },
  pickGrade(d) { S.gid = d.gid; S.teamId = null; S.rec.team = ''; S.rec.key = null; render(true); },
  addGrade() { openSheet({ type: 'grade' }); },
  async saveGrade() {
    const label = val('ng-label'); if (!label) return toast('학년 이름을 적어 주세요.');
    const id = S.store.id();
    await S.store.set(`t/${S.tid}/grades/${id}`, { ...L.gradeFromSport(val('ng-sport'), label), order: S.store.now() });
    S.gid = id; S.sheet = null; render(true);
  },
  delGradeAsk() { const gr = grade(); openSheet({ type: 'confirm', title: `${gr.label}을(를) 지울까요?`, text: `팀 ${Object.keys(teamsOf(gr.id)).length}개, 경기 ${gamesOf(gr.id).length}개와 기록이 모두 지워집니다. 지운 뒤 15초 동안은 되돌릴 수 있습니다.`, yes: `${gr.label} 지우기`, danger: true, run: 'delGrade' }); },
  async delGrade() {
    const gr = grade(), gid = gr.id, t = T(), up = { [`grades/${gid}`]: null }, back = { [`grades/${gid}`]: (t.grades || {})[gid] };
    for (const id of Object.keys(teamsOf(gid))) { up[`teams/${id}`] = null; back[`teams/${id}`] = t.teams[id]; }
    for (const g of gamesOf(gid)) for (const k of ['games', 'logs', 'orders']) { up[`${k}/${g.id}`] = null; const v = (t[k] || {})[g.id]; if (v) back[`${k}/${g.id}`] = v; }
    const keep = JSON.parse(JSON.stringify(back));
    await S.store.update(`t/${S.tid}`, up); S.gid = null;
    undoBar(`${gr.label}을(를) 지웠습니다.`, async () => { await S.store.update(`t/${S.tid}`, keep); S.gid = gid; render(true); toast(`${gr.label}을(를) 되돌렸습니다.`); });
  },
  async setGrade(d) { const v = ['reentry', 'detail', 'keepRunners', 'assist', 'outDetail'].includes(d.key) ? d.val === '1' : d.val; await S.store.update(gradePath(), { [d.key]: v }); },
  async step(d) {
    const cur = Number(grade()[d.key]) || 0;
    const next = Math.min(Number(d.max), Math.max(Number(d.min), cur + Number(d.d)));
    if (next !== cur) await S.store.update(gradePath(), { [d.key]: next });
  },
  async undoDel() { const run = undoBar.run; clearInterval(undoBar.i); undoBar.run = null; document.getElementById('toast').textContent = ''; if (run) await run(); },
  help() { openSheet({ type: 'help' }); },
  // ----- 대회 편성 -----
  async planSet(d) {
    const cur = planOf(grade());
    const v = d.key === 'third' ? !!d.val : d.val;
    if (cur[d.key] === v) return null;
    S.swap = null;
    return S.store.update(`${gradePath()}/plan`, { [d.key]: v, ...(d.key === 'mode' ? { order: null } : {}) });
  },
  async planStep(d) {
    const cur = planOf(grade()), next = Math.min(Number(d.max), Math.max(Number(d.min), cur[d.key] + Number(d.d)));
    if (next !== cur[d.key]) await S.store.update(`${gradePath()}/plan`, { [d.key]: next });
  },
  async planDraw() { S.swap = null; await S.store.update(`${gradePath()}/plan`, { order: P.shuffle(planTeams(grade().id)) }); if (T().display && T().display.mode === 'draw') await S.store.set(`t/${S.tid}/display`, { mode: 'draw', gid: grade().id, at: S.store.now() }); },
  async swapTeam(d) {
    const gr = grade(), order = drawOrder(gr); if (!order || stagedOf(gr.id).length) return null;
    if (!S.swap) { S.swap = d.team; return render(true); }
    const a = order.indexOf(S.swap), b = order.indexOf(d.team); S.swap = null;
    if (a === b) return render(true);
    [order[a], order[b]] = [order[b], order[a]];
    return S.store.update(`${gradePath()}/plan`, { order });
  },
  drawBoard() { const gr = grade(), on = T().display && T().display.mode === 'draw' && T().display.gid === gr.id; return S.store.set(`t/${S.tid}/display`, on ? null : { mode: 'draw', gid: gr.id, at: S.store.now() }); },
  async planMake() {
    const gr = grade(), plan = planOf(gr), ids = planTeams(gr.id);
    const order = plan.mode === 'league' ? P.shuffle(ids) : drawOrder(gr);
    if (!order) return toast('먼저 추첨을 해 주세요.');
    const firstNo = Math.max(0, ...gamesOf(gr.id).map((g) => g.no)) + 1;
    const games = P.buildGames(plan, order, gr.id, S.store.id, firstNo, L.newGame);
    await S.store.update(`${gradePath()}/plan`, { ...plan, order, made: true });
    await S.store.update(`t/${S.tid}/games`, games);
    S.swap = null; toast(`경기 ${Object.keys(games).length}개를 짰습니다.`);
  },
  async planSync() { const n = gamesOf(grade().id).length; await syncBracket(grade().id); if (gamesOf(grade().id).length === n) toast(planOf(grade()).mode === 'swiss' ? '아직 끝나지 않은 경기가 있거나 더 짤 경기가 없습니다.' : '결선 자리를 다시 채웠습니다.'); },
  planClearAsk() {
    const gr = grade(), staged = stagedOf(gr.id), ready = staged.filter((g) => g.status === 'ready');
    if (!ready.length) return toast('지울 수 있는(시작하지 않은) 편성 경기가 없습니다.');
    openSheet({ type: 'confirm', title: `편성 경기 ${ready.length}개를 지울까요?`, text: ready.length < staged.length ? `이미 시작했거나 끝난 ${staged.length - ready.length}경기는 남기고, 시작하지 않은 경기만 지웁니다.` : '편성으로 만든 경기를 모두 지우고 방식을 다시 고를 수 있게 합니다. 손으로 추가한 경기는 그대로 둡니다.', yes: '편성 경기 지우기', danger: true, run: 'planClear' });
  },
  async planClear() {
    const gr = grade(), up = {};
    for (const g of stagedOf(gr.id)) if (g.status === 'ready') { up[`games/${g.id}`] = null; up[`orders/${g.id}`] = null; }
    await S.store.update(`t/${S.tid}`, up);
    await S.store.update(`${gradePath()}/plan`, { made: null });
  },
  async gExtend(d) { await act(d.id, L.extend); },
  winAsk(d) { openSheet({ type: 'win', id: d.id }); },
  async winPick(d) {
    const id = S.sheet.id, g = gameOf(id); S.sheet = null; render(true);
    await S.store.update(`t/${S.tid}/games/${id}`, { win: d.side });
    await S.store.push(`t/${S.tid}/logs/${id}`, { at: S.store.now(), tag: '종료', type: 'info', text: `동점 · ${teamName(g[d.side])} 승리로 정함`, by: uid() });
    await syncBracket(g.gid);
  },
  showQR() { openSheet({ type: 'qr' }); },
  async copy(d) { try { await navigator.clipboard.writeText(d.text); toast(d.msg); } catch { toast(d.text); } },
  addGame() { if (Object.keys(teamsOf(grade().id)).length < 2) return toast('팀이 두 팀 이상 있어야 합니다.'); openSheet({ type: 'game' }); },
  async saveGame() {
    const a = val('ng-a'), b = val('ng-b'); if (!a || !b || a === b) return toast('서로 다른 두 팀을 골라 주세요.');
    const gid = grade().id, no = Math.max(0, ...gamesOf(gid).map((g) => g.no)) + 1;
    const g = L.newGame(gid, no, a, b), w = readWhen();
    for (const k of Object.keys(w)) if (w[k]) g[k] = w[k];
    await S.store.set(`t/${S.tid}/games/${S.store.id()}`, g);
    S.sheet = null; render(true);
  },
  delGame(d) {
    const started = ((T().games || {})[d.id] || {}).status !== 'ready';
    openSheet({ type: 'confirm', title: '이 경기를 지울까요?', text: started ? '점수와 경기 기록이 모두 지워지고, 순위표와 개인 기록에서도 빠집니다. 되돌릴 수 없습니다.' : '', yes: '지우기', run: 'delGameGo', id: d.id });
  },
  whenAsk(d) { openSheet({ type: 'when', id: d.id }); },
  orderQR(d) { openSheet({ type: 'orderQR', id: d.id }); },
  orderClear(d) { return S.store.remove(`t/${S.tid}/orders/${d.id}`); },
  ordSide(d) { const g = gameOf(params.get('g')); S.ord = { side: d.side, picks: g ? orderList(g.id, d.side, g) : [], done: false }; render(true); },
  ordTog(d) { const p = S.ord.picks, i = p.indexOf(d.pid); if (d.pid) { if (i >= 0) p.splice(i, 1); else p.push(d.pid); } S.ord.done = false; render(true); },
  ordAll() { const g = gameOf(params.get('g')); S.ord.picks = playersOf(g[S.ord.side]).map((p) => p.pid); S.ord.done = false; render(true); },
  ordNone() { S.ord.picks = []; S.ord.done = false; render(true); },
  ordBack() { S.ord = { side: null, picks: [], done: false }; render(true); },
  async ordSend() {
    if (!S.ord.picks.length) return toast('타순에 넣을 선수를 눌러 주세요.');
    await S.store.set(`t/${S.tid}/orders/${params.get('g')}/${S.ord.side}`, { list: S.ord.picks.slice(0, Math.max(1, Number(T().grades[gameOf(params.get('g')).gid].starters) || 1)), at: S.store.now() });
    S.ord.done = true; render(true);
  },
  async saveWhen() { await S.store.update(`t/${S.tid}/games/${S.sheet.id}`, readWhen()); S.sheet = null; render(true); },
  async delGameGo() { const id = S.sheet.id, g = gameOf(id); location.hash = 'games'; await S.store.update(`t/${S.tid}`, { [`games/${id}`]: null, [`logs/${id}`]: null, [`orders/${id}`]: null }); if (g && g.stage) await syncBracket(g.gid); },
  gStart(d) {
    const g = gameOf(d.id), gr = T().grades[g.gid];
    if (P.isOpen(g.a) || P.isOpen(g.b)) return openSheet({ type: 'notice', title: '아직 팀이 정해지지 않았습니다', text: '예선이나 앞 경기가 끝나면 이 자리에 팀이 자동으로 들어갑니다. 끝났는데도 비어 있으면 홈의 "대회 편성"에서 "결선 자리 다시 채우기"를 눌러 주세요. 동점으로 끝난 결선 경기는 연장을 열거나 승자를 골라야 합니다.' });
    const bad = ['a', 'b'].filter((side) => !(gr.format === 'innings' && orderList(d.id, side, g).length)).map((side) => [side, rosterIssues(g[side], gr)]).filter(([, r]) => r.length);
    if (bad.length) return openSheet({ type: 'notice', title: '명단이 설정과 달라 시작할 수 없습니다', text: `${bad.map(([side, r]) => `${teamName(g[side])}: ${r.join(', ')}`).join(' / ')}. 팀 명단에서 선발·후보를 맞추거나, 종목·규칙에서 인원을 바꾼 뒤 시작해 주세요.` });
    return act(d.id, L.start);
  },
  gClock(d) { return act(d.id, L.toggleClock); },
  gNext(d) { return act(d.id, L.nextPart); },
  gEndAsk(d) { openSheet({ type: 'confirm', title: '경기를 끝낼까요?', text: '끝낸 경기는 다시 진행할 수 없습니다.', yes: '경기 종료', run: 'gEnd', id: d.id }); },
  gEnd() { const g = gameOf(S.sheet.id), gr = T().grades[g.gid]; const last = g.cur >= L.partCount(gr, g) - 1; return act(g.id, L.isTimed(gr) && last ? L.nextPart : L.endGame); },
  gPlus(d) {
    const g = gameOf(d.id), gr = T().grades[g.gid], pts = Number(d.pts) || 1;
    const dup = g.last && g.last.team === d.team && g.last.by !== uid() && S.store.now() - g.last.at < L.dupWindow(gr);
    if (dup) return openSheet({ type: 'dup', id: d.id, team: d.team, pts });
    return actions.gAsk({ id: d.id, team: d.team, pts });
  },
  gAsk(s) {
    const g = gameOf(s.id), gr = T().grades[g.gid];
    if (L.usesPicker(gr) && lineupOf(g, s.team, 'on').length) return openSheet({ type: 'pick', ...s });
    S.sheet = null;
    return act(s.id, (x, grd, ctx) => L.score(x, grd, ctx, s.team, s.pts, ''));
  },
  dupYes() { const s = S.sheet; S.sheet = null; return actions.gAsk({ id: s.id, team: s.team, pts: s.pts }); },
  gScore(d) {
    const s = S.sheet, g = gameOf(s.id), gr = T().grades[g.gid];
    if (gr.assist && L.isTimed(gr) && d.pid && lineupOf(g, s.team, 'on').length > 1) return openSheet({ type: 'assist', id: s.id, team: s.team, pts: s.pts, pid: d.pid });
    S.sheet = null; render(true);
    return act(s.id, (x, grd, ctx) => L.score(x, grd, ctx, s.team, s.pts, d.pid));
  },
  editGoal(d) { openSheet({ type: 'editGoal', id: d.id, log: d.log, pid: null }); },
  async editGoalPick(d) {
    const s = S.sheet, g = gameOf(s.id), gr = T().grades[g.gid], l = logsOf(s.id).find((x) => x.id === s.log);
    if (!l) { S.sheet = null; return render(true); }
    const askAssist = gr.assist && L.isTimed(gr) && gamePlayers(g, l.team).length > 1;
    if (s.pid === null && d.pid && askAssist) { s.pid = d.pid; return render(true); }
    const pid = s.pid === null ? d.pid : s.pid, apid = s.pid === null || d.pid === '-' ? '' : d.pid;
    S.sheet = null; render(true);
    await S.store.update(`t/${S.tid}/logs/${s.id}/${s.log}`, L.editGoal(l, ctxFor(g, s.id), pid, apid));
    toast('득점 기록을 고쳤습니다.');
  },
  gAssist(d) { const s = S.sheet; S.sheet = null; render(true); return act(s.id, (x, gr, ctx) => L.score(x, gr, ctx, s.team, s.pts, s.pid, d.pid)); },
  async gMinus(d) {
    const g = gameOf(d.id), gr = T().grades[g.gid];
    if ((d.team === 'a' ? g.pa : g.pb)[g.cur] <= 0) return toast('이 구간 점수가 0입니다.');
    let pts = 1;
    if (L.usesPicker(gr)) {
      const goal = logsOf(d.id).find((l) => l.type === 'goal' && !l.x && l.team === d.team && l.part === g.cur);
      if (goal) { pts = goal.pts || 1; await S.store.update(`t/${S.tid}/logs/${d.id}/${goal.id}`, { x: true }); }
    }
    return act(d.id, (x, grd, ctx) => L.score(x, grd, ctx, d.team, -pts, ''));
  },
  bat(d) {
    const g = gameOf(d.id);
    if (d.res === 'dp' && [1, 2, 3].filter((b) => g.bases[`b${b}`]).length > 1) return openSheet({ type: 'dp', id: d.id });
    const op = S.store.id(); return act(d.id, (x, gr, ctx) => L.bat(x, gr, { ...ctx, op }, d.res));
  },
  batDp(d) { const id = S.sheet.id, op = S.store.id(); S.sheet = null; render(true); return act(id, (x, gr, ctx) => L.bat(x, gr, { ...ctx, op }, 'dp', Number(d.base))); },
  runner(d) { const op = S.store.id(); return act(d.id, (x, gr, ctx) => L.runner(x, gr, { ...ctx, op }, Number(d.base), d.op)); },
  async batUndo(d) {
    const g = gameOf(d.id), op = g.undo && g.undo.op;
    if (!(await act(d.id, L.undo)) || !op) return;
    const up = {};
    for (const l of logsOf(d.id)) if (l.op === op) up[`${l.id}/x`] = true;
    if (Object.keys(up).length) await S.store.update(`t/${S.tid}/logs/${d.id}`, up);
  },
  dOut(d) {
    const g = gameOf(d.id), gr = T().grades[g.gid], delta = Number(d.d);
    const pool = delta < 0 ? dodgeIn(g, d.team) : dodgeOutList(g, d.team);
    if (gr.outDetail && !g.tie && pool.length) return openSheet({ type: 'dout', id: d.id, team: d.team, delta, pid: null });
    return act(d.id, (x, grd, ctx) => L.dodgeOut(x, grd, ctx, d.team, delta));
  },
  dPick(d) {
    const s = S.sheet, g = gameOf(s.id);
    const send = (pid, kpid) => { S.sheet = null; render(true); return act(s.id, (x, gr, ctx) => L.dodgeOut(x, gr, ctx, s.team, s.delta, pid, kpid)); };
    if (s.delta > 0 || !d.pid) return send(d.pid || '', '');
    if (s.pid === null && dodgeIn(g, s.team === 'a' ? 'b' : 'a').length) { s.pid = d.pid; return render(true); }
    return s.pid === null ? send(d.pid, '') : send(s.pid, d.pid === '-' ? '' : d.pid);
  },
  dTie(d) { return act(d.id, (x, gr, ctx) => L.dodgeTie(x, gr, ctx, d.choice)); },
  subPick(d) { S.sub[d.kind] = S.sub[d.kind] === d.pid ? null : d.pid; render(true); },
  async subGo() {
    const { id, side, out, in: inn } = S.sub;
    if (await act(id, (x, gr, ctx) => L.sub(x, gr, ctx, side, out, inn))) { S.sub = {}; location.hash = `game/${id}`; }
  },
  pickTeam(d) { S.teamId = d.id; render(true); },
  addTeam() { openSheet({ type: 'team' }); },
  async saveTeam() {
    const name = val('nt-name'); if (!name) return toast('팀 이름을 적어 주세요.');
    const id = S.store.id(); await S.store.set(`t/${S.tid}/teams/${id}`, { gid: grade().id, name });
    S.teamId = id; S.sheet = null; render(true);
  },
  delTeam() {
    if (gamesOf(grade().id).some((g) => g.a === S.teamId || g.b === S.teamId)) return toast('이 팀의 경기가 있어서 지울 수 없습니다. 경기를 먼저 지워 주세요.');
    openSheet({ type: 'confirm', title: `${teamName(S.teamId)} 팀을 지울까요?`, text: '', yes: '지우기', run: 'delTeamGo' });
  },
  async delTeamGo() { const id = S.teamId; S.teamId = null; await S.store.remove(`t/${S.tid}/teams/${id}`); },
  async addPlayer() {
    const name = val('p-name'); if (!name) return toast('선수 이름을 적어 주세요.');
    const ps = playersOf(S.teamId);
    const no = val('p-no') || String(Math.max(0, ...ps.map((p) => Number(p.no) || 0)) + 1);
    await S.store.set(`${teamPath()}/players/${S.store.id()}`, { no, name, ...nextSlot(ps) });
    render(true); const el = document.getElementById('p-name'); if (el) el.focus();
  },
  setBench(d) {
    const ps = playersOf(S.teamId), p = ps.find((x) => x.pid === d.pid), gr = grade(), n = Number(gr.starters), m = Number(gr.subs) || 0;
    if (!p || slotOf(p) === d.slot) return null;
    if (d.slot === 'on' && ps.filter((x) => slotOf(x) === 'on').length >= n) return openSheet({ type: 'notice', title: `선발은 ${n}명까지입니다`, text: `${L.sportName(gr)} 선발 인원이 ${n}명으로 정해져 있습니다. 다른 선수를 후보로 바꾼 뒤 다시 눌러 주세요. 인원은 종목·규칙에서 바꿀 수 있습니다.` });
    if (d.slot === 'bench' && m && ps.filter((x) => slotOf(x) === 'bench').length >= m) return openSheet({ type: 'notice', title: `후보는 ${m}명까지입니다`, text: `후보 인원이 ${m}명으로 정해져 있습니다. 다른 선수를 빠짐으로 바꾼 뒤 다시 눌러 주세요. 인원은 종목·규칙에서 바꿀 수 있습니다.` });
    return S.store.update(`${teamPath()}/players/${d.pid}`, { bench: d.slot !== 'on', off: d.slot === 'off' });
  },
  // 번호 순으로 선발을 설정 인원에 맞추고, 후보 인원이 정해져 있으면 그 뒤는 빠짐으로 둔다.
  async trimStarters() {
    const gr = grade(), n = Number(gr.starters), m = Number(gr.subs) || 0, up = {}, ps = playersOf(S.teamId);
    const on = ps.filter((p) => slotOf(p) === 'on'), rest = ps.filter((p) => slotOf(p) !== 'on');
    const first = on.length >= n ? on.slice(0, n) : on.concat(rest.slice(0, n - on.length));
    const others = ps.filter((p) => !first.includes(p));
    const wasBench = others.filter((p) => slotOf(p) !== 'off'), wasOff = others.filter((p) => slotOf(p) === 'off');
    const bench = m ? wasBench.slice(0, m) : wasBench;
    ps.forEach((p) => { const slot = first.includes(p) ? 'on' : bench.includes(p) ? 'bench' : wasOff.includes(p) || m ? 'off' : 'bench'; if (slot !== slotOf(p)) { up[`${p.pid}/bench`] = slot !== 'on'; up[`${p.pid}/off`] = slot === 'off'; } });
    if (Object.keys(up).length) await S.store.update(`${teamPath()}/players`, up);
  },
  delPlayer(d) { return S.store.remove(`${teamPath()}/players/${d.pid}`); },
  pasteAsk() { openSheet({ type: 'paste' }); },
  async savePaste() {
    const text = val('paste'); if (!text) return toast('명단을 적어 주세요.');
    const up = {};
    if (S.sheet.to === 'school') {
      for (const p of parseLines(text, Math.max(0, ...studentsOf(S.classId).map((x) => Number(x.no) || 0)))) up[S.store.id()] = p;
      await S.store.update(`${schoolPath()}/${S.classId}/students`, up);
    } else {
      const ps = playersOf(S.teamId), all = [...ps];
      for (const p of parseLines(text, Math.max(0, ...ps.map((x) => Number(x.no) || 0)))) { const q = { ...p, ...nextSlot(all) }; all.push(q); up[S.store.id()] = q; }
      await S.store.update(`${teamPath()}/players`, up);
    }
    S.sheet = null; render(true);
  },
  addClass() { openSheet({ type: 'class' }); },
  async saveClass() {
    const name = val('nc-name'); if (!name) return toast('반 이름을 적어 주세요.');
    const id = S.store.id(); await S.store.set(`${schoolPath()}/${id}`, { name });
    S.classId = id; S.sheet = null; render(true);
  },
  pickClass(d) { S.classId = d.id; render(true); },
  delClassAsk() { openSheet({ type: 'confirm', title: `${S.school[S.classId].name} 명단을 지울까요?`, text: '이미 팀에 넣은 선수는 그대로 남습니다.', yes: '지우기', run: 'delClass' }); },
  async delClass() { const id = S.classId; S.classId = null; await S.store.remove(`${schoolPath()}/${id}`); },
  async addStudent() {
    const name = val('s-name'); if (!name) return toast('학생 이름을 적어 주세요.');
    const no = val('s-no') || String(Math.max(0, ...studentsOf(S.classId).map((p) => Number(p.no) || 0)) + 1);
    await S.store.set(`${schoolPath()}/${S.classId}/students/${S.store.id()}`, { no, name });
    render(true); const el = document.getElementById('s-name'); if (el) el.focus();
  },
  delStudent(d) { return S.store.remove(`${schoolPath()}/${S.classId}/students/${d.sid}`); },
  pasteSchoolAsk() { openSheet({ type: 'paste', to: 'school' }); },
  importAsk() {
    const list = classList();
    if (!list.length) return openSheet({ type: 'confirm', title: '학교 명단이 아직 없습니다', text: '대회 설정의 "학교 명단 등록"에서 학년·반 명단을 먼저 등록하면, 여기서 체크해서 불러올 수 있습니다.', yes: '학교 명단 등록하러 가기', run: 'goSchool' });
    return openSheet({ type: 'import', cid: list[0].id, picked: {} });
  },
  goSchool() { location.hash = 'school'; },
  importTog(d) { const p = S.sheet.picked; if (p[d.sid]) delete p[d.sid]; else p[d.sid] = true; render(true); },
  importAll() { const ps = studentsOf(S.sheet.cid); S.sheet.picked = Object.keys(S.sheet.picked).length === ps.length ? {} : Object.fromEntries(ps.map((p) => [p.sid, true])); render(true); },
  async importGo() {
    const cur = playersOf(S.teamId), have = new Set(cur.map((p) => `${p.no}/${p.name}`));
    let n = 0; const up = {}, all = [...cur];
    for (const p of studentsOf(S.sheet.cid).filter((x) => S.sheet.picked[x.sid])) {
      if (have.has(`${p.no}/${p.name}`)) continue;
      const q = { no: String(p.no), name: p.name, ...nextSlot(all) }; all.push(q); up[S.store.id()] = q; n++;
    }
    if (n) await S.store.update(`${teamPath()}/players`, up);
    S.sheet = null; render(true); toast(n ? `${n}명을 넣었습니다.` : '고른 학생이 이미 모두 들어 있습니다.');
  },
  async newCode() {
    const code = await freshCode();
    if (S.code) await S.store.remove(`codes/${S.code}`);
    await S.store.set(`s/${S.tid}`, { code }); await S.store.set(`codes/${code}`, S.tid);
    S.code = code; render(true); toast('새 코드를 만들었습니다. 예전 코드는 쓸 수 없습니다.');
  },
  kick(d) { return S.store.remove(`m/${S.tid}/${d.uid}`); },
  recPick(d) { S.rec.key = d.key; render(true); },
  recBoard() { const on = T().display && T().display.mode === 'records'; return S.store.set(`t/${S.tid}/display`, on ? null : { mode: 'records', gid: grade().id }); },
  tab(d) { S.tab = d.tab; render(true); },
  boardNext() { const live = gradeList().flatMap((g) => gamesOf(g.id)).filter((g) => g.status === 'live').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)); const i = live.findIndex((g) => g.id === S.boardGame); S.boardGame = (live[(Math.max(i, 0) + 1) % live.length] || {}).id; render(true); },
  closeSheet() { S.sheet = null; render(true); },
  async confirmYes() { const run = S.sheet.run; await actions[run](); S.sheet = null; render(true); },
};

const changes = {
  pickGrade(el) { actions.pickGrade({ gid: el.value }); },
  tName(el) { const v = el.value.trim(); if (v) S.store.update(`t/${S.tid}/meta`, { name: v }); },
  teamName(el) { const v = el.value.trim(); if (v) S.store.update(teamPath(), { name: v }); },
  gradeField(el) { const v = el.value.trim(); if (v || el.dataset.key === 'sportName') S.store.update(gradePath(), { [el.dataset.key]: v }); },
  gradeSport(el) { const gr = grade(); S.store.update(gradePath(), { ...L.gradeFromSport(el.value, gr.label), sportName: gr.sportName || '' }); },
  recTeam(el) { S.rec.team = el.value; S.rec.key = null; render(true); },
  recSort(el) { S.rec.sort = el.value; render(true); },
  memberRole(el) { S.store.update(`m/${S.tid}/${el.dataset.uid}`, { role: el.value }).catch((e) => toast(friendly(e))); },
  importClass(el) { S.sheet.cid = el.value; S.sheet.picked = {}; render(true); },
  // 시에 13~23을 적으면 오후로, 0은 오전 12시로 바꾼다. 오전·오후를 안 골랐으면 학교 시간에 맞춰 짐작한다.
  whenHour(el) {
    const ap = document.getElementById('w-ampm'), min = document.getElementById('w-min');
    let h = parseInt(el.value, 10);
    if (Number.isNaN(h)) { el.value = ''; ap.value = ''; return; }
    h = Math.min(23, Math.max(0, h));
    if (h >= 13) { ap.value = 'pm'; h -= 12; } else if (h === 0) { ap.value = 'am'; h = 12; } else if (!ap.value) ap.value = h === 12 || h < 7 ? 'pm' : 'am';
    el.value = String(h);
    if (!min.value) min.value = '00';
  },
  whenMin(el) { const m = parseInt(el.value, 10); el.value = Number.isNaN(m) ? '' : String(Math.min(59, Math.max(0, m))).padStart(2, '0'); },
};

// ---------- 시작 ----------
function tick() {
  const now = S.store.now();
  for (const el of document.querySelectorAll('[data-clock]')) {
    const g = gameOf(el.dataset.clock); if (!g) continue;
    const left = L.clockLeft(g, now), text = L.fmtClock(left);
    if (el.textContent !== text) el.textContent = text;
    if (MODE === 'teacher' && g.status === 'live' && g.clock && g.clock.run && left <= 0 && !tick.busy) {
      tick.busy = true; act(g.id, L.timeUp).finally(() => { tick.busy = false; });
    }
  }
}

async function main() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled && actions[el.dataset.act]) { if (el.tagName !== 'A') e.preventDefault(); Promise.resolve(actions[el.dataset.act](el.dataset, el)).catch((err) => toast(friendly(err))); return; }
    if (e.target.id === 'sheet') actions.closeSheet();
  });
  document.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el && changes[el.dataset.change]) changes[el.dataset.change](el); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.enter && actions[e.target.dataset.enter]) { e.preventDefault(); actions[e.target.dataset.enter]({}); } });
  document.addEventListener('focusout', () => setTimeout(() => { if (S.dirty) render(); }, 200));
  window.addEventListener('hashchange', () => { S.sheet = null; window.scrollTo(0, 0); render(true); if (MODE === 'teacher' && S.tid && T().meta && grade()) syncBracket(grade().id); });
  try { S.store = await createStore(MODE); } catch (e) { document.getElementById('app').innerHTML = '<div class="app"><p class="note pad mt">연결하지 못했습니다. 인터넷을 확인하고 다시 열어 주세요.</p></div>'; return; }
  setInterval(tick, 250);
  if (MODE === 'teacher') { S.store.onAuth(afterAuth); await afterAuth(); } else { openT(params.get('v') || params.get('b') || params.get('o')); render(true); }
}

main();
