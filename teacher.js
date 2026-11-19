import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, onSnapshot, updateDoc, increment, arrayUnion, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261119k";
import { CHARA_IMGS } from "./characters-data.js?v=20261119k";
import * as S from "./sound.js?v=20261119k";

// 仮の数値（未決定）。後で設定で変えられるようにする。
const REVIEW_POINTS = 2; // ふくしゅうで正解1問あたりのポイント
const POINTS_JOIN = 2;   // 回答するごとに付く参加ポイント
const POINTS_CORRECT = 8; // 正解ボーナス（経験値も同数）

const SAMPLE_QUIZZES = [
  {
    id: "kotoba-sample",
    title: "ことばクイズ（サンプル）",
    questions: [
      { text: "あたまに かぶる ものは どれ？", choices: ["くつ", "ぼうし", "てぶくろ", "めがね"], answer: 1 },
      { text: "あめの ひに さす ものは どれ？", choices: ["マフラー", "ぼうし", "くつ", "かさ"], answer: 3 },
      { text: "「○ランプ」 ○に はいる もじは どれ？", choices: ["ト", "カ", "サ", "ハ"], answer: 0 },
      { text: "「○うし」 ○に はいる もじは どれ？", choices: ["と", "か", "ぼ", "ら"], answer: 2 },
      { text: "そらを とぶ のりものは どれ？", choices: ["ふね", "でんしゃ", "ひこうき", "じてんしゃ"], answer: 2 }
    ]
  },
  {
    id: "ohanashi-sample",
    title: "おはなしクイズ（サンプル・ももたろう）",
    questions: [
      { text: "ももたろうは どこから うまれた？", choices: ["かわ", "もも", "やま", "うみ"], answer: 1 },
      { text: "ももたろうの おともは いぬと さると あと ひとつは？", choices: ["ねこ", "うま", "ぶた", "きじ"], answer: 3 },
      { text: "ももたろうが たおしに いった あいては だれ？", choices: ["おに", "おばけ", "まじょ", "ドラゴン"], answer: 0 }
    ]
  }
];
const SYMBOLS = ["●", "▲", "■", "◆"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let uid = null;
let roomCode = null;
let roomUrlStr = "";
let room = null;
let playersCache = [];
let answersCache = [];
let revealing = false;
let prevJoined = new Set();
let prevPhase = null;
let prevStatus = null;
let prevPlayerCount = 0;
let reviewWatchCode = null;
let reviewCache = {};
const scoringReview = new Set();

const quizSelect = $("quizSelect");
let quizCache = {}; // 自分のクイズ（id -> クイズ本体、答え含む）
// 正解は複数ありうる。旧形式（answer が1つ）も読み取れるようにする
function answersOf(q) {
  if (!q) return [0];
  if (Array.isArray(q.answers) && q.answers.length) return q.answers;
  return [typeof q.answer === "number" ? q.answer : 0];
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

function getQuizData(id) {
  return SAMPLE_QUIZZES.find((q) => q.id === id) || quizCache[id] || null;
}
async function ensureQuiz(id) {
  let quiz = getQuizData(id);
  if (!quiz && uid) {
    const d = await getDoc(doc(db, "teachers", uid, "quizzes", id));
    if (d.exists()) { quiz = { id: d.id, ...d.data() }; quizCache[d.id] = quiz; }
  }
  return quiz;
}
async function loadQuizSelect() {
  quizSelect.innerHTML = "";
  SAMPLE_QUIZZES.forEach((q) => {
    const opt = document.createElement("option");
    opt.value = q.id; opt.textContent = q.title;
    quizSelect.appendChild(opt);
  });
  quizCache = {};
  if (!uid) return;
  const snap = await getDocs(collection(db, "teachers", uid, "quizzes"));
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.archived) return;
    quizCache[d.id] = { id: d.id, ...data };
    const opt = document.createElement("option");
    opt.value = d.id; opt.textContent = data.title;
    quizSelect.appendChild(opt);
  });
}

$("loginBtn").addEventListener("click", async () => {
  $("loginErr").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (e) {
    $("loginErr").textContent = "ログインできませんでした: " + e.code;
  }
});
$("logoutBtn").addEventListener("click", () => signOut(auth));

// 音（BGM・効果音）のオンオフ。設定は端末に覚えさせる
try {
  const sv = JSON.parse(localStorage.getItem("sodakui_sound") || "{}");
  S.setSound({ bgm: sv.bgm !== false, se: sv.se !== false });
} catch (e) { /* 既定値のまま */ }
function paintSoundBtns() {
  $("bgmBtn").textContent = "BGM：" + (S.getSound().bgm ? "オン" : "オフ");
  $("seBtn").textContent = "効果音：" + (S.getSound().se ? "オン" : "オフ");
}
function saveSound() {
  localStorage.setItem("sodakui_sound", JSON.stringify(S.getSound()));
  paintSoundBtns();
}
$("bgmBtn").addEventListener("click", () => {
  const v = !S.getSound().bgm;
  S.setSound({ bgm: v });
  saveSound();
  if (v && room) S.startBGM(room.status === "waiting" ? "lobby" : "question");
});
$("seBtn").addEventListener("click", () => {
  S.setSound({ se: !S.getSound().se });
  saveSound();
});
paintSoundBtns();

onAuthStateChanged(auth, async (user) => {
  // 匿名ログイン（接続テストや子ども画面の名残）は先生として扱わない
  if (user && user.isAnonymous) user = null;
  if (user) {
    uid = user.uid;
    const ref = doc(db, "teachers", uid);
    if (!(await getDoc(ref)).exists()) {
      await setDoc(ref, { displayName: user.email, createdAt: Date.now() });
    }
    $("loginCard").classList.add("hidden");
    $("mainArea").classList.remove("hidden");
    $("whoami").textContent = user.email;
    await loadNicknames();
    await loadQuizSelect();
    await loadResumableRooms();
  } else {
    uid = null;
    $("loginCard").classList.remove("hidden");
    $("mainArea").classList.add("hidden");
  }
});

const selectedNicks = new Set();

function updateSelInfo() {
  const el = $("selInfo");
  if (selectedNicks.size === 0) { el.textContent = ""; return; }
  el.textContent = "選択中：" + [...selectedNicks].join("、") + "（" + selectedNicks.size + "人）";
}

async function loadNicknames() {
  const snap = await getDocs(collection(db, "teachers", uid, "students"));
  const items = snap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => ({ name: d.id, participating: d.data().participating !== false, isTest: d.data().isTest === true, partner: d.data().partner || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const box = $("nickList");
  box.innerHTML = "";
  selectedNicks.clear();
  updateSelInfo();
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "nickitem";
    const b = document.createElement("button");
    b.className = "nickbtn" + (it.participating ? "" : " off") + (it.isTest ? " test" : "");
    b.textContent = it.name + (it.isTest ? "（テスト）" : "");
    if (it.partner && CHARA_IMGS[it.partner]) {
      const im = document.createElement("img");
      im.className = "chip-chara";
      im.src = CHARA_IMGS[it.partner];
      im.alt = "";
      b.prepend(im);
    }
    b.addEventListener("click", () => {
      if (selectedNicks.has(it.name)) { selectedNicks.delete(it.name); b.classList.remove("selected"); }
      else { selectedNicks.add(it.name); b.classList.add("selected"); }
      updateSelInfo();
    });
    const p = document.createElement("button");
    p.className = "partbtn" + (it.participating ? " on" : "");
    p.textContent = it.participating ? "参加" : "不参加";
    p.addEventListener("click", async () => {
      await updateDoc(doc(db, "teachers", uid, "students", it.name), { participating: !it.participating });
      await loadNicknames();
    });
    const t = document.createElement("button");
    t.className = "testbtn" + (it.isTest ? " on" : "");
    t.textContent = it.isTest ? "テスト用" : "通常";
    t.addEventListener("click", async () => {
      await updateDoc(doc(db, "teachers", uid, "students", it.name), { isTest: !it.isTest });
      await loadNicknames();
    });
    row.appendChild(b);
    row.appendChild(p);
    row.appendChild(t);
    box.appendChild(row);
  });
  if (items.length === 0) box.textContent = "まだ登録がありません。";
}

$("addNickBtn").addEventListener("click", async () => {
  const name = $("nickInput").value.trim();
  if (!name) return;
  try {
    const ref = doc(db, "teachers", uid, "students", name);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, { active: true, isTest: $("nickTestChk").checked });
    } else {
      await setDoc(ref, { exp: 0, points: 0, plays: 0, active: true, isTest: $("nickTestChk").checked });
    }
    $("nickInput").value = "";
    $("nickMsg").textContent = name + " を追加しました";
    await loadNicknames();
  } catch (e) {
    $("nickMsg").textContent = "追加できませんでした: " + (e.code || e.message);
  }
});

$("delNickBtn").addEventListener("click", async () => {
  if (selectedNicks.size === 0) { $("nickMsg").textContent = "削除するニックネームを選んでください"; return; }
  try {
    const testNames = [];
    const normalNames = [];
    for (const n of selectedNicks) {
      const s = await getDoc(doc(db, "teachers", uid, "students", n));
      if (s.exists() && s.data().isTest === true) testNames.push(n); else normalNames.push(n);
    }
    if (testNames.length > 0) {
      if (!confirm("テスト用の " + testNames.join("、") + " を完全に削除します（記録も消えます）。よろしいですか？")) return;
    }
    // 通常（本番用）は完全削除せず、一覧から外すだけ（育成記録は残る）
    for (const n of normalNames) {
      await updateDoc(doc(db, "teachers", uid, "students", n), { active: false });
    }
    // テスト用は記録ごと完全に削除する
    for (const n of testNames) {
      await deleteDoc(doc(db, "teachers", uid, "students", n));
      const recSnap = await getDocs(query(collection(db, "teachers", uid, "records"), where("nickname", "==", n)));
      for (const r of recSnap.docs) await deleteDoc(r.ref);
    }
    const msgs = [];
    if (normalNames.length) msgs.push(normalNames.length + "人を一覧から外しました");
    if (testNames.length) msgs.push("テスト用" + testNames.length + "人を完全に削除しました");
    $("nickMsg").textContent = msgs.join("／");
    await loadNicknames();
  } catch (e) {
    $("nickMsg").textContent = "削除できませんでした: " + (e.code || e.message);
  }
});

$("resetCharaBtn").addEventListener("click", async () => {
  if (selectedNicks.size === 0) { $("nickMsg").textContent = "キャラをリセットする子を選んでください"; return; }
  try {
    for (const n of selectedNicks) {
      await updateDoc(doc(db, "teachers", uid, "students", n), { partner: null });
    }
    $("nickMsg").textContent = selectedNicks.size + "人のキャラをリセットしました（次回また選べます）";
    await loadNicknames();
  } catch (e) {
    $("nickMsg").textContent = "リセットできませんでした: " + (e.code || e.message);
  }
});

function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

$("createRoomBtn").addEventListener("click", async () => {
  let quiz = getQuizData(quizSelect.value);
  if (!quiz && uid) {
    const d = await getDoc(doc(db, "teachers", uid, "quizzes", quizSelect.value));
    if (d.exists()) { quiz = { id: d.id, ...d.data() }; quizCache[d.id] = quiz; }
  }
  if (!quiz) { alert("クイズが選ばれていません"); return; }
  const snap = await getDocs(collection(db, "teachers", uid, "students"));
  const roster = snap.docs.filter((d) => d.data().active !== false && d.data().participating !== false).map((d) => d.id).sort();
  if (roster.length === 0) { alert("先にニックネームを登録してください"); return; }
  roomCode = makeCode();
  await setDoc(doc(db, "rooms", roomCode), {
    teacherId: uid, quizId: quiz.id, quizTitle: quiz.title,
    questions: quiz.questions.map((q) => ({ title: q.title || "", text: q.text, choices: q.choices, imageId: q.imageId || null, masks: q.masks || [], hints: q.hints || [] })),
    roster, status: "waiting", phase: "lobby", currentIndex: 0,
    answerIndex: null, answerIndexes: [], imgHint: null, scoredQ: [], scored: false, createdAt: Date.now()
  });
  $("setupCard").classList.add("hidden");
  $("roomCard").classList.remove("hidden");
  document.body.classList.add("ingame");
  $("roomCode").textContent = roomCode;
  const url = new URL("./play.html", location.href);
  url.searchParams.set("room", roomCode);
  roomUrlStr = url.toString();
  $("roomUrl").textContent = roomUrlStr;
  $("qrcode").innerHTML = "";
  new QRCode($("qrcode"), { text: roomUrlStr, width: 200, height: 200 });
  prevJoined = new Set();
  watchRoom();
  S.startBGM("lobby");
});

$("qrBtn").addEventListener("click", () => {
  if (!roomCode) return;
  $("popupCode").textContent = roomCode;
  $("popupUrl").textContent = roomUrlStr;
  $("qrcodeBig").innerHTML = "";
  new QRCode($("qrcodeBig"), { text: roomUrlStr, width: 220, height: 220 });
  $("qrPopup").classList.remove("hidden");
});
$("qrClose").addEventListener("click", () => $("qrPopup").classList.add("hidden"));

$("closeRoomBtn").addEventListener("click", async () => {
  if (!roomCode) return;
  if (!confirm("この部屋を閉じますか？（子どもは結果画面になります）")) return;
  await updateDoc(doc(db, "rooms", roomCode), { status: "closed" });
  location.reload();
});

// 終わっていない自分の部屋を探して、復帰できるようにする（更新・再ログイン対策）
async function loadResumableRooms() {
  const snap = await getDocs(query(collection(db, "rooms"), where("teacherId", "==", uid)));
  const list = $("resumeList");
  list.innerHTML = "";
  let count = 0;
  snap.forEach((d) => {
    const r = d.data();
    if (r.status !== "waiting" && r.status !== "playing") return;
    count++;
    const row = document.createElement("div");
    row.className = "nickitem";
    const label = document.createElement("span");
    label.style.flex = "1";
    label.style.fontSize = "18px";
    label.textContent = d.id + "　「" + r.quizTitle + "」" + (r.status === "waiting" ? "（ロビー）" : "（進行中）");
    const back = document.createElement("button");
    back.textContent = "戻る";
    back.addEventListener("click", () => resumeRoom(d.id));
    const close = document.createElement("button");
    close.className = "gray";
    close.textContent = "閉じる";
    close.addEventListener("click", async () => {
      await updateDoc(doc(db, "rooms", d.id), { status: "closed" });
      await loadResumableRooms();
    });
    row.appendChild(label);
    row.appendChild(back);
    row.appendChild(close);
    list.appendChild(row);
  });
  $("resumeArea").classList.toggle("hidden", count === 0);
}

function resumeRoom(code) {
  prevJoined = new Set();
  roomCode = code;
  const url = new URL("./play.html", location.href);
  url.searchParams.set("room", roomCode);
  roomUrlStr = url.toString();
  $("setupCard").classList.add("hidden");
  $("roomCard").classList.remove("hidden");
  document.body.classList.add("ingame");
  $("roomCode").textContent = roomCode;
  $("roomUrl").textContent = roomUrlStr;
  $("qrcode").innerHTML = "";
  new QRCode($("qrcode"), { text: roomUrlStr, width: 200, height: 200 });
  watchRoom();
}

function watchRoom() {
  prevPhase = null; prevStatus = null; prevPlayerCount = 0;
  onSnapshot(doc(db, "rooms", roomCode), (snap) => {
    if (!snap.exists()) return;
    room = snap.data();
    // 場面の切り替わりに合わせて音を鳴らす
    if (prevPhase !== null && prevPhase !== room.phase) {
      if (room.phase === "reveal") {
        S.stopBGM();
        setTimeout(() => {
          if (playersCache.some((p) => p.lastCorrect)) S.playCorrect(); else S.playOshii();
        }, 350);
      } else if ((room.phase === "question" || room.phase === "title") && room.status === "playing") {
        S.startBGM("question");
      }
    }
    if (room.status === "finished" && S.currentBGM() !== "results") {
      S.startBGM("results");
    }
    prevPhase = room.phase; prevStatus = room.status;
    renderDisplay();
  });
  onSnapshot(collection(db, "rooms", roomCode, "players"), (snap) => {
    playersCache = snap.docs.map((d) => ({ nickname: d.id, ...d.data() }));
    if (room && room.status === "waiting" && playersCache.length > prevPlayerCount && prevPlayerCount >= 0 && prevPhase !== null) S.playJoin();
    prevPlayerCount = playersCache.length;
    renderChips(); renderRanking();
  });
  onSnapshot(collection(db, "rooms", roomCode, "answers"), (snap) => {
    answersCache = snap.docs.map((d) => d.data());
    renderChips(); renderDisplayCounts();
    maybeAutoReveal();
  });
  if (reviewWatchCode !== roomCode) {
    reviewWatchCode = roomCode;
    const code = roomCode;
    onSnapshot(collection(db, "rooms", code, "review"), (snap) => {
      reviewCache = {};
      snap.docs.forEach((d) => { reviewCache[d.id] = d.data(); });
      snap.docs.forEach((d) => { maybeScoreReview(code, d.id, d.data()); });
    });
  }
}

function currentAnswers() {
  if (!room) return [];
  return answersCache.filter((a) => a.q === room.currentIndex);
}

function renderChips() {
  if (!room) return;
  const box = $("chips");
  box.innerHTML = "";
  const answered = new Set(currentAnswers().map((a) => a.nickname));
  const joined = new Set(playersCache.map((p) => p.nickname));
  const partnerOf = {};
  playersCache.forEach((p) => { partnerOf[p.nickname] = p.partner; });
  room.roster.forEach((n) => {
    const d = document.createElement("div");
    d.className = "chip";
    if (room.phase === "question" || room.phase === "reveal") {
      if (answered.has(n)) d.classList.add("answered");
    } else {
      if (joined.has(n)) {
        d.classList.add("joined");
        if (!prevJoined.has(n)) d.classList.add("pop");
      }
    }
    d.textContent = n;
    if (partnerOf[n] && CHARA_IMGS[partnerOf[n]]) {
      const im = document.createElement("img");
      im.className = "chip-chara";
      im.src = CHARA_IMGS[partnerOf[n]];
      im.alt = "";
      d.prepend(im);
    }
    box.appendChild(d);
  });
  if (room.status === "waiting") prevJoined = joined;
  $("chipsNote").textContent =
    room.phase === "question" ? "色が変わった子が、答えた子です" :
    room.status === "waiting" ? "色が変わった子が、入れた子です" : "";
}

const imgCacheT = {};
async function loadRoomImage(imageId) {
  if (!imageId) return null;
  if (imgCacheT[imageId]) return imgCacheT[imageId];
  try {
    const s = await getDoc(doc(db, "teachers", uid, "images", imageId));
    if (!s.exists()) return null;
    imgCacheT[imageId] = s.data().data;
    return imgCacheT[imageId];
  } catch (e) { return null; }
}

function renderDisplay() {
  if (!room) return;
  const inGame = room.status === "playing" || room.status === "finished";
  $("lobbyArea").classList.toggle("hidden", inGame);
  $("displayArea").classList.toggle("hidden", !inGame);
  if (!inGame) { $("podiumArea").classList.add("hidden"); renderChips(); return; }
  if (room.status === "finished") {
    $("displayArea").classList.add("hidden");
    $("podiumArea").classList.remove("hidden");
    renderPodium();
    return;
  }
  $("podiumArea").classList.add("hidden");
  const idx = room.currentIndex;
  const q = room.questions[idx];
  $("dProgress").textContent = (idx + 1) + " / " + room.questions.length + " もんめ　「" + room.quizTitle + "」";
  const isTitle = room.phase === "title";
  $("titleArea").classList.toggle("hidden", !isTitle);
  $("questionArea").classList.toggle("hidden", isTitle);
  if (isTitle) {
    $("dTitleText").textContent = q.title || "問題" + (idx + 1);
    renderChips();
    return;
  }
  $("dText").textContent = q.text;
  const dImg = $("dImg");
  const dWrap = $("dImgWrap");
  if (q.imageId) {
    loadRoomImage(q.imageId).then((url) => {
      if (url && room && room.currentIndex === idx) { dImg.src = url; dWrap.classList.remove("hidden"); }
    });
    dWrap.classList.add("hidden");
  } else {
    dWrap.classList.add("hidden");
    dImg.removeAttribute("src");
  }
  paintMarks($("dMarks"),
    room.phase === "question" ? (q.masks || []) : [],
    room.phase === "question" && room.imgHint && room.imgHint.q === idx ? (q.hints || []) : []);
  const box = $("dChoices");
  box.innerHTML = "";
  q.choices.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "dchoice c" + i;
    if (room.phase === "reveal") {
      if ((room.answerIndexes && room.answerIndexes.length ? room.answerIndexes : [room.answerIndex]).includes(i)) d.classList.add("correct");
      else d.classList.add("dim");
    }
    if (room.hint && room.hint.q === idx && room.hint.hidden.includes(i)) d.classList.add("hinted");
    d.innerHTML = "<span class='barbg' id='db" + i + "'></span><span>" + SYMBOLS[i] + " " + c + "</span><span class='dcount' id='dc" + i + "'></span>";
    box.appendChild(d);
  });
  $("hintBtn").classList.toggle("hidden", !(room.phase === "question" && !(room.hint && room.hint.q === idx)));
  const dAns = $("dAnswer");
  const dispIdxs = room.answerIndexes && room.answerIndexes.length ? room.answerIndexes : (room.answerIndex != null ? [room.answerIndex] : []);
  if (room.phase === "reveal" && dispIdxs.length) {
    dAns.textContent = "こたえ：" + dispIdxs.map((ai) => SYMBOLS[ai] + " " + q.choices[ai]).join("、");
    dAns.classList.remove("hidden");
  } else {
    dAns.classList.add("hidden");
  }
  $("revealBtn").classList.toggle("hidden", room.phase !== "question");
  const isLast = idx >= room.questions.length - 1;
  $("nextBtn").classList.toggle("hidden", room.phase !== "reveal");
  $("nextBtn").textContent = isLast ? "結果発表へ" : "つぎの問題へ";
  renderDisplayCounts();
  renderRanking();
  renderChips();
}

function renderDisplayCounts() {
  if (!room || room.status === "waiting") return;
  const ans = currentAnswers();
  $("dCount").textContent = room.phase === "reveal" ? "" : ans.length + " 人が答えました";
  if (room.phase === "reveal") {
    room.questions[room.currentIndex].choices.forEach((_, i) => {
      const el = $("dc" + i);
      const cnt = ans.filter((a) => a.choice === i).length;
      if (el) el.textContent = cnt + "人";
      const bar = $("db" + i);
      if (bar) bar.style.width = (ans.length ? Math.round(cnt / ans.length * 100) : 0) + "%";
    });
  }
}

const animatedQ = new Set();
let rankAnimating = false;

function prevTotal(p) { return (p.totalEarned || 0) - (p.lastEarned || 0); }

function renderRanking() {
  const area = $("rankingArea");
  if (!room || (room.phase !== "reveal" && room.status !== "finished")) {
    area.classList.add("hidden");
    return;
  }
  area.classList.remove("hidden");
  if (rankAnimating) return;
  const list = $("rankingList");
  const idx = room.currentIndex;
  // 答え合わせ直後は、前の点数から加算されるモーション＋順位の入れ替わりを見せる
  if (room.status !== "finished" && !animatedQ.has(idx) && playersCache.some((p) => p.lastEarned !== undefined)) {
    animatedQ.add(idx);
    rankAnimating = true;
    const rows = {};
    const prevSorted = [...playersCache].sort((a, b) => prevTotal(b) - prevTotal(a));
    const newSorted = [...playersCache].sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
    const prevRank = {}, newRank = {};
    prevSorted.forEach((p, i) => { prevRank[p.nickname] = i + 1; });
    newSorted.forEach((p, i) => { newRank[p.nickname] = i + 1; });
    list.innerHTML = "";
    prevSorted.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "rankrow";
      row.innerHTML = "<span><span class='rk'>" + (i + 1) + "位</span>　" + (p.partner && CHARA_IMGS[p.partner] ? "<img class='chara-icon' src='" + CHARA_IMGS[p.partner] + "'> " : "") + p.nickname +
        (p.lastCorrect ? " <span class='okbadge'>せいかい</span>" : "") + " <span class='delta'></span></span>" +
        "<span>" + ((p.lastEarned || 0) > 0 ? "<span class='plusbadge'>+" + p.lastEarned + "</span> " : "") +
        "<span class='pts'>" + prevTotal(p) + "</span>点</span>";
      list.appendChild(row);
      rows[p.nickname] = row;
    });
    const start = performance.now(), dur = 1100;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur);
      playersCache.forEach((p) => {
        const row = rows[p.nickname];
        const el = row && row.querySelector(".pts");
        if (el) el.textContent = Math.round(prevTotal(p) + ((p.totalEarned || 0) - prevTotal(p)) * k);
      });
      if (k < 1) requestAnimationFrame(tick);
      else flipReorder();
    };
    setTimeout(() => requestAnimationFrame(tick), 900);
    function flipReorder() {
      const first = {};
      Object.entries(rows).forEach(([n, row]) => { first[n] = row.getBoundingClientRect().top; });
      const sorted = [...playersCache].sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
      sorted.forEach((p) => list.appendChild(rows[p.nickname]));
      Object.entries(rows).forEach(([n, row]) => {
        const dy = first[n] - row.getBoundingClientRect().top;
        if (dy) { row.style.transition = "none"; row.style.transform = "translateY(" + dy + "px)"; }
      });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        sorted.forEach((p, i) => {
          const row = rows[p.nickname];
          row.querySelector(".rk").textContent = (i + 1) + "位";
          const diff = prevRank[p.nickname] - newRank[p.nickname];
          const dEl = row.querySelector(".delta");
          if (diff > 0) { dEl.textContent = "↑" + diff; dEl.classList.add("up"); row.classList.add("risen"); }
          else if (diff < 0) { dEl.textContent = "↓" + (-diff); dEl.classList.add("down"); }
        });
        Object.values(rows).forEach((row) => { row.style.transition = "transform .8s ease"; row.style.transform = ""; });
        setTimeout(() => { rankAnimating = false; renderRanking(); }, 900);
      }));
    }
    return;
  }
  const sorted = [...playersCache].sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
  list.innerHTML = sorted.map((p, i) =>
    "<div class='rankrow'><span>" + (i + 1) + "位　" + p.nickname + "</span><span>" +
    (p.correctCount || 0) + "問正解・" + (p.totalEarned || 0) + "点</span></div>").join("");
}

function maybeAutoReveal() {
  if (!room || room.phase !== "question" || revealing) return;
  if (playersCache.length === 0) return;
  const answered = new Set(currentAnswers().map((a) => a.nickname));
  if (playersCache.every((p) => answered.has(p.nickname))) reveal();
}

async function reveal() {
  if (!room || room.phase !== "question" || revealing) return;
  revealing = true;
  try {
    const idx = room.currentIndex;
    const quiz = getQuizData(room.quizId);
    const answerIndexes = answersOf(quiz.questions[idx]);
    const answerIndex = answerIndexes[0];
    const fresh = (await getDoc(doc(db, "rooms", roomCode))).data();
    if (!(fresh.scoredQ || []).includes(idx)) {
      const ansSnap = await getDocs(collection(db, "rooms", roomCode, "answers"));
      const byNick = {};
      ansSnap.forEach((d) => {
        const a = d.data();
        if (a.q === idx) byNick[a.nickname] = a.choice;
      });
      for (const p of playersCache) {
        const choice = byNick[p.nickname];
        const answered = choice !== undefined;
        const correct = answered && answerIndexes.includes(choice);
        const earned = (answered ? POINTS_JOIN : 0) + (correct ? POINTS_CORRECT : 0);
        await updateDoc(doc(db, "rooms", roomCode, "players", p.nickname), {
          totalEarned: increment(earned),
          correctCount: increment(correct ? 1 : 0),
          lastEarned: earned, lastCorrect: correct
        });
      }
      await updateDoc(doc(db, "rooms", roomCode), { scoredQ: arrayUnion(idx) });
    }
    await updateDoc(doc(db, "rooms", roomCode), { phase: "reveal", answerIndex, answerIndexes });
  } finally {
    revealing = false;
  }
}

$("revealBtn").addEventListener("click", reveal);

$("startBtn").addEventListener("click", async () => {
  await updateDoc(doc(db, "rooms", roomCode), { status: "playing", phase: "title", currentIndex: 0, hint: null });
  S.startBGM("question");
});

$("showBtn").addEventListener("click", async () => {
  if (!room || room.phase !== "title") return;
  await updateDoc(doc(db, "rooms", roomCode), { phase: "question" });
});

$("hintBtn").addEventListener("click", async () => {
  if (!room || room.phase !== "question") return;
  // ヒント図形が置いてある問題では図形を出す（選択肢消しより優先）
  const snapQ = room.questions[room.currentIndex];
  if (snapQ.hints && snapQ.hints.length) {
    await updateDoc(doc(db, "rooms", roomCode), { imgHint: { q: room.currentIndex } });
    return;
  }
  const quiz = getQuizData(room.quizId);
  if (!quiz) return;
  const idx = room.currentIndex;
  const ansSet = answersOf(quiz.questions[idx]);
  const wrong = room.questions[idx].choices.map((_, i) => i).filter((i) => !ansSet.includes(i));
  if (wrong.length === 0) return;
  // 間違いの選択肢から最大2つを消す
  const hidden = wrong.sort(() => Math.random() - 0.5).slice(0, 2);
  await updateDoc(doc(db, "rooms", roomCode), { hint: { q: idx, hidden } });
});

$("nextBtn").addEventListener("click", async () => {
  const idx = room.currentIndex;
  if (idx < room.questions.length - 1) {
    await updateDoc(doc(db, "rooms", roomCode), { phase: "title", currentIndex: idx + 1, answerIndex: null, answerIndexes: [], hint: null, imgHint: null });
  } else {
    await finishRoom();
  }
});

async function finishRoom() {
  const ref = doc(db, "rooms", roomCode);
  const fresh = (await getDoc(ref)).data();
  const quizK = await ensureQuiz(room.quizId);
  if (!fresh.scored) {
    const quiz = await ensureQuiz(room.quizId);
    const ansSnap = await getDocs(collection(db, "rooms", roomCode, "answers"));
    const byNickQ = {};
    ansSnap.forEach((d) => {
      const a = d.data();
      if (a.review) return;
      (byNickQ[a.nickname] = byNickQ[a.nickname] || {})[a.q] = a.choice;
    });
    for (const p of playersCache) {
      const stu = await getDoc(doc(db, "teachers", uid, "students", p.nickname));
      if (stu.exists() && stu.data().isTest === true) continue; // テスト用は記録に残さない
      await setDoc(doc(db, "teachers", uid, "students", p.nickname),
        { exp: increment(p.totalEarned || 0), points: increment(p.totalEarned || 0), plays: increment(1) }, { merge: true });
      const detail = room.questions.map((_, qi) => {
        const mine = byNickQ[p.nickname] || {};
        const choice = mine[qi] !== undefined ? mine[qi] : null;
        return { q: qi, choice, correct: !!(quiz && choice !== null && answersOf(quiz.questions[qi]).includes(choice)) };
      });
      await setDoc(doc(db, "teachers", uid, "records", roomCode + "_" + p.nickname), {
        date: new Date().toISOString(), roomCode, quizId: room.quizId, quizTitle: room.quizTitle || "", nickname: p.nickname,
        correctCount: p.correctCount || 0, totalCount: room.questions.length, earned: p.totalEarned || 0,
        mode: "live", detail
      });
    }
    await updateDoc(ref, { scored: true });
  }
  // 終了後は復習のために答えを部屋へ公開する（ゲーム中は渡さない）
  await updateDoc(ref, { status: "finished", phase: "reveal", podium: 0, cardsShown: false, keys: quizK ? quizK.questions.map((q) => answersOf(q)) : [] });
}

// ===== 結果発表（表彰台） =====
function podiumRanks() {
  return [3, 2, 1].filter((r) => r <= playersCache.length);
}
function renderPodium() {
  const sorted = [...playersCache].sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
  const ranks = podiumRanks();
  const step = room.podium || 0;
  [[1, sorted[0]], [2, sorted[1]], [3, sorted[2]]].forEach(([rank, p]) => {
    const el = $("pname" + rank);
    const shown = p && ranks.includes(rank) && ranks.indexOf(rank) < step;
    if (shown) {
      if (el.textContent !== p.nickname) {
        el.textContent = p.nickname;
        el.classList.remove("popin");
        void el.offsetWidth;
        el.classList.add("popin");
      }
    } else {
      el.textContent = "";
    }
  });
  const btn = $("podiumBtn");
  const done = step > ranks.length;
  if (step < ranks.length) {
    btn.classList.remove("hidden");
    btn.textContent = ranks[step] + "いの はっぴょう";
    $("podiumMsg").textContent = "";
  } else if (step === ranks.length) {
    btn.classList.remove("hidden");
    btn.textContent = "おつかれさま！";
    $("podiumMsg").textContent = "";
  } else {
    btn.classList.add("hidden");
    $("podiumMsg").textContent = "みんな おつかれさま！";
  }
  // 4位以下は順位を付けず、同じ大きさのタイルで結果だけ並べる（発表が終わってから）
  const others = $("othersArea");
  if (done && sorted.length > 3) {
    others.classList.remove("hidden");
    others.innerHTML = "";
    sorted.slice(3).forEach((p) => {
      const d = document.createElement("div");
      d.className = "otile";
      d.innerHTML = "<div class='oname'>" + p.nickname + "</div><div class='opts'>" + (p.totalEarned || 0) + "点</div>";
      others.appendChild(d);
    });
  } else {
    others.classList.add("hidden");
  }
  // がんばりカードは発表が終わってから、先生のボタンで子どもの画面に出す
  const cbtn = $("cardsBtn");
  if (done && !room.cardsShown) {
    cbtn.classList.remove("hidden");
    cbtn.disabled = false;
    cbtn.textContent = "がんばりカードを みせる";
  } else if (done && room.cardsShown) {
    cbtn.classList.remove("hidden");
    cbtn.disabled = true;
    cbtn.textContent = "カードを だしたよ";
  } else {
    cbtn.classList.add("hidden");
  }
}
$("cardsBtn").addEventListener("click", async () => {
  if (!room || room.status !== "finished") return;
  await updateDoc(doc(db, "rooms", roomCode), { cardsShown: true });
  S.playCorrect();
});

$("podiumBtn").addEventListener("click", async () => {
  if (!room || room.status !== "finished") return;
  if (!S.currentBGM()) S.startBGM("results");
  const ranks = podiumRanks();
  const step = room.podium || 0;
  const btn = $("podiumBtn");
  if (step < ranks.length) {
    // BGMを止めてドラムロール → ジャジャーンと同時に名前が出て、発表用BGMが流れ出す
    btn.disabled = true;
    btn.textContent = "……";
    S.stopBGM();
    S.playDrumroll(1200);
    await new Promise((r) => setTimeout(r, 1200));
    await updateDoc(doc(db, "rooms", roomCode), { podium: step + 1 });
    S.playJajan();
    setTimeout(() => S.startBGM("fanfare"), 150);
    if (ranks[step] === 1) launchConfetti();
    btn.disabled = false;
  } else if (step === ranks.length) {
    await updateDoc(doc(db, "rooms", roomCode), { podium: step + 1 });
    S.playCorrect();
    launchConfetti();
  }
});

function launchConfetti() {
  const layer = $("confetti");
  if (!layer) return;
  layer.innerHTML = "";
  const colors = ["#e63946", "#457b9d", "#2a9d8f", "#e9c46a", "#ff9f45"];
  for (let i = 0; i < 40; i++) {
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

// ===== 記録の閲覧とCSV =====
let recordsCache = [];
$("recordsBtn").addEventListener("click", async () => {
  const snap = await getDocs(collection(db, "teachers", uid, "records"));
  recordsCache = snap.docs.map((d) => d.data()).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const box = $("recordsList");
  if (recordsCache.length === 0) {
    box.innerHTML = "<p class='note'>まだ記録がありません</p>";
    $("csvBtn").classList.add("hidden");
    return;
  }
  box.innerHTML = "";
  recordsCache.forEach((r) => {
    const quiz = getQuizData(r.quizId);
    const title = r.quizTitle || (quiz ? quiz.title : r.quizId);
    const d = r.date ? new Date(r.date).toLocaleDateString("ja-JP") : "";
    const rate = r.totalCount ? Math.round((r.correctCount / r.totalCount) * 100) : 0;
    const p = document.createElement("p");
    p.textContent = d + "　" + (r.mode === "review" ? "【ふくしゅう】" : "") + r.nickname + "　「" + title + "」　" +
      r.correctCount + " / " + r.totalCount + " 問正解（" + rate + "%）" +
      (r.earned != null ? "　+" + r.earned + "点" : "");
    box.appendChild(p);
  });
  $("csvBtn").classList.remove("hidden");
});
$("csvBtn").addEventListener("click", () => {
  const maxQ = recordsCache.reduce((m, r) => Math.max(m, r.totalCount || 0), 0);
  let head = "日付,区分,ニックネーム,クイズ,正解数,問題数,正答率(%),獲得ポイント";
  for (let i = 1; i <= maxQ; i++) head += ",問題" + i;
  head += "\n";
  const lines = recordsCache.map((r) => {
    const quiz = getQuizData(r.quizId);
    const title = (r.quizTitle || (quiz ? quiz.title : r.quizId) || "").replace(/,/g, "、");
    const d = r.date ? new Date(r.date).toLocaleDateString("ja-JP") : "";
    const rate = r.totalCount ? Math.round((r.correctCount / r.totalCount) * 100) : 0;
    const cells = [d, r.mode === "review" ? "ふくしゅう" : "本番", r.nickname, title, r.correctCount, r.totalCount, rate, r.earned != null ? r.earned : ""];
    for (let i = 0; i < maxQ; i++) {
      const det = r.detail && r.detail[i];
      cells.push(!det ? "" : det.choice === null || det.choice === undefined ? "－" : det.correct ? "○" : "×");
    }
    return cells.join(",");
  });
  const blob = new Blob(["\uFEFF" + head + lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sodakui_records.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ===== ふくしゅうの採点（がんばりカードからの解き直し） =====
async function maybeScoreReview(code, id, data) {
  if (!data.done || data.scored || scoringReview.has(id)) return;
  scoringReview.add(id);
  try {
    const stu = await getDoc(doc(db, "teachers", uid, "students", data.nickname));
    const isTest = stu.exists() && stu.data().isTest === true;
    const earned = (data.correctCount || 0) * REVIEW_POINTS;
    if (!isTest) {
      if (earned > 0) {
        await setDoc(doc(db, "teachers", uid, "students", data.nickname),
          { exp: increment(earned), points: increment(earned) }, { merge: true });
      }
      const quiz = await ensureQuiz(data.quizId);
      const detail = (data.answers || []).map((choice, qi) => ({
        q: qi, choice, correct: !!(quiz && answersOf(quiz.questions[qi]).includes(choice))
      }));
      await setDoc(doc(db, "teachers", uid, "records", code + "_review_" + data.nickname + "_" + data.quizId), {
        date: new Date().toISOString(), roomCode: code, quizId: data.quizId, quizTitle: data.title || "",
        nickname: data.nickname, correctCount: data.correctCount || 0,
        totalCount: (data.answers || []).length, earned, mode: "review", detail
      });
    }
    await updateDoc(doc(db, "rooms", code, "review", id), { scored: true });
  } catch (e) {
    console.error("ふくしゅう採点に失敗", e);
  } finally {
    scoringReview.delete(id);
  }
}
