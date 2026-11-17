// 휘슬과 버저 소리. 파일 없이 브라우저에서 바로 만들어 낸다.
// 브라우저는 화면을 한 번 누르기 전에는 소리를 막으므로, 첫 누름에서 unlock() 을 불러 둔다.
let ac = null;
const ctx = () => { if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (C) ac = new C(); } return ac; };
export const ready = () => !!ac && ac.state === 'running';
export function unlock() { const c = ctx(); if (c && c.state !== 'running') c.resume().catch(() => {}); }

function tone({ type, freq, dur, vol, trem, sweep }) {
  const c = ctx(); if (!c || c.state !== 'running') return;
  const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (sweep) o.frequency.linearRampToValueAtTime(freq + sweep, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + dur - 0.06); g.gain.linearRampToValueAtTime(0, t + dur);
  if (trem) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = trem; lg.gain.value = vol * 0.45; l.connect(lg); lg.connect(g.gain); l.start(t); l.stop(t + dur); }
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
// 호루라기: 높은 두 음이 떨리며 겹친다.
export function whistle() { tone({ type: 'sine', freq: 2950, dur: 0.55, vol: 0.32, trem: 38 }); tone({ type: 'sine', freq: 3120, dur: 0.55, vol: 0.2, trem: 38, sweep: -60 }); }
// 버저: 시간 위반 때 낮고 길게.
export function buzzer() { tone({ type: 'square', freq: 196, dur: 0.9, vol: 0.16 }); tone({ type: 'sawtooth', freq: 247, dur: 0.9, vol: 0.1 }); }
export const play = (k) => (k === 'buzzer' ? buzzer() : whistle());
