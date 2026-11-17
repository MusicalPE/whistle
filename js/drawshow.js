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
  const ball = (x, y, r, color, text) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.22, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
    if (text) { ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; fit(text, r * 1.6, r * 0.62); ctx.fillText(text, x, y + r * 0.04); }
  };
  const frame = () => {
    if (stopped || !canvas.isConnected) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const t = (now() - at) / 1000, S = Math.min(w, h), cx = w / 2, cy = h * 0.6, R = S * 0.34, br = Math.max(10, R * 0.2);
    const k = Math.floor((t - LEAD) / STEP), into = t - LEAD - k * STEP;      // k번째 팀 차례, 그 차례가 시작되고 지난 시간
    const cur = t < LEAD ? -1 : Math.min(k, n);
    const over = cur >= n;
    // 통
    ctx.lineWidth = Math.max(3, S * 0.012); ctx.strokeStyle = '#5B6678';
    ctx.beginPath(); ctx.arc(cx, cy, R + br * 0.5, -Math.PI / 2 + 0.32, Math.PI * 1.5 - 0.32); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - br * 1.15, cy - R - br * 0.2); ctx.lineTo(cx - br * 1.15, cy - R - br * 2.2); ctx.moveTo(cx + br * 1.15, cy - R - br * 0.2); ctx.lineTo(cx + br * 1.15, cy - R - br * 2.2); ctx.stroke();
    // 통 안의 공: 아직 안 뽑힌 팀
    const speed = over ? 0.25 : 1 + (cur >= 0 && into < SHOW ? 0.9 * ease(into / SHOW) : 0);
    for (let j = n - 1; j >= 0; j--) {
      if (j < cur || (j === cur && into >= SHOW)) continue;
      const p = P[j], tt = t * speed * 0.9;
      let x = Math.sin(tt * p.ax + p.px) * p.r, y = Math.cos(tt * p.ay + p.py) * p.r;
      const d = Math.hypot(x, y); if (d > 0.86) { x *= 0.86 / d; y *= 0.86 / d; }
      let bx = cx + x * R, by = cy + y * R;
      if (j === cur) { const m = ease((into - SHOW * 0.55) / (SHOW * 0.45)); bx += (cx - bx) * m; by += (cy - R * 0.86 - by) * m; }   // 뽑힐 공은 출구 쪽으로 모인다
      ball(bx, by, br, COLORS[j % COLORS.length], '');
    }
    // 뽑힌 공: 출구로 올라와 크게 이름을 보여 주고, 오른쪽 자리로 넘어간다
    if (cur >= 0 && !over && into >= SHOW) {
      const up = ease((into - SHOW) / 0.45), away = ease((into - LAND) / (STEP - LAND));
      const big = Math.min(S * 0.2, R * 0.62);
      const x0 = cx, y0 = cy - R * 0.86, x1 = cx, y1 = Math.max(big + 6, cy - R - br * 2.4 - big * 0.2);
      const x = x0 + (x1 - x0) * up + (w + big - x1) * away, y = y0 + (y1 - y0) * up;
      const r = (br + (big - br) * up) * (1 - 0.55 * away);
      ball(x, y, r, COLORS[cur % COLORS.length], up > 0.6 ? names[cur] : '');
    }
    // 글
    ctx.fillStyle = '#C3CAD6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(13, S * 0.045)}px "Noto Sans KR", sans-serif`;
    ctx.fillText(over ? '추첨이 끝났습니다' : cur < 0 ? '공을 섞는 중' : `${cur + 1}번째 공 · 남은 공 ${n - cur - (into >= SHOW ? 1 : 0)}개`, cx, h - Math.max(14, S * 0.05));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
