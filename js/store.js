// 저장 부분. 파이어베이스 설정이 있으면 실시간 DB를 쓰고, 없으면 이 기기 안에만 저장하는 미리보기로 돈다.
// 두 쪽 모두 사용법이 같아서 화면 쪽 코드는 어느 쪽인지 몰라도 된다.
import { FIREBASE_CONFIG } from './config.js';
import { pollStore, pulseKeys } from './poll.js';

// apiKey 와 databaseURL 이 모두 있어야 파이어베이스로 연결한다.
// 로그인 화면에서 "미리보기로 둘러보기"를 누르면 이 기기에서만 미리보기로 연다.
// 주소에 ?demo 가 붙으면 지어낸 대회가 채워진 체험용 미리보기로 연다. 평소 쓰던 자료와 따로 둔다.
export const TRY = new URLSearchParams(location.search).has('demo');
const FORCE_KEY = 'whistle-force-demo';
export const forceDemo = (on) => { if (TRY) { location.href = location.origin + location.pathname; return; } if (on) localStorage.setItem(FORCE_KEY, '1'); else localStorage.removeItem(FORCE_KEY); location.reload(); };
export const CONFIGURED = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.databaseURL);
export const DEMO = TRY || !CONFIGURED || localStorage.getItem(FORCE_KEY) === '1';
const FIREBASE_VERSION = '10.12.2';

// 학생 화면(mode 'student')은 실시간 연결 없이 몇 초마다 읽기만 한다(poll.js).
export function createStore(mode) {
  if (TRY) return import('./demo-seed.js').then((m) => { seedTry(m); return localStore(); });
  if (DEMO) return localStore();
  if (mode === 'student') {
    const root = String(FIREBASE_CONFIG.databaseURL).replace(/\/+$/, '');
    const getJson = async (path, query) => { const r = await fetch(`${root}/${path}.json${query ? `?${query}` : ''}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`읽지 못했습니다 (${r.status})`); return r.json(); };
    return pollStore({ getJson, isHidden: () => document.hidden });
  }
  return firebaseStore();
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// 실시간 DB처럼 null·빈 객체·빈 배열은 저장하지 않는다.
function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { const a = v.map((x) => (prune(x) === undefined ? null : prune(x))); return a.length ? a : undefined; }
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const p = prune(x); if (p !== undefined) o[k] = p; }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

let seq = 0;
const randomId = () => `${Date.now().toString(36)}${(seq++).toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 8)}`;

// 체험용 자료 채우기. 처음 열거나 12시간이 지났으면 새로 채우고, 진행 중인 경기가 방금 시작한 것처럼 시간을 지금에 맞춘다.
const TRY_KEY = 'whistle-try-v1', TRY_USER = 'whistle-try-user', TRY_AT = 'whistle-try-at';
export const TID_KEY = TRY ? 'whistle-try-tid' : 'whistle-tid';
function seedTry({ SEED, SEED_TID, SEED_AT }) {
  const at = Number(localStorage.getItem(TRY_AT)) || 0;
  if (localStorage.getItem(TRY_KEY) && Date.now() - at < 12 * 3600 * 1000) return;
  const d = Date.now() - SEED_AT;
  const shift = (v) => (typeof v === 'number' && v > 1.5e12 && v < 3e12 ? v + d : Array.isArray(v) ? v.map(shift) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)])) : v);
  localStorage.setItem(TRY_KEY, JSON.stringify(shift(SEED)));
  localStorage.setItem(TRY_AT, String(Date.now()));
  localStorage.setItem(TRY_USER, '1');
  localStorage.setItem(TID_KEY, SEED_TID);
}

function localStore() {
  const KEY = TRY ? TRY_KEY : 'whistle-demo-v1', USER_KEY = TRY ? TRY_USER : 'whistle-demo-user';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let root = load();
  let user = localStorage.getItem(USER_KEY) ? { uid: 'demo', name: '나' } : null;
  const subs = new Set(), authSubs = new Set();
  const keys = (p) => String(p).split('/').filter(Boolean);
  const read = (p) => keys(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), root);
  const write = (p, v) => {
    const ks = keys(p); let o = root;
    for (const k of ks.slice(0, -1)) { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; }
    const pv = prune(clone(v));
    if (pv === undefined) delete o[ks.at(-1)]; else o[ks.at(-1)] = pv;
  };
  const fire = () => { for (const s of [...subs]) s.cb(clone(read(s.path)) ?? null); };
  const commit = () => { root = prune(root) || {}; localStorage.setItem(KEY, JSON.stringify(root)); fire(); };
  window.addEventListener('storage', (e) => { if (e.key === KEY) { root = load(); fire(); } });

  return {
    demo: true, try: TRY,
    get user() { return user; },
    onAuth(cb) { authSubs.add(cb); },
    async signIn() { localStorage.setItem(USER_KEY, '1'); user = { uid: 'demo', name: '나' }; authSubs.forEach((cb) => cb(user)); },
    async signOut() { localStorage.removeItem(USER_KEY); user = null; authSubs.forEach((cb) => cb(user)); },
    on(path, cb) { const s = { path, cb }; subs.add(s); cb(clone(read(path)) ?? null); return () => subs.delete(s); },
    async get(path) { return clone(read(path)) ?? null; },
    async set(path, v) { write(path, v); commit(); },
    async update(path, obj) { for (const [k, v] of Object.entries(obj)) write(`${path}/${k}`, v); commit(); },
    async remove(path) { write(path, null); commit(); },
    async push(path, v) { const id = randomId(); write(`${path}/${id}`, v); commit(); return id; },
    async tx(path, fn) {
      const cur = clone(read(path));
      if (cur === undefined || cur === null) return null;
      const next = fn(cur);
      if (next === undefined) return cur;
      write(path, next); commit();
      return clone(read(path)) ?? null;
    },
    now: () => Date.now(),
    id: randomId,
  };
}

async function firebaseStore() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [{ initializeApp }, A, D] = await Promise.all([
    import(`${base}firebase-app.js`), import(`${base}firebase-auth.js`), import(`${base}firebase-database.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app), db = D.getDatabase(app);
  const ref = (p) => D.ref(db, p);
  let offset = 0;
  D.onValue(ref('.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
  let user = null;
  const authSubs = new Set();
  await new Promise((resolve) => {
    A.onAuthStateChanged(auth, (u) => {
      user = u ? { uid: u.uid, name: u.displayName || '선생님' } : null;
      resolve();
      authSubs.forEach((cb) => cb(user));
    });
  });

  // 대회 자료를 고치면 학생 화면이 알아챌 수 있게 바뀐 표시를 남긴다. 실패해도 저장 자체에는 영향이 없다.
  const pulse = (path, obj) => {
    const segs = String(path).split('/'); if (segs[0] !== 't' || !segs[1]) return;
    const marks = pulseKeys(path, obj), up = {};
    for (const [k, v] of Object.entries(marks)) up[k] = v === null ? null : D.serverTimestamp();
    if (Object.keys(up).length) D.update(ref(`t/${segs[1]}/pulse`), up).catch(() => {});
  };

  return {
    demo: false,
    get user() { return user; },
    onAuth(cb) { authSubs.add(cb); },
    async signIn() { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); },
    async signOut() { await A.signOut(auth); },
    on(path, cb) { return D.onValue(ref(path), (s) => cb(s.val()), () => cb(null)); },
    async get(path) { return (await D.get(ref(path))).val(); },
    async set(path, v) { await D.set(ref(path), v); pulse(path, v); },
    async update(path, obj) { await D.update(ref(path), obj); pulse(path, obj); },
    async remove(path) { await D.remove(ref(path)); pulse(path, null); },
    async push(path, v) { const r = D.push(ref(path)); await D.set(r, v); pulse(path, v); return r.key; },
    // 여러 선생님이 같은 경기를 동시에 고쳐도 서로 덮어쓰지 않게 한다.
    async tx(path, fn) {
      let err = null;
      const res = await D.runTransaction(ref(path), (cur) => {
        if (cur === null) return cur;
        err = null;
        try { return fn(cur); } catch (e) { err = e; return undefined; }
      });
      if (err) throw err;
      if (res.committed) pulse(path, true);
      return res.snapshot.val();
    },
    now: () => Date.now() + offset,
    id: () => D.push(ref('ids')).key,
  };
}
