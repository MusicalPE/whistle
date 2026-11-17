// 전광판 추첨 연출: 공 뽑기.
// 결과(추첨 순서)는 이미 정해져 있고, 여기서는 "시작 시각에서 몇 초 지났는지"만으로 그림을 그린다.
// 그래서 전광판을 여러 대 띄우거나 중간에 새로 열어도 같은 장면이 나온다.
export const LEAD = 2.5;   // 처음에 공이 섞이기만 하는 시간(초)
export const STEP = 3.4;   // 한 팀을 뽑는 데 걸리는 시간
export const SHOW = 1.5;   // 한 팀 차례가 시작되고 공이 통에서 나오기까지
export const LAND = 2.9;   // 뽑힌 공이 이름을 보여 주고 자리로 넘어가는 때(이때 오른쪽 결과에 이름이 뜬다)
const COLORS = ['#2F6BFF', '#F97316', '#10B981', '#E11D48', '#8B5CF6', '#EAB308', '#06B6D4', '#EC4899'];
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// names: 추첨 순서대로 놓은 팀 이름. at: 시작 시각(ms). now(): 지금 시각(ms).
export function startBalls(canvas, names, at, now) {
  const ctx = canvas.getContext('2d');
  let raf = 0, stopped = false;
  const n = names.length;
  // 공마다 고정된 움직임 값(번호로만 정해져 어느 화면에서나 같다)
  const P = names.map((_, j) => ({ ax: 1.3 + ((j * 7) % 5) * 0.31, ay: 1.1 + ((j * 11) % 7) * 0.23, px: j * 2.4, py: j * 1.7 + 1, r: 0.55 + ((j * 5) % 4) * 0.09 }));
  const fit = (text, max, size) => { let s = size; ctx.font = `900 ${s}px "Noto Sans KR", sans-serif`; while (s > 8 && ctx.measureText(text).width > max) { s -= 1; ctx.font = `900 ${s}px "Noto Sans KR", sans-serif`; } };
  // 공: 윤이 나는 색 공 가운데에 흰 동그라미
  const ball = (x, y, r, color) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.36, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  };
  const round = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const A = 0.74;   // 출구 방향(오른쪽 아래)
  const frame = () => {
    if (stopped || !canvas.isConnected) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const t = (now() - at) / 1000, S = Math.min(w, h), cap = Math.max(13, S * 0.045);
    const pH = Math.max(34, S * 0.15), below = cap * 2.6 + pH + S * 0.05;          // 통 아래: 이름판과 안내 글
    const R = Math.max(40, Math.min(w * 0.3, (h - below - S * 0.04) / 2.3)), cx = w / 2, cy = S * 0.03 + R, br = Math.max(9, R * 0.17);
    const baseY = cy + R * 1.2, pW = Math.min(w * 0.9, Math.max(R * 2.7, 220)), pX = cx - pW / 2, pY = baseY + S * 0.035, lw = Math.max(3, R * 0.045);
    const k = Math.floor((t - LEAD) / STEP), into = t - LEAD - k * STEP;      // k번째 팀 차례, 그 차례가 시작되고 지난 시간
    const cur = t < LEAD ? -1 : Math.min(k, n);
    const over = cur >= n;
    const ex = cx + Math.cos(A) * R, ey = cy + Math.sin(A) * R;                 // 출구
    // 무대 불빛
    const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.min(R * 1.5, w / 2));
    glow.addColorStop(0, 'rgba(120,150,200,.20)'); glow.addColorStop(1, 'rgba(120,150,200,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    // 통 뒤쪽: 유리와 받침
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    const glass = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R);
    glass.addColorStop(0, 'rgba(255,255,255,.16)'); glass.addColorStop(1, 'rgba(255,255,255,.05)');
    ctx.fillStyle = glass; ctx.fill();
    ctx.strokeStyle = '#7C8798'; ctx.lineWidth = lw * 0.8;
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    // 통 안의 공: 아직 안 뽑힌 팀
    const speed = over ? 0.25 : 1 + (cur >= 0 && into < SHOW ? 0.9 * ease(into / SHOW) : 0);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R - lw * 0.5, 0, Math.PI * 2); ctx.clip();
    for (let j = n - 1; j >= 0; j--) {
      if (j < cur || (j === cur && into >= SHOW)) continue;
      const p = P[j], tt = t * speed * 0.9;
      let x = Math.sin(tt * p.ax + p.px) * p.r, y = Math.cos(tt * p.ay + p.py) * p.r * 0.8 + 0.18;   // 조금 아래쪽에 모여 구른다
      const d = Math.hypot(x, y), lim = 1 - br / R - 0.03; if (d > lim) { x *= lim / d; y *= lim / d; }
      let bx = cx + x * R, by = cy + y * R;
      if (j === cur) { const m = ease((into - SHOW * 0.55) / (SHOW * 0.45)); bx += (ex - Math.cos(A) * br * 1.2 - bx) * m; by += (ey - Math.sin(A) * br * 1.2 - by) * m; }   // 뽑힐 공은 출구 쪽으로 모인다
      ball(bx, by, br, COLORS[j % COLORS.length]);
    }
    ctx.restore();
    // 이름판(비어 있다가 뽑힌 팀 이름이 뜬다)
    round(pX, pY, pW, pH, pH / 2); ctx.fillStyle = '#0B1220'; ctx.fill(); ctx.lineWidth = Math.max(3, pH * 0.07); ctx.strokeStyle = '#F5B301'; ctx.stroke();
    // 뽑힌 공: 출구 통로로 굴러 나와 이름판 왼쪽에 놓이고, 이름이 뜬 뒤 흐려진다
    let out = null;
    if (cur >= 0 && !over && into >= SHOW) {
      const roll = ease((into - SHOW) / 0.4), drop = ease((into - SHOW - 0.4) / 0.45), away = ease((into - LAND) / (STEP - LAND));
      const x0 = ex - Math.cos(A) * br * 1.2, y0 = ey - Math.sin(A) * br * 1.2, x1 = ex + Math.cos(A) * R * 0.42, y1 = ey + Math.sin(A) * R * 0.42;
      const pr = pH * 0.36, x2 = pX + pH / 2, y2 = pY + pH / 2;
      const x = x0 + (x1 - x0) * roll + (x2 - x1) * drop, y = y0 + (y1 - y0) * roll + (y2 - y1) * drop - Math.sin(drop * Math.PI) * R * 0.12;
      out = { x, y, r: br + (pr - br) * drop, alpha: 1 - away, drop };
    }
    // 통 앞쪽: 테두리, 출구 통로, 받침, 빛
    ctx.strokeStyle = '#AEB7C4'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(cx, cy, R, A + 0.2, A - 0.2 + Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(A);
    ctx.beginPath(); ctx.moveTo(-lw, -br * 1.25); ctx.lineTo(R * 0.36, -br * 1.25); ctx.moveTo(-lw, br * 1.25); ctx.lineTo(R * 0.36, br * 1.25); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#8C97A8'; ctx.lineWidth = lw * 0.9;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - R * 0.78, baseY); ctx.lineTo(cx + R * 0.78, baseY); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, lw * 1.5, 0, Math.PI * 2); ctx.fillStyle = '#AEB7C4'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = lw * 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, Math.PI * 1.12, Math.PI * 1.42); ctx.stroke();
    if (out) {
      ctx.globalAlpha = out.alpha;
      ball(out.x, out.y, out.r, COLORS[cur % COLORS.length]);
      if (out.drop > 0.85) {
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        fit(names[cur], pW - pH * 1.7, pH * 0.5); ctx.fillText(names[cur], cx + pH * 0.25, pY + pH / 2 + pH * 0.03);
      }
      ctx.globalAlpha = 1;
    }
    // 글
    ctx.fillStyle = '#C3CAD6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${cap}px "Noto Sans KR", sans-serif`;
    ctx.fillText(over ? '추첨이 끝났습니다' : cur < 0 ? '공을 섞는 중' : `${cur + 1}번째 공 · 남은 공 ${n - cur - (into >= SHOW ? 1 : 0)}개`, cx, pY + pH + cap * 1.4);   // 글은 이름판 아래에 둔다
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
