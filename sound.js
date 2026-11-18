// 音はプログラムで合成する（音源ファイル不要・無料）。
// BGMはドラム＋ベース＋和音のグルーヴをステップシーケンサで鳴らす。
let ctx = null;
let master = null;
let noiseBuf = null;
const settings = { bgm: true, se: true, volume: 0.5 };

export function setSound(patch) {
  Object.assign(settings, patch);
  if (master) master.gain.value = settings.volume;
  if (!settings.bgm) stopBGM();
}
export function getSound() { return settings; }

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function env(g, t, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

// ===== 効果音 =====
function tone(freq, delay, dur, type, vol) {
  const a = ac();
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(vol || 0.15, 0.0002), t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}
export function playClick() { if (!settings.se) return; tone(620, 0, 0.08, "square", 0.06); }
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
  tone(392, 0, 0.18, "sine", 0.13);
  tone(330, 0.14, 0.26, "sine", 0.11);
}
export function playFanfare() {
  if (!settings.se) return;
  [523, 523, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.24, "square", 0.07));
  [523, 659, 784].forEach((f) => tone(f, 0.72, 0.6, "triangle", 0.1));
}

// ===== BGMの楽器 =====
function kick(t) {
  const a = ac();
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.11);
  env(g, t, 0.95, 0.28);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + 0.3);
}
function hat(t, vol, open) {
  const a = ac();
  const src = a.createBufferSource(); src.buffer = noiseBuf;
  const f = a.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000;
  const g = a.createGain();
  env(g, t, vol, open ? 0.22 : 0.05);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.3);
}
function snare(t, vol) {
  const a = ac();
  const src = a.createBufferSource(); src.buffer = noiseBuf;
  const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.8;
  const g = a.createGain();
  env(g, t, vol, 0.16);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.2);
  const osc = a.createOscillator(), g2 = a.createGain();
  osc.type = "triangle"; osc.frequency.value = 190;
  env(g2, t, vol * 0.6, 0.09);
  osc.connect(g2); g2.connect(master);
  osc.start(t); osc.stop(t + 0.12);
}
function bass(t, freq, dur) {
  const a = ac();
  const osc = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
  osc.type = "sawtooth"; osc.frequency.value = freq;
  f.type = "lowpass"; f.frequency.value = 700;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.1, t + dur * 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(f); f.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);
}
function stab(t, freqs, vol) {
  const a = ac();
  const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600;
  const g = a.createGain();
  env(g, t, vol, 0.16);
  f.connect(g); g.connect(master);
  freqs.forEach((fr) => {
    [1, 1.005].forEach((m) => {
      const osc = a.createOscillator();
      osc.type = "sawtooth"; osc.frequency.value = fr * m;
      osc.connect(f);
      osc.start(t); osc.stop(t + 0.2);
    });
  });
}
function pluck(t, freq) {
  const a = ac();
  const g = a.createGain();
  env(g, t, 0.3, 0.24);
  g.connect(master);
  const o1 = a.createOscillator(); o1.type = "square"; o1.frequency.value = freq;
  const o2 = a.createOscillator(); o2.type = "triangle"; o2.frequency.value = freq * 2;
  const g2 = a.createGain(); g2.gain.value = 0.3;
  o1.connect(g); o2.connect(g2); g2.connect(g);
  o1.start(t); o1.stop(t + 0.3); o2.start(t); o2.stop(t + 0.3);
}
function arp(t, freq, vol) {
  const a = ac();
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = "square"; osc.frequency.value = freq;
  env(g, t, vol, 0.1);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + 0.14);
}

// ===== BGMシーケンサ（124 BPM、コード進行 Am-F-C-G のオリジナル） =====
const BPM = 124;
const STEP = 60 / BPM / 4; // 16分音符
const CHORDS = [
  [55.0, [220.0, 261.63, 329.63]],
  [43.65, [174.61, 220.0, 261.63]],
  [65.41, [196.0, 261.63, 329.63]],
  [49.0, [196.0, 246.94, 293.66]]
];
const A4 = 440.0, B4 = 493.88, C5 = 523.25, D5 = 587.33, E5 = 659.25, G4 = 392.0, G5 = 783.99, A5 = 880.0;
// リード: [16分ステップ位置, 音]（1小節16ステップ）
const LEAD = [
  [[0, A4], [2, C5], [4, E5], [8, A4], [12, G4]],
  [[0, A4], [4, C5], [8, D5], [12, C5]],
  [[0, E5], [2, G5], [4, E5], [8, C5], [12, D5]],
  [[0, E5], [6, D5], [8, B4], [12, A4]]
];
const LEAD_END = [[0, E5], [4, G5], [8, A5], [12, A5]];

let seq = null;

function scheduleStep(stepIdx, t) {
  const mode = seq.mode;
  const barTotal = Math.floor(stepIdx / 16);
  const st = stepIdx % 16;
  const [root, chord] = CHORDS[barTotal % 4];
  const intensity = mode === "question" ? 0.55 + 0.45 * ((barTotal % 8) / 7) : 1;
  if (st % 4 === 0) kick(t);
  if (st === 4 || st === 12) snare(t, 0.4 * (mode === "lobby" ? 1 : intensity));
  if (mode === "lobby") {
    if (st % 4 === 2) hat(t, 0.16, true);
    else if (st % 2 === 0) hat(t, 0.1, false);
  } else {
    hat(t, 0.07 + 0.08 * intensity, st % 4 === 2);
  }
  if (st % 2 === 0) bass(t, root * (st % 8 === 6 ? 2 : 1), STEP * 2 * 0.95);
  if (st % 4 === 2) stab(t, chord, 0.13 * (mode === "lobby" ? 1 : 0.7 + 0.3 * intensity));
  if (mode === "question") {
    const scale = chord.concat([chord[0] * 2]);
    arp(t, scale[st % 4] * 2, 0.035 + 0.04 * intensity);
  }
  if (mode === "lobby") {
    const pat = (barTotal % 8 === 7) ? LEAD_END : LEAD[barTotal % 4];
    pat.forEach(([s, f]) => { if (s === st) pluck(t, f); });
  }
}

export function startBGM(mode) {
  if (!settings.bgm) return;
  if (seq && seq.mode === mode) return;
  stopBGM();
  ac();
  seq = { mode, step: 0, nextTime: ctx.currentTime + 0.06, timer: null };
  seq.timer = setInterval(() => {
    while (seq && seq.nextTime < ctx.currentTime + 0.12) {
      scheduleStep(seq.step, seq.nextTime);
      seq.nextTime += STEP;
      seq.step++;
    }
  }, 40);
}
export function stopBGM() {
  if (seq) { clearInterval(seq.timer); seq = null; }
}
