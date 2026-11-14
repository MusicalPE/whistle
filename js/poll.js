// 학생 화면용 읽기. 실시간 연결을 잡지 않고, 몇 초마다 "바뀐 표시(pulse)"만 읽은 뒤 바뀐 경기만 다시 가져온다.
// 실시간 DB 무료 요금제는 동시에 연결할 수 있는 수가 정해져 있어서, 학생이 많이 봐도 그 수를 쓰지 않게 하려는 것이다.
// 선생님 쪽은 무언가를 저장할 때마다 t/{대회}/pulse 아래에 표시를 남긴다(pulseKeys).

// 저장한 경로에서 어떤 표시를 남길지 정한다. 돌려주는 값: { 경기ID 또는 'all': true(바뀜) | null(경기 지워짐) }
export function pulseKeys(path, obj) {
  const out = {};
  const mark = (segs, val) => {
    const [t, , child, id] = segs;
    if (t !== 't' || !child || child === 'pulse') return;
    if (['games', 'logs', 'orders'].includes(child) && id) {
      const gone = child === 'games' && segs.length === 4 && val === null;
      if (gone) out[id] = null; else if (out[id] !== null) out[id] = true;
    } else out.all = true;
  };
  const base = String(path).split('/').filter(Boolean);
  if (obj && typeof obj === 'object' && base.length <= 3) {
    for (const [k, v] of Object.entries(obj)) mark(base.concat(String(k).split('/').filter(Boolean)), v);
  } else mark(base, obj);
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// getJson(path, query) 는 실시간 DB의 REST 주소에서 JSON을 읽어 오는 함수.
export function pollStore({ getJson, setTimer = setTimeout, isHidden = () => false, fast = 5000, slow = 15000 }) {
  const stats = { polls: 0, fulls: 0, games: 0 };
  return {
    demo: false, poll: true, stats,
    get user() { return null; },
    onAuth() {},
    now: () => Date.now(),
    on(path, cb) {
      let T = null, stamps = null, stopped = false, loaded = false;
      const emit = () => cb(T ? JSON.parse(JSON.stringify(T)) : null);
      const full = async (withLogs) => {
        stats.fulls++;
        const [meta, grades, teams, games, orders, display, pulse, logs] = await Promise.all(
          ['meta', 'grades', 'teams', 'games', 'orders', 'display', 'pulse'].map((k) => getJson(`${path}/${k}`)).concat(withLogs ? [getJson(`${path}/logs`)] : [Promise.resolve(T && T.logs)]),
        );
        T = meta ? { meta, grades: grades || {}, teams: teams || {}, games: games || {}, orders: orders || {}, display: display || null, logs: logs || {} } : null;
        if (T) for (const id of Object.keys(T.logs)) if (!T.games[id]) delete T.logs[id];
        stamps = pulse || null; loaded = true;
      };
      const oneGame = async (id) => {
        stats.games++;
        const [g, logs, ord] = await Promise.all([
          getJson(`${path}/games/${id}`), getJson(`${path}/logs/${id}`, 'orderBy="$key"&limitToLast=40'), getJson(`${path}/orders/${id}`),
        ]);
        if (!T) return;
        if (g) T.games[id] = g; else delete T.games[id];
        if (g && logs) T.logs[id] = { ...(T.logs[id] || {}), ...logs }; else if (!g) delete T.logs[id];
        if (g && ord) T.orders[id] = ord; else delete T.orders[id];
      };
      const tick = async () => {
        if (stopped) return;
        try {
          if (!loaded) { await full(true); emit(); } else if (!isHidden()) {
            stats.polls++;
            const p = await getJson(`${path}/pulse`);
            if (!p || !stamps || !same(p.all, stamps.all)) {
              // 표시가 아직 없는 대회(예전 규칙)이거나 명단·규칙이 바뀐 경우: 통째로 다시 읽는다.
              const before = JSON.stringify(T); await full(!p); if (JSON.stringify(T) !== before) emit();
            } else {
              const ids = [...new Set([...Object.keys(p), ...Object.keys(stamps)])].filter((k) => k !== 'all' && !same(p[k], stamps[k]));
              if (ids.length) { await Promise.all(ids.map(oneGame)); stamps = p; emit(); }
            }
          }
        } catch (e) { /* 다음 번에 다시 */ }
        const live = T && Object.values(T.games || {}).some((g) => g.status === 'live');
        if (!stopped) setTimer(tick, live ? fast : slow);
      };
      tick();
      return () => { stopped = true; };
    },
  };
}
