import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261119k";
// キャラ画像（約200KB）は入室を待たせないよう並行して読み込み、使う直前に待つ
let CHARA_IMGS = {};
let charaLoaded = false;
const charaReady = import("./characters-data.js?v=20261121c")
  .then((m) => { CHARA_IMGS = m.CHARA_IMGS || {}; charaLoaded = true; })
  .catch(() => { charaLoaded = true; });
import * as S from "./sound.js?v=20261119k";

// 名前付きアプリに分けることで、同じブラウザでも先生側のログインと混ざらないようにする
const app = initializeApp(firebaseConfig, "child");
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const SYMBOLS = ["●", "▲", "■", "◆"];
const CARDS = ["bootCard", "codeCard", "nickCard", "charaCard", "charaConfirmCard", "waitCard", "quizCard", "revealCard", "doneCard", "awardWaitCard", "reviewQuizCard", "reviewDoneCard"];

let roomCode = null;
let nickname = null;
let room = null;
let me = null; // players/{nickname} の内容
let allPlayers = []; // 全員の players（順位計算用）
let myChoices = {}; // q -> choice（この端末で答えた内容）
let revealAnim = { idx: -1, done: false }; // ポイント加算モーションの管理

// 子ども側は効果音だけを小さめに鳴らす
S.setSound({ bgm: false, volume: 0.35, se: localStorage.getItem("sodakui_se_child") !== "off" });
function paintSeBtn() { $("seBtnChild").textContent = "おと：" + (S.getSound().se ? "オン" : "オフ"); }
$("seBtnChild").addEventListener("click", () => {
  const v = !S.getSound().se;
  S.setSound({ se: v });
  localStorage.setItem("sodakui_se_child", v ? "on" : "off");
  paintSeBtn();
});
paintSeBtn();

function launchConfetti() {
  const layer = $("confetti");
  layer.innerHTML = "";
  const colors = ["#e63946", "#457b9d", "#2a9d8f", "#e9c46a", "#ff9f45"];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement("span");
    s.className = "confetti";
    s.style.left = Math.random() * 100 + "%";
    s.style.background = colors[i % colors.length];
    const size = 8 + Math.random() * 7;
    s.style.width = size + "px";
    s.style.height = size + "px";
    if (i % 3 === 0) s.style.borderRadius = "50%";
    s.style.animationDuration = (1.6 + Math.random()) + "s";
    s.style.animationDelay = (Math.random() * 0.3) + "s";
    layer.appendChild(s);
  }
  setTimeout(() => { layer.innerHTML = ""; }, 3200);
}

const imgCacheP = {};
async function loadPlayImage(imageId) {
  if (!imageId || !room) return null;
  if (imgCacheP[imageId]) return imgCacheP[imageId];
  try {
    const s = await getDoc(doc(db, "teachers", room.teacherId, "images", imageId));
    if (!s.exists()) return null;
    imgCacheP[imageId] = s.data().data;
    return imgCacheP[imageId];
  } catch (e) { return null; }
}
function setQImage(el, imageId, stillValid) {
  if (!imageId) { el.classList.add("hidden"); el.removeAttribute("src"); return; }
  el.classList.add("hidden");
  loadPlayImage(imageId).then((url) => {
    if (url && stillValid()) { el.src = url; el.classList.remove("hidden"); }
  });
}
function setWrapImage(wrapEl, imgEl, imageId, stillValid) {
  if (!imageId) { wrapEl.classList.add("hidden"); imgEl.removeAttribute("src"); return; }
  wrapEl.classList.add("hidden");
  loadPlayImage(imageId).then((url) => {
    if (url && stillValid()) { imgEl.src = url; wrapEl.classList.remove("hidden"); }
  });
}
function markEl(m, isHint) {
  const d = document.createElement("div");
  d.className = "mark " + (isHint ? "hintm " + m.kind : "maskm " + m.shape);
  d.style.left = m.x + "%";
  d.style.top = m.y + "%";
  d.style.width = m.w + "%";
  d.style.height = m.h + "%";
  d.style.transform = "rotate(" + (m.rot || 0) + "deg)";
  if (!isHint && m.qmark !== false) {
    const s = document.createElement("span");
    s.className = "mq";
    s.style.transform = "rotate(" + (-(m.rot || 0)) + "deg)";
    s.textContent = "？";
    d.appendChild(s);
  }
  return d;
}
function paintMarks(layer, masks, hints) {
  if (!layer) return;
  layer.innerHTML = "";
  (masks || []).forEach((m) => layer.appendChild(markEl(m, false)));
  (hints || []).forEach((m) => layer.appendChild(markEl(m, true)));
}


function show(id) {
  CARDS.forEach((c) => $(c).classList.toggle("hidden", c !== id));
  $("exitBtn").classList.toggle("hidden", id === "codeCard" || id === "bootCard");
}

$("exitBtn").addEventListener("click", async () => {
  if (!confirm("へやを でますか？")) return;
  try {
    if (roomCode && nickname) await deleteDoc(doc(db, "rooms", roomCode, "players", nickname));
  } catch (e) { /* 部屋が既に無い場合などは無視 */ }
  localStorage.removeItem("sodakui_room");
  localStorage.removeItem("sodakui_nickname");
  location.reload();
});

let entering = false;
async function enterRoom(code) {
  if (entering) return;
  entering = true;
  try {
    roomCode = code.toUpperCase();
    const snap = await getDoc(doc(db, "rooms", roomCode));
    if (!snap.exists()) {
      if (localStorage.getItem("sodakui_room") === roomCode) localStorage.removeItem("sodakui_room");
      roomCode = null;
      show("codeCard");
      $("codeErr").textContent = "その へやは ありません";
      return;
    }
    room = snap.data();
    localStorage.setItem("sodakui_room", roomCode);
    const savedNick = localStorage.getItem("sodakui_nickname");
    if (savedNick && room.roster.includes(savedNick)) {
      // 自分の名前が保存されていれば、そのまま復帰する（他の端末では選べない）
      await joinAs(savedNick);
      return;
    }
    renderNickGrid(new Set());
    show("nickCard");
    // 入室済みの名前はグレーにして選べなくする（リアルタイムで反映）
    onSnapshot(collection(db, "rooms", roomCode, "players"), (ps) => {
      if (nickname) return;
      renderNickGrid(new Set(ps.docs.map((d) => d.id)));
    });
  } catch (e) {
    show("codeCard");
    $("codeErr").textContent = "つうしんが うまくいきませんでした。もう一度ためしてね";
  } finally {
    entering = false;
  }
}

function renderNickGrid(joinedSet) {
  const grid = $("nickGrid");
  grid.innerHTML = "";
  room.roster.forEach((n) => {
    const b = document.createElement("button");
    if (joinedSet.has(n)) {
      b.className = "nick taken";
      b.textContent = n;
      b.disabled = true;
    } else {
      b.className = "nick";
      b.textContent = n;
      b.addEventListener("click", () => joinAs(n));
    }
    grid.appendChild(b);
  });
}

let myPartner = null;
let choosing = false;
let pendingChara = null;

const CHARACTERS = [
  { id: "cat", name: "ねこ" }, { id: "dog", name: "いぬ" }, { id: "bird", name: "とり" },
  { id: "train", name: "でんしゃ" }, { id: "truck", name: "トラック" }, { id: "fire", name: "しょうぼうしゃ" },
  { id: "police", name: "パトカー" }, { id: "sports", name: "スポーツカー" }, { id: "bus", name: "バス" },
  { id: "momotaro", name: "ももたろう" }, { id: "kasajizo", name: "かさじぞう" },
  { id: "tsuru", name: "つるのおんがえし" }, { id: "ushiwaka", name: "うしわかまる" },
  { id: "tyrano", name: "ティラノサウルス" }, { id: "tricera", name: "トリケラトプス" }, { id: "ptera", name: "プテラノドン" },
  { id: "robot", name: "ロボット" }, { id: "puni", name: "ぷにロボ" }, { id: "fugu", name: "ふぐ" }
];

function paintCharaImg(el) {
  if (myPartner && CHARA_IMGS[myPartner]) {
    el.src = CHARA_IMGS[myPartner];
    el.classList.remove("hidden");
    startCharaAnim(el, myPartner);
  } else {
    el.classList.add("hidden");
    stopCharaAnim(el);
    if (myPartner && !charaLoaded) charaReady.then(() => paintCharaImg(el));
  }
}

// ===== キャラの動き（まばたき・個性コマ）=====
// 通常は静止。まばたきは2.5〜5秒ごとに約0.15秒、個性コマは7〜14秒ごとに約0.4〜0.8秒だけ差し替える。
// タイミングはキャラごとにずらす。動くのは待ち画面とがんばりカードの大きなキャラだけ（paintCharaImg経由）。
let CHARA_ANIM = {};
const animReady = import("./characters-anim.js?v=20261121c")
  .then((m) => { CHARA_ANIM = m.CHARA_ANIM || {}; })
  .catch(() => {});
const animStates = new Map(); // img要素 -> { id, timers: [] }
function stopCharaAnim(el) {
  const st = animStates.get(el);
  if (st) { st.timers.forEach((t) => clearTimeout(t)); animStates.delete(el); }
}
function startCharaAnim(el, id) {
  const cur = animStates.get(el);
  if (cur && cur.id === id) return;
  stopCharaAnim(el);
  if (!id) return;
  const st = { id, timers: [] };
  animStates.set(el, st);
  const later = (fn, ms) => { st.timers.push(setTimeout(fn, ms)); };
  const alive = () => animStates.get(el) === st;
  const blinkLoop = () => {
    if (!alive()) return;
    const f = (CHARA_ANIM[id] || {}).blink;
    if (f && !el.classList.contains("hidden")) {
      el.src = f;
      later(() => { if (alive() && CHARA_IMGS[id]) el.src = CHARA_IMGS[id]; }, 150);
    }
    later(blinkLoop, 2500 + Math.random() * 2500);
  };
  const actLoop = () => {
    if (!alive()) return;
    const f = (CHARA_ANIM[id] || {}).act;
    if (f && !el.classList.contains("hidden")) {
      el.src = f;
      later(() => { if (alive() && CHARA_IMGS[id]) el.src = CHARA_IMGS[id]; }, 400 + Math.random() * 400);
    }
    later(actLoop, 7000 + Math.random() * 7000);
  };
  animReady.then(() => {
    if (!alive()) return;
    later(blinkLoop, 1000 + Math.random() * 2500);
    later(actLoop, 3500 + Math.random() * 6000);
  });
}

async function buildCharaGrid() {
  await charaReady;
  const grid = $("charaGrid");
  grid.innerHTML = "";
  CHARACTERS.forEach((c) => {
    const b = document.createElement("button");
    b.className = "chara-cell";
    const im = document.createElement("img");
    im.src = CHARA_IMGS[c.id] || "";
    im.alt = c.name;
    const sp = document.createElement("span");
    sp.textContent = c.name;
    b.appendChild(im);
    b.appendChild(sp);
    b.addEventListener("click", () => {
      pendingChara = c;
      $("charaConfirmImg").src = CHARA_IMGS[c.id] || "";
      $("charaConfirmName").textContent = c.name;
      show("charaConfirmCard");
      S.playClick();
    });
    grid.appendChild(b);
  });
}

$("charaNoBtn").addEventListener("click", () => { show("charaCard"); });
$("charaYesBtn").addEventListener("click", async () => {
  if (!pendingChara) return;
  myPartner = pendingChara.id;
  choosing = false;
  try {
    await setDoc(doc(db, "teachers", room.teacherId, "students", nickname), { partner: myPartner }, { merge: true });
    await updateDoc(doc(db, "rooms", roomCode, "players", nickname), { partner: myPartner });
  } catch (e) { /* 保存に失敗しても表示は続ける */ }
  S.playJoin();
  render();
});

async function joinAs(nick) {
  nickname = nick;
  localStorage.setItem("sodakui_nickname", nickname);
  // パートナーは先生側の生徒データに保存されている。未選択なら選択画面を出す
  let partner = null;
  try {
    const stu = await getDoc(doc(db, "teachers", room.teacherId, "students", nickname));
    if (stu.exists()) partner = stu.data().partner || null;
  } catch (e) { /* 読めなければ選択画面を出す */ }
  myPartner = partner;
  choosing = !partner;
  await setDoc(doc(db, "rooms", roomCode, "players", nickname),
    { joinedAt: Date.now(), partner: partner || null }, { merge: true });
  // リロード復帰用に、自分の過去の回答を読み直す（部屋情報は入室時に取得済みのものを使う）
  // 始まる前の部屋では回答は存在しないので省略。ある場合も全部まとめて同時に取る
  if (room.status !== "waiting") {
    const qs = room.questions || [];
    const snaps = await Promise.all(qs.map((_, i) => getDoc(doc(db, "rooms", roomCode, "answers", nickname + "_" + i))));
    snaps.forEach((a, i) => { if (a.exists()) myChoices[i] = a.data().choice; });
  }
  if (choosing) {
    await buildCharaGrid();
    show("charaCard");
  } else {
    show("waitCard");
    $("waitName").textContent = nickname;
    $("waitText").textContent = "じゅんびちゅう…";
  }
  onSnapshot(doc(db, "rooms", roomCode), (snap) => {
    if (!snap.exists()) return;
    room = snap.data();
    render();
  });
  onSnapshot(doc(db, "rooms", roomCode, "players", nickname), (snap) => {
    if (!snap.exists()) return;
    me = snap.data();
    render();
  });
  onSnapshot(collection(db, "rooms", roomCode, "players"), (snap) => {
    allPlayers = snap.docs.map((d) => ({ nickname: d.id, ...d.data() }));
    render();
  });
  onSnapshot(collection(db, "rooms", roomCode, "review"), (snap) => {
    myReview = {};
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.nickname === nickname) myReview[data.quizId] = data;
    });
  });
}

function render() {
  if (!room) return;
  if (choosing) return; // キャラ選択中は画面を切り替えない
  if (room.status === "waiting") {
    document.body.className = "";
    show("waitCard");
    $("waitText").textContent = "じゅんびちゅう…";
    $("waitName").textContent = nickname + " さん";
    paintCharaImg($("waitChara"));
    return;
  }
  if (room.status === "finished" || room.status === "closed") {
    document.body.className = "";
    // がんばりカードは、先生が結果発表の後に出すまで待つ
    if (room.status === "finished" && !room.cardsShown) {
      show("awardWaitCard");
      return;
    }
    show("doneCard");
    paintCharaImg($("certChara"));
    if (me && me.totalEarned !== undefined && allPlayers.length > 0) {
      const sorted = [...allPlayers].sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
      const rank = sorted.findIndex((p) => p.nickname === nickname) + 1;
      $("certName").textContent = nickname + " さん";
      $("certRank").textContent = rank + " い";
      $("certCorrect").textContent = room.questions.length + "もん中 " + (me.correctCount || 0) + "もん せいかい！";
      $("certExp").textContent = "けいけんち +" + (me.totalEarned || 0);
      $("certPoints").textContent = "ポイント +" + (me.totalEarned || 0);
    } else {
      $("certName").textContent = "けっさんちゅう…";
      $("certRank").textContent = "";
      $("certCorrect").textContent = "";
      $("certExp").textContent = "";
      $("certPoints").textContent = "";
    }
    paintCardReview();
    return;
  }
  const idx = room.currentIndex;
  const q = room.questions[idx];
  if (room.phase === "title") {
    document.body.className = "";
    show("waitCard");
    $("waitText").textContent = "つぎの もんだいの じゅんびちゅう…";
    return;
  }
  if (room.phase === "reveal") {
    const mine = myChoices[idx];
    const ansIdxs = room.answerIndexes && room.answerIndexes.length ? room.answerIndexes : (room.answerIndex != null ? [room.answerIndex] : []);
    const correct = mine !== undefined && ansIdxs.includes(mine);
    document.body.className = mine === undefined ? "bgmu" : correct ? "bgok" : "bgng";
    $("revealMark").textContent = mine === undefined ? "―" : correct ? "◎" : "！";
    $("revealText").textContent = mine === undefined ? "こたえなかった もんだい" : correct ? "せいかい！" : "おしい！";
    $("revealQ").textContent = q.text;
    setQImage($("revealImg"), q.imageId, () => room && room.currentIndex === idx && room.phase === "reveal");
    $("revealAnswer").textContent = "せいかいは" + ansIdxs.map((ai) => "「" + q.choices[ai] + "」").join("");
    $("revealCount").textContent = me && me.correctCount !== undefined ? "いま " + me.correctCount + " もん せいかい" : "";
    if (me && allPlayers.length > 0) {
      const sortedR = [...allPlayers].sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
      const myRank = sortedR.findIndex((p) => p.nickname === nickname) + 1;
      $("revealRank").textContent = myRank > 0 ? "いま " + myRank + " い（" + allPlayers.length + "にん中）" : "";
    } else {
      $("revealRank").textContent = "";
    }
    if (me && me.lastEarned !== undefined) {
      const total = me.totalEarned || 0;
      const earned = me.lastEarned || 0;
      const prev = total - earned;
      if (revealAnim.idx !== idx) {
        revealAnim = { idx, done: false };
        if (correct) { S.playCorrect(); launchConfetti(); }
        else if (mine !== undefined) S.playOshii();
        $("revealPoints").innerHTML =
          (earned > 0 ? "<span class='pluspop'>+" + earned + "</span> " : "") +
          "ごうけい <span id='totalPts'>" + prev + "</span> ポイント";
        const start = performance.now(), dur = 900;
        const tick = (t) => {
          const el = $("totalPts");
          if (!el) return;
          const k = Math.min(1, (t - start) / dur);
          el.textContent = Math.round(prev + earned * k);
          if (k < 1) requestAnimationFrame(tick);
          else revealAnim.done = true;
        };
        setTimeout(() => requestAnimationFrame(tick), 500);
      } else if (revealAnim.done) {
        $("revealPoints").textContent = "この もんだいで " + earned + " ポイント（ごうけい " + total + "）";
      }
    } else {
      $("revealPoints").textContent = "";
    }
    show("revealCard");
    return;
  }
  // phase === "question"
  document.body.className = "";
  if (myChoices[idx] !== undefined) {
    show("waitCard");
    $("waitText").textContent = "こたえたよ。答え合わせを まってね";
    return;
  }
  $("qProgress").textContent = (idx + 1) + " / " + room.questions.length + " もんめ";
  $("qText").textContent = q.text;
  setWrapImage($("qImgWrap"), $("qImg"), q.imageId, () => room && room.currentIndex === idx && room.phase === "question");
  paintMarks($("qMarks"), q.masks || [], room.imgHint && room.imgHint.q === idx ? (q.hints || []) : []);
  const box = $("qChoices");
  box.innerHTML = "";
  q.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "choice c" + i;
    b.textContent = SYMBOLS[i] + " " + c;
    if (room.hint && room.hint.q === idx && room.hint.hidden.includes(i)) {
      b.classList.add("hinted");
      b.disabled = true;
    }
    b.addEventListener("click", async () => {
      S.playClick();
      myChoices[idx] = i;
      await setDoc(doc(db, "rooms", roomCode, "answers", nickname + "_" + idx),
        { nickname, q: idx, choice: i, at: Date.now() });
      render();
    });
    box.appendChild(b);
  });
  show("quizCard");
}

$("codeBtn").addEventListener("click", () => {
  const v = $("roomInput").value.trim();
  if (v) enterRoom(v);
});

(async () => {
  // 起動中は「よみこみちゅう」だけを見せ、自動入室が終わるまでコード入力欄を出さない
  // （入力途中で画面が切り替わるのを防ぐ）
  try {
    await signInAnonymously(auth);
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get("room");
    const saved = localStorage.getItem("sodakui_room");
    if (fromUrl) await enterRoom(fromUrl);
    else if (saved) await enterRoom(saved);
    else show("codeCard");
  } catch (e) {
    show("codeCard");
  }
})();

// ===== ふくしゅう（がんばりカードから、間違えた問題の解き直し） =====
const REVIEW_POINTS = 2; // 正解1問あたり（先生側の採点と一致させる）
let rvState = null;      // {list, pos, answers（全問ぶん）, correct, locked}
let myReview = {};       // quizId -> 自分の復習の進み具合（scored判定用）

function missedIndices() {
  if (!room || !room.keys || !room.questions) return [];
  const out = [];
  for (let i = 0; i < room.questions.length; i++) {
    const k = room.keys[i];
    const kArr = Array.isArray(k) ? k : [k];
    if (!kArr.includes(myChoices[i])) out.push(i);
  }
  return out;
}

function paintCardReview() {
  const btn = $("cardReviewBtn");
  const note = $("cardReviewNote");
  if (!room || !room.keys) { btn.classList.add("hidden"); note.textContent = ""; return; }
  const missed = missedIndices();
  if (missed.length === 0) {
    btn.classList.add("hidden");
    note.textContent = "ぜんぶ せいかい！すごい！";
  } else {
    btn.classList.remove("hidden");
    btn.textContent = "まちがえた もんだいを ふくしゅうする（" + missed.length + "問）";
    note.textContent = "";
  }
}

$("cardReviewBtn").addEventListener("click", async () => {
  const list = missedIndices();
  if (list.length === 0 || !room) return;
  rvState = { list, pos: 0, answers: new Array(room.questions.length).fill(null), correct: 0, locked: false };
  try {
    await setDoc(doc(db, "rooms", roomCode, "review", nickname + "_" + room.quizId), {
      nickname, quizId: room.quizId, title: room.quizTitle || "", answers: rvState.answers, correctCount: 0, done: false,
      scored: (myReview[room.quizId] && myReview[room.quizId].scored) || false, startedAt: Date.now()
    });
  } catch (e) { /* 保存に失敗しても復習は続けられる */ }
  renderReviewQuestion();
});

function renderReviewQuestion() {
  if (!rvState || !room) return;
  const qi = rvState.list[rvState.pos];
  const item = room.questions[qi];
  show("reviewQuizCard");
  $("rvProgress").textContent = "ふくしゅう　" + (rvState.pos + 1) + " / " + rvState.list.length + " もんめ";
  $("rvText").textContent = (item.title ? item.title + "　" : "") + item.text;
  setWrapImage($("rvImgWrap"), $("rvImg"), item.imageId, () => !!rvState);
  paintMarks($("rvMarks"), item.masks || [], []);
  $("rvFeedback").classList.add("hidden");
  const box = $("rvChoices");
  box.innerHTML = "";
  item.choices.forEach((c, ci) => {
    const b = document.createElement("button");
    b.className = "choice c" + ci;
    b.textContent = SYMBOLS[ci] + " " + c;
    b.addEventListener("click", () => answerReview(ci));
    box.appendChild(b);
  });
}

async function answerReview(ci) {
  if (!rvState || rvState.locked || !room) return;
  rvState.locked = true;
  const qi = rvState.list[rvState.pos];
  const keyRaw = room.keys[qi];
  const keyArr = Array.isArray(keyRaw) ? keyRaw : [keyRaw];
  const correct = keyArr.includes(ci);
  rvState.answers[qi] = ci;
  if (correct) rvState.correct++;
  paintMarks($("rvMarks"), [], []);
  [...$("rvChoices").children].forEach((el, i2) => {
    el.disabled = true;
    if (keyArr.includes(i2)) el.classList.add("correct");
    else if (i2 === ci) el.classList.add("dim");
  });
  document.body.className = correct ? "bgok" : "bgng";
  $("rvFeedback").classList.remove("hidden");
  $("rvMark").textContent = correct ? "◎" : "！";
  $("rvMark").style.color = correct ? "#1d7a6f" : "#d96f1e";
  $("rvMsg").textContent = correct ? "せいかい！" : "おしい！　せいかいは" + keyArr.map((ai) => "「" + room.questions[qi].choices[ai] + "」").join("");
  $("rvMsg").style.color = correct ? "#1d7a6f" : "#d96f1e";
  $("rvNextBtn").textContent = rvState.pos >= rvState.list.length - 1 ? "けっかを みる" : "つぎへ";
  if (correct) S.playCorrect(); else S.playOshii();
  try {
    await updateDoc(doc(db, "rooms", roomCode, "review", nickname + "_" + room.quizId),
      { answers: rvState.answers, correctCount: rvState.correct });
  } catch (e) { /* 同上 */ }
}

$("rvNextBtn").addEventListener("click", async () => {
  if (!rvState || !room) return;
  document.body.className = "";
  if (rvState.pos < rvState.list.length - 1) {
    rvState.pos++;
    rvState.locked = false;
    renderReviewQuestion();
    return;
  }
  const wasScored = !!(myReview[room.quizId] && myReview[room.quizId].scored);
  const total = rvState.list.length;
  const correctCount = rvState.correct;
  try {
    await updateDoc(doc(db, "rooms", roomCode, "review", nickname + "_" + room.quizId),
      { done: true, correctCount, answers: rvState.answers });
  } catch (e) { /* 同上 */ }
  $("rvResult").textContent = total + "問中 " + correctCount + "問 なおせた！";
  $("rvPoints").textContent = wasScored ? "ポイントは 1回目だけ もらえます" : "+" + (correctCount * REVIEW_POINTS) + " ポイント（1問 " + REVIEW_POINTS + "点）";
  rvState = null;
  show("reviewDoneCard");
  S.playFanfare();
});

$("rvBackBtn").addEventListener("click", () => { render(); });
