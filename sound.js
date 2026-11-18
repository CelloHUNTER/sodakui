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

let verb = null;   // 簡易リバーブ（発表の音を大きく響かせる）
let cerBus = null; // 発表用サウンドの出力先（ドライ＋リバーブ）
function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // リバーブの残響をプログラムで作る
    const irLen = Math.floor(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(1, irLen, ctx.sampleRate);
    const id = ir.getChannelData(0);
    for (let i = 0; i < irLen; i++) id[i] = (Math.random() * 2 - 1) * Math.exp(-i / ctx.sampleRate * 5.5);
    verb = ctx.createConvolver();
    verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    verb.connect(wet); wet.connect(master);
    cerBus = ctx.createGain();
    cerBus.connect(master);
    cerBus.connect(verb);
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

function noiseHit(t, vol, freq, out) {
  const a = ac();
  const src = a.createBufferSource(); src.buffer = noiseBuf;
  const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq || 1800; f.Q.value = 0.8;
  const g = a.createGain();
  env(g, t, vol, 0.09);
  src.connect(f); f.connect(g); g.connect(out || master);
  src.start(t); src.stop(t + 0.12);
}
function tomHit(t, freq, vol) {
  const a = ac();
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq * 1.3, t);
  osc.frequency.exponentialRampToValueAtTime(freq, t + 0.09);
  env(g, t, vol, 0.3);
  osc.connect(g); g.connect(cerBus);
  osc.start(t); osc.stop(t + 0.35);
}
// スネア1打（胴鳴り＋歯切れの2層）
function snareHit2(t, vol) {
  noiseHit(t, vol, 1800, cerBus);
  noiseHit(t, vol * 0.6, 4200, cerBus);
  const a = ac();
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = "triangle"; osc.frequency.value = 185;
  env(g, t, vol * 0.5, 0.08);
  osc.connect(g); g.connect(cerBus);
  osc.start(t); osc.stop(t + 0.1);
}

// ドラムロール: 2層のスネアがだんだん速く・大きく、後半はタムも混ざる
export function playDrumroll(ms) {
  if (!settings.se) return;
  const a = ac();
  const dur = (ms || 1200) / 1000;
  const t0 = a.currentTime;
  let t = 0, gap = 0.098;
  while (t < dur - 0.06) {
    const prog = t / dur;
    snareHit2(t0 + t, 0.22 + 0.5 * prog);
    if (prog > 0.55) tomHit(t0 + t, 120 - 30 * prog, 0.18 * prog);
    t += gap;
    gap = Math.max(0.033, gap * 0.935);
  }
  // 締めの一打
  snareHit2(t0 + dur, 0.85);
  tomHit(t0 + dur, 85, 0.5);
}

// ジャジャーン: 低音まで広げた和音＋ティンパニ＋シンバル＋リバーブ
export function playJajan() {
  if (!settings.se) return;
  const a = ac();
  const t = a.currentTime;
  const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 3400;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  f.connect(g); g.connect(cerBus);
  [130.81, 196.0, 261.63, 329.63, 392.0, 523.25, 659.25].forEach((fr) => {
    [0.996, 1, 1.004].forEach((m) => {
      const osc = a.createOscillator();
      osc.type = "sawtooth"; osc.frequency.value = fr * m;
      osc.connect(f);
      osc.start(t); osc.stop(t + 1.45);
    });
    const sub = a.createOscillator();
    sub.type = "square"; sub.frequency.value = fr;
    const sg = a.createGain(); sg.gain.value = 0.3;
    sub.connect(sg); sg.connect(f);
    sub.start(t); sub.stop(t + 1.45);
  });
  // ティンパニ風のドン
  const timp = a.createOscillator(), tg = a.createGain();
  timp.type = "sine";
  timp.frequency.setValueAtTime(123, t);
  timp.frequency.exponentialRampToValueAtTime(48, t + 0.18);
  env(tg, t, 0.85, 0.7);
  timp.connect(tg); tg.connect(cerBus);
  timp.start(t); timp.stop(t + 0.75);
  // シンバルのシャーン
  const src = a.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const hf = a.createBiquadFilter(); hf.type = "highpass"; hf.frequency.value = 6500;
  const cg = a.createGain();
  cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
  src.connect(hf); hf.connect(cg); cg.connect(cerBus);
  src.start(t); src.stop(t + 1.35);
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
// 結果発表用: C-G-Am-F の明るい進行（オリジナル）
const F5 = 698.46, C6 = 1046.5;
const CHORDS_R = [
  [65.41, [261.63, 329.63, 392.0]],
  [49.0, [246.94, 293.66, 392.0]],
  [55.0, [220.0, 261.63, 329.63]],
  [43.65, [174.61, 220.0, 261.63]]
];
const LEAD_R = [
  [[0, C5], [4, E5], [8, G5], [12, E5]],
  [[0, B4], [4, D5], [8, G5], [12, D5]],
  [[0, A4], [4, C5], [8, E5], [12, A5]],
  [[0, A4], [4, F5], [8, A5], [12, G5]]
];
const LEAD_R_END = [[0, C5], [4, E5], [8, G5], [12, C6]];

let seq = null;
export function currentBGM() { return seq ? seq.mode : null; }

function scheduleStep(stepIdx, t) {
  const mode = seq.mode;
  const isR = mode === "results" || mode === "fanfare";
  const barTotal = Math.floor(stepIdx / 16);
  const st = stepIdx % 16;
  const [root, chord] = (isR ? CHORDS_R : CHORDS)[barTotal % 4];
  const intensity = mode === "question" ? 0.55 + 0.45 * ((barTotal % 8) / 7) : 1;
  if (st % 4 === 0) kick(t);
  if (st === 4 || st === 12) snare(t, 0.4 * (mode === "question" ? intensity : 1));
  if (mode === "question") {
    hat(t, 0.07 + 0.08 * intensity, st % 4 === 2);
  } else {
    if (st % 4 === 2) hat(t, 0.16, true);
    else if (st % 2 === 0) hat(t, 0.1, false);
  }
  if (st % 2 === 0) bass(t, root * (st % 8 === 6 ? 2 : 1), STEP * 2 * 0.95);
  if (st % 4 === 2) stab(t, chord, 0.13 * (mode === "question" ? 0.7 + 0.3 * intensity : 1));
  if (mode === "question") {
    const scale = chord.concat([chord[0] * 2]);
    arp(t, scale[st % 4] * 2, 0.035 + 0.04 * intensity);
  }
  if (mode === "fanfare") {
    arp(t, chord[st % 3] * 4, 0.02);
    if (st === 0) stab(t, chord, 0.15);
  } else if (isR && st % 2 === 0) {
    arp(t, chord[(st / 2) % 3] * 4, 0.016);
  }
  if (mode === "lobby" || isR) {
    const pat = (barTotal % 8 === 7) ? (isR ? LEAD_R_END : LEAD_END) : (isR ? LEAD_R : LEAD)[barTotal % 4];
    pat.forEach(([s, f]) => { if (s === st) pluck(t, f); });
  }
}

export function startBGM(mode) {
  if (!settings.bgm) return;
  ac();
  if (seq && seq.mode === mode) return;
  stopBGM();
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
