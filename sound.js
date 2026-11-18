// 音はプログラムで合成する（音源ファイル不要・無料）。
// Web Audio API を使い、BGMと効果音をその場で作る。
let ctx = null;
let bgmTimer = null;
let bgmMode = null;
const settings = { bgm: true, se: true, volume: 0.5 };

export function setSound(patch) {
  Object.assign(settings, patch);
  if (!settings.bgm) stopBGM();
}
export function getSound() { return settings; }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, delay, dur, type, vol, dest) {
  const a = dest || ac();
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  const v = (vol || 0.15) * settings.volume;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(a.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

export function playClick() {
  if (!settings.se) return;
  tone(620, 0, 0.08, "square", 0.06);
}
export function playJoin() {
  if (!settings.se) return;
  tone(523, 0, 0.1, "triangle", 0.12);
  tone(784, 0.08, 0.14, "triangle", 0.12);
}
export function playCorrect() {
  if (!settings.se) return;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle", 0.16));
}
export function playOshii() {
  if (!settings.se) return;
  // ×っぽくならないよう、柔らかく短く下がる音
  tone(392, 0, 0.18, "sine", 0.13);
  tone(330, 0.14, 0.26, "sine", 0.11);
}
export function playFanfare() {
  if (!settings.se) return;
  [523, 523, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.24, "square", 0.07));
  [523, 659, 784].forEach((f) => tone(f, 0.72, 0.6, "triangle", 0.1));
}

// BGM: 8分音符のステップシーケンサで短いメロディをループする
const LOOPS = {
  lobby: {
    step: 0.21, wave: "triangle", vol: 0.07,
    melody: [523, 659, 784, 659, 587, 659, 784, 880, 784, 659, 587, 523, 587, 659, 0, 0],
    bass: [262, 0, 0, 0, 196, 0, 0, 0, 220, 0, 0, 0, 196, 0, 0, 0]
  },
  question: {
    step: 0.34, wave: "sine", vol: 0.045,
    melody: [392, 0, 440, 0, 494, 0, 440, 0, 392, 0, 330, 0, 349, 0, 0, 0],
    bass: [196, 0, 0, 0, 0, 0, 0, 0, 165, 0, 0, 0, 0, 0, 0, 0]
  }
};

export function startBGM(mode) {
  if (!settings.bgm) return;
  if (bgmMode === mode && bgmTimer) return;
  stopBGM();
  bgmMode = mode;
  const loop = LOOPS[mode];
  if (!loop) return;
  ac();
  let i = 0;
  const tick = () => {
    const m = loop.melody[i % loop.melody.length];
    const b = loop.bass[i % loop.bass.length];
    if (m) tone(m, 0, loop.step * 1.8, loop.wave, loop.vol);
    if (b) tone(b, 0, loop.step * 3, "sine", loop.vol * 0.9);
    i++;
  };
  tick();
  bgmTimer = setInterval(tick, loop.step * 1000);
}
export function stopBGM() {
  if (bgmTimer) clearInterval(bgmTimer);
  bgmTimer = null;
  bgmMode = null;
}
