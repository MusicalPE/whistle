// 휘슬! 화면. 주소에 따라 선생님 화면, 학생 화면(?v=대회), 전광판(?b=대회)으로 열린다.
import { VERSION } from './version.js';
import * as L from './logic.js';
import { createStore, forceDemo, CONFIGURED } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const MODE = params.get('v') ? 'student' : params.get('b') ? 'board' : 'teacher';
const BASE = location.origin + location.pathname;
const S = {
  store: null, tid: null, T: null, M: {}, my: [], gid: null, sheet: null, tab: 'live', teamId: null,
  sub: {}, rec: { team: '', sort: 'goals', key: null }, boardGame: null, off: [], dirty: false, code: '',
  school: {}, classId: null, offSchool: null,
};

// ---------- 자료 읽기 ----------
const T = () => S.T || {};
const uid = () => (S.store.user ? S.store.user.uid : '');
const isOwner = () => !!T().meta && T().meta.owner === uid();
const gradeList = () => Object.entries(T().grades || {}).map(([id, g]) => ({ id, ...g })).sort((a, b) => (a.order || 0) - (b.order || 0));
const grade = () => { const list = gradeList(); return list.find((g) => g.id === S.gid) || list[0] || null; };
const teamsOf = (gid) => Object.fromEntries(Object.entries(T().teams || {}).filter(([, t]) => t.gid === gid));
const teamName = (id) => ((T().teams || {})[id] || {}).name || '(지워진 팀)';
const playersOf = (teamId) => Object.entries(((T().teams || {})[teamId] || {}).players || {}).map(([pid, p]) => ({ pid, ...p })).sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0) || String(a.name).localeCompare(String(b.name), 'ko'));
const gameOf = (id) => {
  const g = (T().games || {})[id]; const gr = g && (T().grades || {})[g.gid];
  return gr ? L.norm({ id, ...JSON.parse(JSON.stringify(g)) }, gr) : null;
};
const gamesOf = (gid) => Object.keys(T().games || {}).map(gameOf).filter((g) => g && g.gid === gid).sort((a, b) => a.no - b.no);
const logsOf = (gameId) => Object.entries((T().logs || {})[gameId] || {}).map(([id, l]) => ({ id, ...l })).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
const ctxFor = (g) => ({
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
const lineupOf = (g, side, state) => playersOf(g[side]).filter((p) => g.lineup[side][p.pid] === state);
const statusText = (g) => (g.status === 'ready' ? '예정' : g.status === 'done' ? '종료' : g.clock && !g.clock.run ? '멈춤' : '진행 중');
const scoreText = (g) => (g.status === 'ready' ? 'vs' : `${g.sa} : ${g.sb}`);

const friendly = (e) => (/permission/i.test((e && e.message) || '') ? '권한이 없습니다. 대회 만든 사람만 할 수 있거나, 보안 규칙이 아직 설정되지 않았습니다.' : (e && e.message) || '문제가 생겼습니다.');

function toast(msg) {
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
    await S.store.tx(`t/${S.tid}/games/${gameId}`, (g) => { logs = fn(g, gr, ctxFor(g)) || []; return JSON.parse(JSON.stringify(g)); });
    for (const l of logs) await S.store.push(`t/${S.tid}/logs/${gameId}`, l);
    return true;
  } catch (e) { toast(friendly(e)); return false; }
}

// ---------- 공통 조각 ----------
const brand = () => `<div class="brand"><img src="icons/icon.svg" alt=""><b>휘슬!</b><span>Whistle</span></div>`;
const demoBar = () => (S.store.demo ? `<div class="demo">미리보기 · 이 기기 안에만 저장됩니다</div>` : '');
const logRow = (l) => `<div class="log${l.x ? ' cut' : ''}"><b>${esc(l.tag)}</b><span>${esc(l.text)}${l.x ? ' (취소)' : ''}</span></div>`;
const clockSpan = (g, cls = '') => `<span class="num ${cls}" data-clock="${g.id}">${L.fmtClock(L.clockLeft(g, S.store.now()))}</span>`;
function qrSvg(url) {
  try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch { return ''; }
}
const nav = (on) => {
  const items = [['home', '홈'], ['games', '경기']];
  if (isOwner()) items.push(['teams', '팀 명단'], ['settings', '설정']);
  return `<nav class="nav"><div class="navbrand">${brand()}</div>${items.map(([h, t]) => `<a href="#${h}" class="${on === h ? 'on' : ''}">${t}</a>`).join('')}</nav>`;
};
const gradeSelect = () => `<select class="input" style="width:auto" data-change="pickGrade" aria-label="학년">${gradeList().map((g) => `<option value="${g.id}"${grade() && g.id === grade().id ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select>`;

// 경기 종류에 따라 큰 숫자와 가운데 글씨를 정한다. 학생 화면과 전광판이 같이 쓴다.
function mainScore(g, gr) {
  const done = g.status === 'done';
  if (L.isTimed(gr)) return { a: g.sa, b: g.sb, mid: done ? '종료' : clockSpan(g, 'clk'), sub: done ? '' : `${L.partName(gr, g.cur)} · 남은 시간`, clock: !done };
  if (gr.format === 'innings') return { a: g.sa, b: g.sb, mid: done ? '종료' : L.partName(gr, g.cur, g.half), sub: done ? '' : `${esc(teamName(g.half ? g.b : g.a))} 공격` };
  if (gr.format === 'sets') return done ? { a: g.sa, b: g.sb, mid: '종료', sub: '세트 스코어' } : { a: g.pa[g.cur], b: g.pb[g.cur], mid: `${g.sa} : ${g.sb}`, sub: `세트 스코어 · ${g.cur + 1}세트` };
  return done ? { a: g.sa, b: g.sb, mid: '종료', sub: '세트 스코어' } : { a: g.remain.a, b: g.remain.b, mid: clockSpan(g, 'clk'), sub: `${g.cur + 1}세트 · 남은 인원 · 세트 ${g.sa} : ${g.sb}${g.ext ? ' · 연장' : ''}`, clock: true };
}

function partsTable(g, gr) {
  const n = L.partCount(gr);
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

// ---------- 선생님 화면 ----------
function loginScreen() {
  return `<div class="app">${demoBar()}<div class="top" style="padding-top:72px;align-items:center;gap:12px">
<img src="icons/icon.svg" alt="" width="96" height="96" style="border-radius:22px">
<div class="center"><div class="title" style="font-size:44px">휘슬!</div><div class="num muted" style="font-size:24px;letter-spacing:.06em;font-weight:600">Whistle</div></div>
<p class="note center">스포츠클럽 리그전 경기 커맨드 센터<br>점수 · 교체 · 기록은 선생님 폰으로, 학생은 QR로 실시간</p></div>
<div class="pad stack mt"><button class="btn primary big block" data-act="signIn">${S.store.demo ? '미리보기로 시작' : '구글 계정으로 로그인'}</button>
${S.store.demo ? `<p class="note center">미리보기는 이 기기 안에만 저장되고 다른 기기와 연동되지 않습니다.</p>${CONFIGURED ? '<button class="btn plain" data-act="demoOff">구글 로그인 화면으로 돌아가기</button>' : ''}` : '<button class="btn plain" data-act="demoOn">로그인 없이 미리보기로 둘러보기</button>'}</div>
<div class="spacer"></div><div class="foot">음악적체육인 · v${VERSION}</div></div>`;
}

function listScreen() {
  const rows = S.my.map((t) => `<button class="card game" data-act="openT" data-tid="${t.tid}" style="text-align:left;width:100%"><div class="row between"><b style="font-size:16px">${esc(t.name)}</b><span class="label">${t.owner ? '내가 만든 대회' : '초대받은 대회'}</span></div></button>`).join('');
  return `<div class="app">${demoBar()}<div class="top">${brand()}<h1 class="title">내 대회</h1></div>
<div class="pad stack">${rows || '<p class="note">아직 대회가 없습니다. 아래에서 새 대회를 만들어 보세요.</p>'}
<div class="card p stack mt"><label class="label" for="new-t">새 대회 만들기</label><input id="new-t" class="input" placeholder="예: 햇살초 스포츠클럽 리그" maxlength="40" data-enter="newT"><button class="btn primary" data-act="newT">대회 만들기</button></div>
<div class="card p stack"><label class="label" for="join-code">초대 코드로 참여 (심판 선생님)</label><input id="join-code" class="input" placeholder="예: HW4827" maxlength="12" value="${esc(S.code)}" data-enter="joinT"><button class="btn" data-act="joinT">참여하기</button></div>
<button class="btn plain" data-act="signOut">${S.store.demo ? '미리보기 끝내기' : '구글 계정 로그아웃'}</button></div>
<div class="spacer"></div><div class="foot">음악적체육인 · v${VERSION}</div></div>`;
}

function gameCard(g, href) {
  const live = g.status === 'live';
  const st = live ? `<span class="pill"><span class="dot"></span>${statusText(g)}</span>` : `<span>${statusText(g)}</span>`;
  const gr = T().grades[g.gid];
  const part = live ? ` · ${L.partName(gr, g.cur, g.half)}` : '';
  const inner = `<div class="row between label"><span>${g.no}경기${part}</span>${st}</div><div class="vs"><span class="ta">${esc(teamName(g.a))}</span><span class="num sc">${scoreText(g)}</span><span class="tb right">${esc(teamName(g.b))}</span></div>`;
  return href ? `<a class="card game${live ? ' live' : ''}" href="${href}">${inner}</a>` : `<div class="card game${live ? ' live' : ''}">${inner}</div>`;
}

function homeScreen() {
  const gr = grade();
  const chips = gradeList().map((g) => `<button class="chip${gr && g.id === gr.id ? ' on' : ''}" data-act="pickGrade" data-gid="${g.id}">${esc(g.label)} ${esc(L.sportName(g))}</button>`).join('') + (isOwner() ? `<button class="chip dash" data-act="addGrade">+ 학년 추가</button>` : '');
  const games = gr ? gamesOf(gr.id) : [];
  const owner = isOwner();
  return `<div class="app">${demoBar()}<header class="top">${brand()}
<div class="row between"><h1 class="title">${esc(T().meta.name)}</h1></div>
<div class="row between small muted"><button class="btn plain" style="height:44px;padding:0" data-act="leaveT">대회 목록</button><a href="#members" class="bold" style="padding:10px 0">함께하는 선생님 ${Object.keys(S.M || {}).length || 1}명${owner ? ' · 초대' : ''}</a></div></header>
<div class="chips">${chips}</div>
<div class="cols"><div class="col"><section class="dark row" style="margin:12px 20px 0;gap:16px"><div class="qr" style="width:96px;height:96px;flex:0 0 96px">${qrSvg(`${BASE}?v=${S.tid}`)}</div>
<div class="stack grow" style="gap:8px"><b>학생용 화면 QR</b><span class="note">로그인 없이 출전 명단과 점수를 실시간으로 봅니다.</span><button class="btn sm white" style="align-self:flex-start" data-act="showQR">크게 띄우기</button></div></section>
<div class="grid2" style="margin:10px 20px 0"><a class="btn sm" href="${BASE}?b=${S.tid}">전광판 모드</a><button class="btn sm" data-act="copy" data-text="${BASE}?b=${S.tid}" data-msg="전광판 주소를 복사했습니다.">전광판 주소 복사</button></div></div>
<div class="col"><section class="pad stack" style="padding-top:14px;padding-bottom:16px">${gr ? `<div class="row between"><h2 class="h2">${esc(gr.label)} 경기</h2><span class="small muted">${games.length}경기</span></div>
${games.map((g) => gameCard(g, `#game/${g.id}`)).join('') || `<p class="note">${owner ? (Object.keys(teamsOf(gr.id)).length < 2 ? '먼저 팀 명단에서 팀을 두 팀 이상 만들어 주세요.' : '아래 단추로 첫 경기를 만들어 보세요.') : '아직 경기가 없습니다.'}</p>`}
<div class="grid2">${owner ? `<button class="btn sm dash" data-act="addGame">+ 경기 추가</button>` : ''}<a class="btn sm" href="#records">개인 기록</a></div>` : `<p class="note">${owner ? '위의 "+ 학년 추가"로 학년과 종목을 먼저 정해 주세요.' : '아직 학년이 없습니다.'}</p>`}</section></div></div>
${nav('home')}</div>`;
}

function gamesScreen() {
  const live = gradeList().flatMap((g) => gamesOf(g.id)).filter((g) => g.status === 'live');
  return `<div class="app">${demoBar()}<header class="top"><h1 class="title" style="font-size:22px">진행 중인 경기</h1></header>
<div class="pad stack">${live.map((g) => `<div class="label">${esc(T().grades[g.gid].label)} ${esc(L.sportName(T().grades[g.gid]))}</div>${gameCard(g, `#game/${g.id}`)}`).join('') || '<p class="note">진행 중인 경기가 없습니다. 홈에서 경기를 골라 시작해 주세요.</p>'}</div>${nav('games')}</div>`;
}

function controls(g, gr) {
  const n = L.partCount(gr), last = g.cur >= n - 1;
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
  if (!g) return `<div class="app"><div class="bar"><a class="back" href="#home">‹ 홈</a></div><p class="note pad">경기를 찾을 수 없습니다.</p></div>`;
  const gr = T().grades[g.gid];
  const head = `<header class="bar"><a class="back" href="#home">‹ 홈</a><b style="font-size:15px">${g.no}경기${g.status === 'live' ? ` · ${L.partName(gr, g.cur, g.half)}` : ''}</b><span class="pill">${g.status === 'live' ? '<span class="dot"></span>' : ''}${statusText(g)}</span></header>`;
  const logs = logsOf(id);
  const logBox = logs.length ? `<section class="pad stack" style="gap:4px;margin-top:12px"><h2 class="label">경기 기록 · 득점과 교체가 자동으로 남습니다</h2>${logs.slice(0, g.status === 'done' ? 40 : 6).map(logRow).join('')}</section>` : '';
  if (g.status === 'ready') {
    const ros = (side) => `<div class="card lineup ${side}"><b class="t${side}">${esc(teamName(g[side]))}</b><span class="label">선발</span>${playersOf(g[side]).filter((p) => !p.bench).map((p) => `<span><b>${esc(p.no)}</b> ${esc(p.name)}</span>`).join('') || '<span class="muted">없음</span>'}<span class="label">교체</span>${playersOf(g[side]).filter((p) => p.bench).map((p) => `<span class="muted"><b>${esc(p.no)}</b> ${esc(p.name)}</span>`).join('') || '<span class="muted">없음</span>'}</div>`;
    return `<div class="app">${demoBar()}${head}<div class="cols"><div class="col"><section class="dark stack center" style="margin:0 20px"><span class="label">${esc(gr.label)} ${esc(L.sportName(gr))} · ${L.FORMAT_NAMES[gr.format]}</span><div style="font-size:22px;font-weight:900"><span class="ta">${esc(teamName(g.a))}</span> vs <span class="tb">${esc(teamName(g.b))}</span></div><button class="btn big white block" data-act="gStart" data-id="${id}">경기 시작</button><span class="note">시작하면 지금 팀 명단의 선발·교체가 이 경기에 적용됩니다.</span></section>${isOwner() ? `<div class="center mt"><button class="btn plain" data-act="delGame" data-id="${id}">이 경기 지우기</button></div>` : ''}</div>
<div class="col"><section class="grid2" style="margin:12px 20px 0">${ros('a')}${ros('b')}</section></div></div>${nav('games')}</div>`;
  }
  const liveNow = g.status === 'live';
  const btns = (side) => {
    if (!liveNow) return '';
    if (gr.format === 'dodge') return `<div class="btns"><button class="btn s${side} grow" data-act="dOut" data-id="${id}" data-team="${side}" data-d="-1">아웃 −1</button><button class="btn minus" data-act="dOut" data-id="${id}" data-team="${side}" data-d="1" aria-label="${esc(teamName(g[side]))} 한 명 되살아남">+1</button></div>`;
    const steps = gr.steps === '123' && L.isTimed(gr) ? [1, 2, 3] : [1];
    return `<div class="btns"><button class="btn minus" data-act="gMinus" data-id="${id}" data-team="${side}" aria-label="${esc(teamName(g[side]))} 점수 1점 빼기">−</button>${steps.map((p) => `<button class="btn s${side} grow" style="padding:0" data-act="gPlus" data-id="${id}" data-team="${side}" data-pts="${p}">+${p}${steps.length === 1 ? ' 득점' : ''}</button>`).join('')}</div>`;
  };
  let topBox, a, b, hint = '';
  if (L.isTimed(gr)) {
    topBox = `<div class="stack center" style="gap:2px"><span class="label">${liveNow ? '남은 시간' : '최종 점수'}</span>${liveNow ? clockSpan(g, 'clock') : ''}<span class="note">${L.FORMAT_NAMES[gr.format]} · 구간마다 ${gr.minutes}분</span></div>`;
    a = g.sa; b = g.sb; hint = liveNow ? '+를 누르면 득점 선수를 고릅니다' : '';
  } else if (gr.format === 'innings') {
    topBox = `<div class="stack center" style="gap:2px"><span class="label">${liveNow ? '지금' : '최종 점수'}</span>${liveNow ? `<b style="font-size:24px">${L.partName(gr, g.cur, g.half)} · ${esc(teamName(g.half ? g.b : g.a))} 공격</b>` : ''}<span class="note">${gr.innings}회 경기</span></div>`;
    a = g.sa; b = g.sb;
  } else if (gr.format === 'sets') {
    topBox = `<div class="stack center" style="gap:2px"><span class="label">세트 스코어</span><span class="num" style="font-size:44px">${g.sa} : ${g.sb}</span><span class="note">${gr.sets}세트 중 ${Math.floor(gr.sets / 2) + 1}세트 먼저 · 세트마다 ${gr.setPoints}점</span></div>`;
    a = liveNow ? g.pa[g.cur] : g.sa; b = liveNow ? g.pb[g.cur] : g.sb;
    if (liveNow && Math.max(a, b) >= Number(gr.setPoints)) hint = `${gr.setPoints}점이 됐습니다. 세트를 끝내려면 아래 "${g.cur + 1}세트 끝내기"를 누르세요.`;
  } else {
    topBox = `<div class="grid2 center"><div class="stack" style="gap:2px"><span class="label">세트 스코어</span><span class="num" style="font-size:44px">${g.sa} : ${g.sb}</span><span class="note">${gr.sets}세트 중 ${Math.floor(gr.sets / 2) + 1}세트 먼저</span></div><div class="stack" style="gap:2px"><span class="label">${g.ext ? '연장' : '세트 남은 시간'}</span><span style="font-size:44px;line-height:1">${clockSpan(g, '')}</span><span class="note">한 세트 ${gr.minutes}분</span></div></div>`;
    a = liveNow ? g.remain.a : g.sa; b = liveNow ? g.remain.b : g.sb;
    hint = liveNow ? (g.ext ? '연장입니다. 먼저 한 명을 아웃시키는 팀이 이깁니다.' : '숫자는 남은 인원입니다. 0명이 되면 세트가 바로 끝납니다.') : '';
  }
  const tie = g.tie ? `<section class="card p stack" style="margin:10px 20px 0;border:2px solid var(--ink)"><b style="font-size:17px">시간 종료 · 남은 인원이 같습니다 (${g.remain.a} : ${g.remain.b})</b><span class="note">이 세트를 어떻게 할까요?</span><div class="grid2"><button class="btn primary" data-act="dTie" data-id="${id}" data-choice="draw">무승부로 끝내기</button><button class="btn" data-act="dTie" data-id="${id}" data-choice="ext">연장 하기</button></div></section>` : '';
  const board = `<section class="dark stack" style="margin:0 20px;gap:10px">${topBox}<div class="score">
<div><span class="name ta">${esc(teamName(g.a))}</span><span class="num big" data-score="a">${a}</span>${btns('a')}</div>
<div><span class="name tb">${esc(teamName(g.b))}</span><span class="num big" data-score="b">${b}</span>${btns('b')}</div></div>${hint ? `<span class="note center">${hint}</span>` : ''}</section>`;
  const table = partsTable(g, gr);
  return `<div class="app">${demoBar()}${head}<div class="cols"><div class="col">${board}${tie}${liveNow && !g.tie ? controls(g, gr) : ''}</div><div class="col">${liveNow ? cardsRow(g, gr) : ''}${table ? `<section style="margin:10px 20px 0">${table}</section>` : ''}${logBox}</div></div><div style="height:16px"></div>${nav('games')}</div>`;
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
  if (!gr) return `<div class="app">${demoBar()}<header class="top"><h1 class="title" style="font-size:22px">팀 명단</h1></header><p class="note pad">홈에서 학년을 먼저 추가해 주세요.</p>${nav('teams')}</div>`;
  const teams = teamsOf(gr.id), ids = Object.keys(teams);
  if (!teams[S.teamId]) S.teamId = ids[0] || null;
  const t = teams[S.teamId], ps = t ? playersOf(S.teamId) : [];
  const starters = ps.filter((p) => !p.bench).length;
  const card = t ? `<section class="card" style="margin:12px 20px 0"><div class="set"><label for="t-name">팀 이름</label><input id="t-name" class="input" value="${esc(t.name)}" maxlength="20" data-change="teamName"></div>
<div class="set" style="border-bottom:1px solid var(--line)"><span class="muted small">선수 ${ps.length}명 · 선발 ${starters} / 교체 ${ps.length - starters}${starters !== Number(gr.starters) ? ` · 설정의 선발 인원은 ${gr.starters}명` : ''}</span></div>
${ps.map((p) => `<div class="prow"><span class="no">${esc(p.no)}</span><span class="grow">${esc(p.name)}</span><div class="seg"><button class="${p.bench ? '' : 'on'}" data-act="setBench" data-pid="${p.pid}" data-bench="0" aria-pressed="${!p.bench}">선발</button><button class="${p.bench ? 'on' : ''}" data-act="setBench" data-pid="${p.pid}" data-bench="1" aria-pressed="${!!p.bench}">교체</button></div><button class="x" data-act="delPlayer" data-pid="${p.pid}" aria-label="${esc(p.name)} 지우기">×</button></div>`).join('')}
<div class="prow" style="gap:6px;padding:8px"><input id="p-no" class="input" style="width:64px" inputmode="numeric" placeholder="번호" maxlength="3" aria-label="등번호"><input id="p-name" class="input" placeholder="이름" maxlength="12" aria-label="선수 이름" data-enter="addPlayer"><button class="btn sm primary" data-act="addPlayer">추가</button></div>
<div class="grid2" style="padding:0 8px 8px"><button class="btn sm" data-act="importAsk">학교 명단에서 불러오기</button><button class="btn sm" data-act="pasteAsk">명단 붙여넣기</button></div>
<div class="center" style="padding-bottom:6px"><button class="btn sm plain" data-act="delTeam">이 팀 지우기</button></div></section>` : `<p class="note pad mt">"+ 팀 추가"로 팀을 만들어 주세요.</p>`;
  return `<div class="app narrow">${demoBar()}<header class="top" style="flex-direction:row;align-items:center;justify-content:space-between"><h1 class="title" style="font-size:22px">팀 명단</h1>${gradeSelect()}</header>
<div class="chips">${ids.map((id) => `<button class="chip${id === S.teamId ? ' on' : ''}" data-act="pickTeam" data-id="${id}">${esc(teams[id].name)}</button>`).join('')}<button class="chip dash" data-act="addTeam">+ 팀 추가</button></div>${card}
<p class="note pad" style="padding-top:10px;padding-bottom:16px">선발과 교체는 경기 전에 정해 두면, 경기를 시작할 때 그대로 적용됩니다.</p>${nav('teams')}</div>`;
}

function settingsScreen() {
  const gr = grade();
  const stepper = (key, val, unit, min, max, label) => `<div class="stepper"><button data-act="step" data-key="${key}" data-d="-1" data-min="${min}" data-max="${max}" aria-label="${label} 줄이기">−</button><b>${val}${unit}</b><button data-act="step" data-key="${key}" data-d="1" data-min="${min}" data-max="${max}" aria-label="${label} 늘리기">+</button></div>`;
  const seg = (key, val, opts) => `<div class="seg" style="margin-right:6px">${opts.map(([v, t]) => `<button class="${String(val) === String(v) ? 'on' : ''}" data-act="setGrade" data-key="${key}" data-val="${v}" aria-pressed="${String(val) === String(v)}">${t}</button>`).join('')}</div>`;
  let rules = '';
  if (gr) {
    const f = gr.format, sp = L.SPORTS[gr.sport] || L.SPORTS.custom;
    rules = `<h2 class="label" style="padding:14px 20px 6px">${esc(gr.label)} 종목과 규칙</h2><section class="card" style="margin:0 20px">
<div class="set"><label for="g-label">학년 이름</label><input id="g-label" class="input" value="${esc(gr.label)}" maxlength="12" data-change="gradeField" data-key="label"></div>
<div class="set"><label for="g-sport">종목</label><select id="g-sport" class="input" data-change="gradeSport">${Object.entries(L.SPORTS).map(([k, s]) => `<option value="${k}"${k === gr.sport ? ' selected' : ''}>${s.name}</option>`).join('')}</select></div>
${gr.sport === 'custom' ? `<div class="set"><label for="g-sname">종목 이름</label><input id="g-sname" class="input" value="${esc(gr.sportName || '')}" maxlength="12" placeholder="예: 킨볼" data-change="gradeField" data-key="sportName"></div>` : ''}
<div class="set"><label for="g-format">경기 방식</label><select id="g-format" class="input" data-change="gradeField" data-key="format">${sp.formats.map((k) => `<option value="${k}"${k === f ? ' selected' : ''}>${L.FORMAT_NAMES[k]}</option>`).join('')}</select></div>
${L.hasClock(gr) ? `<div class="set"><span>${f === 'dodge' ? '한 세트 시간' : f === 'single' ? '경기 시간' : '구간마다 시간'}</span>${stepper('minutes', gr.minutes, '분', 1, 60, '시간')}</div>` : ''}
${f === 'sets' || f === 'dodge' ? `<div class="set"><span>세트 수</span>${stepper('sets', gr.sets, '세트', 1, 9, '세트 수')}</div>` : ''}
${f === 'sets' ? `<div class="set"><span>세트 점수</span>${stepper('setPoints', gr.setPoints, '점', 5, 50, '세트 점수')}</div>` : ''}
${f === 'innings' ? `<div class="set"><span>이닝 수</span>${stepper('innings', gr.innings, '회', 1, 9, '이닝 수')}</div>` : ''}
<div class="set"><span>선발 인원</span>${stepper('starters', gr.starters, '명', 1, 30, '선발 인원')}</div>
<div class="set"><span>교체 카드 <span class="muted">(팀마다 · 0은 제한 없음)</span></span>${stepper('cards', gr.cards, '장', 0, 20, '교체 카드')}</div>
<div class="set"><span>나간 선수 다시 들어가기</span>${seg('reentry', gr.reentry ? 1 : 0, [[1, '허용'], [0, '금지']])}</div>
${L.isTimed(gr) ? `<div class="set"><span>득점 단추</span>${seg('steps', gr.steps, [['1', '1점씩'], ['123', '1·2·3점']])}</div>` : ''}</section>
<p class="note pad" style="padding-top:6px">종목을 바꾸면 규칙이 그 종목 기본값으로 채워집니다. 이미 시작한 경기가 있을 때는 경기 방식을 바꾸지 않는 것이 좋습니다.</p>
<div class="center"><button class="btn plain" data-act="delGradeAsk">${esc(gr.label)} 지우기</button></div>`;
  }
  return `<div class="app narrow">${demoBar()}<header class="top" style="flex-direction:row;align-items:center;justify-content:space-between"><h1 class="title" style="font-size:22px">경기 설정</h1>${gr ? gradeSelect() : ''}</header>
<h2 class="label" style="padding:6px 20px">대회 (모든 학년 공통)</h2><section class="card" style="margin:0 20px"><div class="set"><label for="t-title">대회 이름</label><input id="t-title" class="input" value="${esc(T().meta.name)}" maxlength="40" data-change="tName"></div></section>
<div class="pad" style="padding-top:10px"><a class="btn sm block" href="#school">학교 명단 등록 (선택)</a><p class="note" style="padding-top:6px">학년·반 명단을 한 번 등록해 두면, 팀 명단을 만들 때 체크해서 불러올 수 있습니다.</p></div>
${rules || '<p class="note pad mt">홈에서 학년을 먼저 추가해 주세요.</p>'}
<div class="center mt"><button class="btn plain" data-act="signOut">${S.store.demo ? '미리보기 끝내기' : '구글 계정 로그아웃'}</button></div><div class="foot">음악적체육인 · v${VERSION}</div>${nav('settings')}</div>`;
}

function schoolScreen() {
  const list = classList();
  if (!S.school[S.classId]) S.classId = (list[0] || {}).id || null;
  const c = S.school[S.classId], ps = c ? studentsOf(S.classId) : [];
  const card = c ? `<section class="card" style="margin:12px 20px 0"><div class="set" style="border-bottom:1px solid var(--line)"><b>${esc(c.name)}</b><span class="muted small" style="margin-right:6px">${ps.length}명</span></div>
${ps.map((p) => `<div class="prow"><span class="no">${esc(p.no)}</span><span class="grow">${esc(p.name)}</span><button class="x" data-act="delStudent" data-sid="${p.sid}" aria-label="${esc(p.name)} 지우기">×</button></div>`).join('')}
<div class="prow" style="gap:6px;padding:8px"><input id="s-no" class="input" style="width:64px" inputmode="numeric" placeholder="번호" maxlength="3" aria-label="번호"><input id="s-name" class="input" placeholder="이름" maxlength="12" aria-label="학생 이름" data-enter="addStudent"><button class="btn sm primary" data-act="addStudent">추가</button></div>
<div class="grid2" style="padding:0 8px 10px"><button class="btn sm" data-act="pasteSchoolAsk">명단 붙여넣기</button><button class="btn sm plain" data-act="delClassAsk">이 반 지우기</button></div></section>` : `<p class="note pad mt">"+ 반 추가"로 반을 만들어 주세요.</p>`;
  return `<div class="app narrow">${demoBar()}<header class="bar" style="justify-content:flex-start"><a class="back" href="#settings">‹ 설정</a><h1>학교 명단 <span class="muted" style="font-size:13px;font-weight:500">· 선택</span></h1></header>
<p class="note pad" style="padding-bottom:10px">학년·반 명단을 한 번 등록해 두면, 팀 명단을 만들 때 체크해서 불러올 수 있습니다. 쓰지 않아도 됩니다. 이 명단은 내 계정에만 저장되고, 학생 화면이나 다른 선생님에게는 보이지 않습니다.</p>
<div class="chips">${list.map((x) => `<button class="chip${x.id === S.classId ? ' on' : ''}" data-act="pickClass" data-id="${x.id}">${esc(x.name)}</button>`).join('')}<button class="chip dash" data-act="addClass">+ 반 추가</button></div>${card}<div style="height:16px"></div>${nav('settings')}</div>`;
}

function membersScreen() {
  const owner = isOwner();
  const list = Object.entries(S.M || {}).sort((a, b) => (a[1].role === 'owner' ? -1 : 1) - (b[1].role === 'owner' ? -1 : 1));
  const codeBox = owner ? `<section class="dark stack" style="margin:4px 20px 0"><span class="label">${esc(T().meta.name)} · 초대 코드</span><span class="num" style="font-size:52px;letter-spacing:.08em">${esc(S.code || '······')}</span><span class="note">초대받은 선생님이 구글로 로그인하고 코드를 넣으면, 이 대회의 경기를 함께 진행할 수 있습니다.</span>
<div class="grid2"><button class="btn sm white" data-act="copy" data-text="${BASE}?join=${esc(S.code)}" data-msg="초대 링크를 복사했습니다.">초대 링크 복사</button><button class="btn sm" data-act="newCode">코드 새로 만들기</button></div></section>` : '';
  const people = `<section class="pad stack" style="padding-top:18px"><h2 class="h2" style="font-size:14px">참여 중 <span class="muted" style="font-weight:500">· ${list.length}명</span></h2><div class="card">${list.map(([id, m]) => `<div class="set" style="min-height:60px"><b>${id === uid() ? '나' : esc(m.name)}</b>${m.role === 'owner' ? '<span class="tagbox" style="margin-right:6px">대회 만든 사람</span>' : owner ? `<button class="btn plain" data-act="kick" data-uid="${id}">내보내기</button>` : '<span class="small muted" style="margin-right:6px">심판</span>'}</div>`).join('')}</div></section>`;
  const info = `<section class="card p stack" style="margin:16px 20px 0;gap:6px"><h2 class="h2" style="font-size:13px">초대받은 선생님이 할 수 있는 일</h2><p class="note">경기 진행만 맡습니다. 경기 시작·종료, 점수, 득점 선수, 선수 교체를 할 수 있고, 한 경기를 여러 선생님이 같이 조작할 수 있습니다.</p><p class="note">팀 명단, 경기 설정, 초대, 경기 추가·삭제는 대회 만든 사람만 합니다.</p></section>`;
  return `<div class="app">${demoBar()}<header class="bar" style="justify-content:flex-start"><a class="back" href="#home">‹ 홈</a><h1>함께하는 선생님</h1></header>
<div class="cols"><div class="col">${codeBox}${owner ? info : people}</div><div class="col">${owner ? people : info}</div></div>
${owner ? '' : `<div class="center mt"><button class="btn plain" data-act="quitT">이 대회에서 나가기</button></div>`}<div class="spacer"></div>${nav('home')}</div>`;
}

function recordRows() {
  const gr = grade();
  if (!gr) return [];
  let rows = L.records(T().teams || {}, gamesOf(gr.id), T().logs || {});
  if (S.rec.team) rows = rows.filter((r) => r.teamId === S.rec.team);
  const by = S.rec.sort;
  rows.sort((x, y) => (by === 'no' ? (Number(x.no) || 0) - (Number(y.no) || 0) : by === 'games' ? y.games - x.games || y.goals - x.goals : y.goals - x.goals || y.games - x.games) || String(x.name).localeCompare(String(y.name), 'ko'));
  rows.forEach((r, i) => { const p = rows[i - 1]; r.rank = by === 'goals' && p && p.goals === r.goals ? p.rank : i + 1; });
  return rows;
}

function recordsScreen() {
  const gr = grade(), rows = recordRows(), sel = rows.find((r) => r.key === S.rec.key) || rows[0];
  const shown = T().display && T().display.mode === 'records';
  const cols = '28px minmax(0,1fr) 40px 40px 52px';
  if (!gr) return `<div class="app">${demoBar()}<header class="bar" style="justify-content:flex-start"><a class="back" href="#home">‹ 홈</a><h1>개인 기록</h1></header><p class="note pad">학년이 없습니다.</p><div class="spacer"></div>${nav('home')}</div>`;
  const filters = `<div class="grid3">${gradeSelect()}<select class="input" aria-label="팀 고르기" data-change="recTeam"><option value="">모든 팀</option>${Object.entries(teamsOf(gr.id)).map(([id, t]) => `<option value="${id}"${S.rec.team === id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
<select class="input" aria-label="정렬" data-change="recSort">${[['goals', '득점 순'], ['games', '출전 순'], ['no', '번호 순']].map(([v, t]) => `<option value="${v}"${S.rec.sort === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`;
  const table = rows.length ? `<div class="card tbl"><div class="tr th" style="grid-template-columns:${cols}"><span>순위</span><span class="l">선수</span><span>출전</span><span>득점</span><span>교체 투입</span></div>${rows.map((r) => `<button class="tr${sel && r.key === sel.key ? ' sel' : ''}" style="grid-template-columns:${cols}" data-act="recPick" data-key="${r.key}"><b class="num" style="font-size:20px">${r.rank}</b><span class="l"><b>${esc(r.no)} ${esc(r.name)}</b> <span class="small">${esc(r.team)}</span></span><span>${r.games}</span><b>${r.goals}</b><span>${r.subIn}</span></button>`).join('')}</div>` : '<p class="note">아직 기록이 없습니다. 경기를 시작하면 자동으로 모입니다.</p>';
  const detail = sel ? `<section class="dark stack"><div class="row between"><b style="font-size:18px">${esc(sel.no)} ${esc(sel.name)}</b><span class="label">${esc(sel.team)}</span></div><div class="grid3 center">${[['출전 경기', sel.games], ['득점', sel.goals], ['선발 출전', sel.starts]].map(([t, v]) => `<div class="stack" style="gap:2px"><span class="num" style="font-size:36px">${v}</span><span class="note">${t}</span></div>`).join('')}</div><div class="note" style="border-top:1px solid #39424F;padding-top:8px;line-height:1.6">${sel.detail.map(esc).join('<br>')}</div></section>` : '';
  return `<div class="app">${demoBar()}<header class="bar" style="justify-content:flex-start"><a class="back" href="#home">‹ 홈</a><h1>개인 기록 <span class="muted" style="font-size:13px;font-weight:500">· 선생님만</span></h1></header>
<div class="cols"><div class="col pad stack">${filters}${table}</div>
<div class="col pad stack colgap">${isOwner() ? `<button class="btn ${shown ? '' : 'primary'} block" data-act="recBoard">${shown ? '전광판에서 내리기' : '전광판에 띄워서 보여 주기'}</button>` : ''}${detail}<p class="note">학생 화면(QR)에는 나오지 않습니다. 선생님이 전광판에 띄울 때만 보입니다.</p></div></div><div class="spacer"></div>${nav('home')}</div>`;
}

// ---------- 학생 화면 ----------
function lineupCard(g, side, gr) {
  const row = (p, cls = '') => `<span class="${cls}"><b>${esc(p.no)}</b> ${esc(p.name)}</span>`;
  const started = g.status !== 'ready';
  const on = started ? lineupOf(g, side, 'on') : playersOf(g[side]).filter((p) => !p.bench);
  const bench = started ? lineupOf(g, side, 'bench') : playersOf(g[side]).filter((p) => p.bench);
  const out = started ? lineupOf(g, side, 'out') : [];
  const cards = Number(gr.cards) || 0;
  return `<div class="card lineup ${side}"><b class="t${side}">${esc(teamName(g[side]))}</b><span class="label">${started ? '뛰는 중' : '선발'}</span>${on.map((p) => row(p)).join('') || '<span class="muted">-</span>'}
<span class="label" style="border-top:1px solid var(--soft);padding-top:6px;margin-top:4px">교체 선수</span>${bench.map((p) => row(p, 'muted')).join('')}${out.map((p) => `<span class="muted"><b>${esc(p.no)}</b> ${esc(p.name)} <span class="small">나감</span></span>`).join('')}${bench.length + out.length ? '' : '<span class="muted">-</span>'}
${started && cards ? `<b class="small" style="padding-top:4px">교체 카드 ${L.cardsLeft(g, gr, side)}장 남음</b>` : ''}</div>`;
}

function liveBlock(g, gr, withLogs = true) {
  const m = mainScore(g, gr);
  const logs = withLogs ? logsOf(g.id).filter((l) => !l.x).slice(0, 6) : [];
  return `<section class="dark stack" style="gap:10px"><div class="row between small bold"><span class="muted">${g.no}경기${g.status === 'live' ? ` · ${L.partName(gr, g.cur, g.half)}` : ''}</span><span class="row" style="gap:6px">${g.status === 'live' ? '<span class="dot"></span>실시간' : statusText(g)}</span></div>
<div class="row between"><b class="grow ta" style="font-size:16px">${esc(teamName(g.a))}</b><span class="num" style="font-size:64px">${g.status === 'ready' ? 'vs' : `${m.a} : ${m.b}`}</span><b class="grow tb right" style="font-size:16px">${esc(teamName(g.b))}</b></div>
${g.status === 'ready' ? '' : `<div class="row" style="justify-content:center;align-items:baseline;gap:8px"><span class="note">${m.sub}</span><span class="num" style="font-size:28px">${m.mid}</span></div>`}</section>
<div class="grid2">${lineupCard(g, 'a', gr)}${lineupCard(g, 'b', gr)}</div>${logs.length ? `<section class="stack" style="gap:4px"><h2 class="h2">경기 기록</h2>${logs.map(logRow).join('')}</section>` : ''}`;
}

function standingsTable(gr) {
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

// ---------- 전광판 ----------
function boardScreen() {
  if (!T().meta) return `<div class="board"><p>${S.loaded ? '대회를 찾을 수 없습니다.' : '불러오는 중입니다.'}</p></div>`;
  const all = gradeList().flatMap((g) => gamesOf(g.id));
  const hd = (sub) => `<div class="hd"><div><h1>${esc(T().meta.name)}</h1><p>휘슬! · ${sub}</p></div><div class="row" style="gap:16px"><a class="pick row" href="${BASE}" style="text-decoration:none">선생님 화면</a><div class="qr">${qrSvg(`${BASE}?v=${S.tid}`)}</div></div></div>`;
  const d = T().display;
  if (d && d.mode === 'records' && (T().grades || {})[d.gid]) {
    S.gid = d.gid;
    const keep = S.rec; S.rec = { team: '', sort: 'goals', key: null };
    const rows = recordRows().slice(0, 10); S.rec = keep;
    const gr = T().grades[d.gid];
    return `<div class="board">${hd(`${esc(gr.label)} ${esc(L.sportName(gr))} · 개인 기록`)}<table><tr><th>순위</th><th class="l">선수</th><th class="l">팀</th><th>출전</th><th>득점</th><th>교체 투입</th></tr>${rows.map((r) => `<tr><td class="num">${r.rank}</td><td class="l"><b>${esc(r.no)} ${esc(r.name)}</b></td><td class="l">${esc(r.team)}</td><td>${r.games}</td><td><b>${r.goals}</b></td><td>${r.subIn}</td></tr>`).join('') || '<tr><td colspan="6">아직 기록이 없습니다.</td></tr>'}</table></div>`;
  }
  const live = all.filter((g) => g.status === 'live').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const g = live.find((x) => x.id === S.boardGame) || live[0] || all.filter((x) => x.status === 'done').sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0] || all.find((x) => x.status === 'ready');
  if (!g) return `<div class="board">${hd('전광판')}<div class="mid" style="grid-template-columns:1fr"><p class="sub">아직 경기가 없습니다.</p></div></div>`;
  const gr = T().grades[g.gid], m = mainScore(g, gr);
  const box = (side) => `<div class="box ${side}"><div class="row between label"><span>${g.status === 'ready' ? '선발' : '뛰는 중'}</span>${g.status !== 'ready' && Number(gr.cards) ? `<span>교체 카드 ${L.cardsLeft(g, gr, side)}장 남음</span>` : ''}</div><div>${(g.status === 'ready' ? playersOf(g[side]).filter((p) => !p.bench) : lineupOf(g, side, 'on')).map((p) => `${esc(p.no)} ${esc(p.name)}`).join(' · ') || '-'}</div><div class="label">교체 선수 · ${(g.status === 'ready' ? playersOf(g[side]).filter((p) => p.bench) : lineupOf(g, side, 'bench')).map((p) => `${esc(p.no)} ${esc(p.name)}`).join(' · ') || '-'}</div></div>`;
  const logs = logsOf(g.id).filter((l) => !l.x).slice(0, 3);
  return `<div class="board">${hd(`${esc(gr.label)} ${esc(L.sportName(gr))} · ${g.no}경기${g.status === 'live' ? ` ${L.partName(gr, g.cur, g.half)}` : ` ${statusText(g)}`}`)}
<div class="mid"><div><div class="name ta">${esc(teamName(g.a))}</div><div class="num pts">${g.status === 'ready' ? '-' : m.a}</div></div><div><div class="sub">${m.sub || ''}</div><div class="num clk">${g.status === 'ready' ? 'vs' : m.mid}</div>${live.length > 1 ? `<button class="pick" data-act="boardNext">다른 경기 보기 (${live.length})</button>` : ''}</div><div><div class="name tb">${esc(teamName(g.b))}</div><div class="num pts">${g.status === 'ready' ? '-' : m.b}</div></div></div>
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
  if (s.type === 'dup') {
    const g = gameOf(s.id); if (!g) return '';
    return `<div class="sheet" role="dialog" aria-label="같은 득점 확인"><h2>방금 ${esc(teamName(g[s.team]))} 득점이 기록됐습니다.</h2><p class="note" style="font-size:14px">다른 선생님이 이미 올린 득점일 수 있습니다. 한 번 더 올릴까요?</p>
<button class="btn primary big" data-act="closeSheet">올리지 않기</button><button class="btn" data-act="dupYes">새 득점이 맞음 · 한 번 더 올리기</button></div>`;
  }
  if (s.type === 'confirm') return `<div class="sheet" role="dialog"><h2>${esc(s.title)}</h2>${s.text ? `<p class="note" style="font-size:14px">${esc(s.text)}</p>` : ''}<button class="btn primary big" data-act="confirmYes">${esc(s.yes)}</button>${close}</div>`;
  if (s.type === 'qr') return `<div class="sheet" role="dialog" aria-label="학생용 QR"><h2>학생용 화면 QR</h2><div class="qr" style="width:min(100%,360px);aspect-ratio:1;align-self:center;border:1px solid var(--line)">${qrSvg(`${BASE}?v=${S.tid}`)}</div><button class="btn" data-act="copy" data-text="${BASE}?v=${S.tid}" data-msg="학생용 주소를 복사했습니다.">학생용 주소 복사</button>${close.replace('취소', '닫기')}</div>`;
  if (s.type === 'grade') return `<div class="sheet" role="dialog"><h2>학년 추가</h2><div class="field"><label class="label" for="ng-label">학년 이름</label><input id="ng-label" class="input" placeholder="예: 6학년" maxlength="12" data-enter="saveGrade"></div>
<div class="field"><label class="label" for="ng-sport">종목</label><select id="ng-sport" class="input">${Object.entries(L.SPORTS).map(([k, sp]) => `<option value="${k}">${sp.name}</option>`).join('')}</select></div><p class="note">종목 기본 규칙이 채워지고, 설정에서 바꿀 수 있습니다.</p><button class="btn primary big" data-act="saveGrade">추가</button>${close}</div>`;
  if (s.type === 'team') return `<div class="sheet" role="dialog"><h2>팀 추가</h2><div class="field"><label class="label" for="nt-name">팀 이름</label><input id="nt-name" class="input" placeholder="예: 6-1 번개" maxlength="20" data-enter="saveTeam"></div><button class="btn primary big" data-act="saveTeam">추가</button>${close}</div>`;
  if (s.type === 'game') {
    const opts = Object.entries(teamsOf(grade().id)).map(([id, t]) => `<option value="${id}">${esc(t.name)}</option>`);
    return `<div class="sheet" role="dialog"><h2>경기 추가</h2><div class="grid2"><div class="field"><label class="label" for="ng-a">팀 1</label><select id="ng-a" class="input">${opts.join('')}</select></div><div class="field"><label class="label" for="ng-b">팀 2</label><select id="ng-b" class="input">${opts.slice(1).concat(opts.slice(0, 1)).join('')}</select></div></div><button class="btn primary big" data-act="saveGame">추가</button>${close}</div>`;
  }
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
  if (!S.store.user) return loginScreen();
  if (!S.tid || !T().meta) return S.tid && !S.loaded ? `<div class="app"><p class="note pad mt">불러오는 중입니다.</p></div>` : listScreen();
  const r = route();
  if (r.name === 'game') return gameScreen(r.a);
  if (r.name === 'sub') return subScreen(r.a, r.b === 'b' ? 'b' : 'a');
  if (r.name === 'games') return gamesScreen();
  if (r.name === 'members') return membersScreen();
  if (r.name === 'records') return recordsScreen();
  if (r.name === 'teams' && isOwner()) return teamsScreen();
  if (r.name === 'settings' && isOwner()) return settingsScreen();
  if (r.name === 'school' && isOwner()) return schoolScreen();
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
  if (MODE === 'teacher') localStorage.setItem('whistle-tid', tid);
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
    const meta = await S.store.get(`t/${tid}/meta`);
    if (meta) list.push({ tid, name: meta.name, owner: meta.owner === uid(), at: meta.createdAt || 0 });
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
    const last = localStorage.getItem('whistle-tid');
    if (!S.tid && last && S.my.some((t) => t.tid === last)) openT(last);
  }
  render(true);
}

// ---------- 단추가 하는 일 ----------
const gradePath = () => `t/${S.tid}/grades/${grade().id}`;
const teamPath = () => `t/${S.tid}/teams/${S.teamId}`;
const actions = {
  async signIn() { try { await S.store.signIn(); } catch (e) { toast('로그인하지 못했습니다.'); } },
  async signOut() { localStorage.removeItem('whistle-tid'); await S.store.signOut(); },
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
      if (meta && meta.owner !== me.uid) {
        await S.store.set(`j/${tid}/${me.uid}`, code);
        await S.store.set(`m/${tid}/${me.uid}`, { name: me.name, role: 'ref' });
      }
      await S.store.set(`u/${me.uid}/t/${tid}`, true);
      S.code = ''; await loadMy(); location.hash = 'home'; openT(tid);
    } catch (e) { toast('참여하지 못했습니다. 코드를 다시 확인해 주세요.'); }
  },
  openT(d) { location.hash = 'home'; openT(d.tid); render(true); },
  async leaveT() { localStorage.removeItem('whistle-tid'); closeT(); S.tid = null; await loadMy(); render(true); },
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
  delGradeAsk() { const gr = grade(); openSheet({ type: 'confirm', title: `${gr.label}을(를) 지울까요?`, text: '이 학년의 팀, 경기, 기록이 모두 지워집니다.', yes: '지우기', run: 'delGrade' }); },
  async delGrade() {
    const gid = grade().id, up = { [`grades/${gid}`]: null };
    for (const id of Object.keys(teamsOf(gid))) up[`teams/${id}`] = null;
    for (const g of gamesOf(gid)) { up[`games/${g.id}`] = null; up[`logs/${g.id}`] = null; }
    await S.store.update(`t/${S.tid}`, up); S.gid = null;
  },
  async setGrade(d) { const v = d.key === 'reentry' ? d.val === '1' : d.val; await S.store.update(gradePath(), { [d.key]: v }); },
  async step(d) {
    const cur = Number(grade()[d.key]) || 0;
    const next = Math.min(Number(d.max), Math.max(Number(d.min), cur + Number(d.d)));
    if (next !== cur) await S.store.update(gradePath(), { [d.key]: next });
  },
  showQR() { openSheet({ type: 'qr' }); },
  async copy(d) { try { await navigator.clipboard.writeText(d.text); toast(d.msg); } catch { toast(d.text); } },
  addGame() { if (Object.keys(teamsOf(grade().id)).length < 2) return toast('팀이 두 팀 이상 있어야 합니다.'); openSheet({ type: 'game' }); },
  async saveGame() {
    const a = val('ng-a'), b = val('ng-b'); if (!a || !b || a === b) return toast('서로 다른 두 팀을 골라 주세요.');
    const gid = grade().id, no = Math.max(0, ...gamesOf(gid).map((g) => g.no)) + 1;
    await S.store.set(`t/${S.tid}/games/${S.store.id()}`, L.newGame(gid, no, a, b));
    S.sheet = null; render(true);
  },
  delGame(d) { openSheet({ type: 'confirm', title: '이 경기를 지울까요?', text: '', yes: '지우기', run: 'delGameGo', id: d.id }); },
  async delGameGo() { const id = S.sheet.id; location.hash = 'home'; await S.store.update(`t/${S.tid}`, { [`games/${id}`]: null, [`logs/${id}`]: null }); },
  gStart(d) { return act(d.id, L.start); },
  gClock(d) { return act(d.id, L.toggleClock); },
  gNext(d) { return act(d.id, L.nextPart); },
  gEndAsk(d) { openSheet({ type: 'confirm', title: '경기를 끝낼까요?', text: '끝낸 경기는 다시 진행할 수 없습니다.', yes: '경기 종료', run: 'gEnd', id: d.id }); },
  gEnd() { const g = gameOf(S.sheet.id), gr = T().grades[g.gid]; const last = g.cur >= L.partCount(gr) - 1; return act(g.id, L.isTimed(gr) && last ? L.nextPart : L.endGame); },
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
  gScore(d) { const s = S.sheet; S.sheet = null; render(true); return act(s.id, (x, gr, ctx) => L.score(x, gr, ctx, s.team, s.pts, d.pid)); },
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
  dOut(d) { return act(d.id, (x, gr, ctx) => L.dodgeOut(x, gr, ctx, d.team, Number(d.d))); },
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
    const bench = ps.filter((p) => !p.bench).length >= Number(grade().starters);
    await S.store.set(`${teamPath()}/players/${S.store.id()}`, { no, name, bench });
    render(true); const el = document.getElementById('p-name'); if (el) el.focus();
  },
  setBench(d) { return S.store.update(`${teamPath()}/players/${d.pid}`, { bench: d.bench === '1' }); },
  delPlayer(d) { return S.store.remove(`${teamPath()}/players/${d.pid}`); },
  pasteAsk() { openSheet({ type: 'paste' }); },
  async savePaste() {
    const text = val('paste'); if (!text) return toast('명단을 적어 주세요.');
    const up = {};
    if (S.sheet.to === 'school') {
      for (const p of parseLines(text, Math.max(0, ...studentsOf(S.classId).map((x) => Number(x.no) || 0)))) up[S.store.id()] = p;
      await S.store.update(`${schoolPath()}/${S.classId}/students`, up);
    } else {
      const ps = playersOf(S.teamId); let starters = ps.filter((p) => !p.bench).length;
      for (const p of parseLines(text, Math.max(0, ...ps.map((x) => Number(x.no) || 0)))) up[S.store.id()] = { ...p, bench: starters++ >= Number(grade().starters) };
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
    if (!list.length) return openSheet({ type: 'confirm', title: '학교 명단이 아직 없습니다', text: '설정의 "학교 명단 등록"에서 학년·반 명단을 먼저 등록하면, 여기서 체크해서 불러올 수 있습니다.', yes: '학교 명단 등록하러 가기', run: 'goSchool' });
    return openSheet({ type: 'import', cid: list[0].id, picked: {} });
  },
  goSchool() { location.hash = 'school'; },
  importTog(d) { const p = S.sheet.picked; if (p[d.sid]) delete p[d.sid]; else p[d.sid] = true; render(true); },
  importAll() { const ps = studentsOf(S.sheet.cid); S.sheet.picked = Object.keys(S.sheet.picked).length === ps.length ? {} : Object.fromEntries(ps.map((p) => [p.sid, true])); render(true); },
  async importGo() {
    const cur = playersOf(S.teamId), have = new Set(cur.map((p) => `${p.no}/${p.name}`));
    let starters = cur.filter((p) => !p.bench).length, n = 0; const up = {};
    for (const p of studentsOf(S.sheet.cid).filter((x) => S.sheet.picked[x.sid])) {
      if (have.has(`${p.no}/${p.name}`)) continue;
      up[S.store.id()] = { no: String(p.no), name: p.name, bench: starters++ >= Number(grade().starters) }; n++;
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
  importClass(el) { S.sheet.cid = el.value; S.sheet.picked = {}; render(true); },
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
  window.addEventListener('hashchange', () => { S.sheet = null; window.scrollTo(0, 0); render(true); });
  try { S.store = await createStore(); } catch (e) { document.getElementById('app').innerHTML = '<div class="app"><p class="note pad mt">연결하지 못했습니다. 인터넷을 확인하고 다시 열어 주세요.</p></div>'; return; }
  setInterval(tick, 250);
  if (MODE === 'teacher') { S.store.onAuth(afterAuth); await afterAuth(); } else { openT(params.get('v') || params.get('b')); render(true); }
}

main();
