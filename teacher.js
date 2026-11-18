import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, onSnapshot, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// 仮の数値（未決定）。後で設定で変えられるようにする。
const POINTS_JOIN_PER_QUESTION = 2; // 回答するごとに付く参加ポイント
const POINTS_CORRECT = 8;           // 正解ボーナス（経験値も同数）

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
let uid = null;
let roomCode = null;
let unsubRoom = null, unsubPlayers = null, unsubAnswers = null;
let answersCache = [];

const quizSelect = $("quizSelect");
SAMPLE_QUIZZES.forEach((q, i) => {
  const opt = document.createElement("option");
  opt.value = i; opt.textContent = q.title;
  quizSelect.appendChild(opt);
});

$("loginBtn").addEventListener("click", async () => {
  $("loginErr").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (e) {
    $("loginErr").textContent = "ログインできませんでした: " + e.code;
  }
});
$("logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    uid = user.uid;
    // 先生の許可リストに自分のドキュメントを用意する（開発段階の便宜。本番ルールでは管理者のみ作成可にする）
    const ref = doc(db, "teachers", uid);
    if (!(await getDoc(ref)).exists()) {
      await setDoc(ref, { displayName: user.email, createdAt: Date.now() });
    }
    $("loginCard").classList.add("hidden");
    $("mainArea").classList.remove("hidden");
    $("whoami").textContent = user.email;
    await loadNicknames();
  } else {
    uid = null;
    $("loginCard").classList.remove("hidden");
    $("mainArea").classList.add("hidden");
  }
});

async function loadNicknames() {
  const snap = await getDocs(collection(db, "teachers", uid, "students"));
  const names = snap.docs.map((d) => d.id).sort();
  $("nicknames").value = names.join("\n");
}

$("saveNickBtn").addEventListener("click", async () => {
  const names = $("nicknames").value.split("\n").map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    await setDoc(doc(db, "teachers", uid, "students", n), { exp: 0, points: 0, plays: 0 }, { merge: true });
  }
  $("nickMsg").textContent = names.length + "人を保存しました";
});

function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

$("createRoomBtn").addEventListener("click", async () => {
  const quiz = SAMPLE_QUIZZES[Number(quizSelect.value)];
  const snap = await getDocs(collection(db, "teachers", uid, "students"));
  const roster = snap.docs.map((d) => d.id).sort();
  if (roster.length === 0) { alert("先にニックネームを登録してください"); return; }
  roomCode = makeCode();
  const publicQuestions = quiz.questions.map((q) => ({ text: q.text, choices: q.choices }));
  await setDoc(doc(db, "rooms", roomCode), {
    teacherId: uid, quizId: quiz.id, quizTitle: quiz.title,
    questions: publicQuestions, roster,
    status: "waiting", currentIndex: 0, scored: false, createdAt: Date.now()
  });
  $("roomInfo").classList.remove("hidden");
  $("roomCode").textContent = roomCode;
  const url = new URL("./play.html", location.href);
  url.searchParams.set("room", roomCode);
  $("roomUrl").textContent = url.toString();
  $("qrcode").innerHTML = "";
  new QRCode($("qrcode"), { text: url.toString(), width: 200, height: 200 });
  $("roomStatus").textContent = "子どもが入るのを待っています";
  watchRoom();
});

function watchRoom() {
  if (unsubRoom) unsubRoom();
  if (unsubPlayers) unsubPlayers();
  if (unsubAnswers) unsubAnswers();
  unsubRoom = onSnapshot(doc(db, "rooms", roomCode), (snap) => {
    if (!snap.exists()) return;
    const r = snap.data();
    const label = r.status === "waiting" ? "待機中" : r.status === "playing" ? (r.currentIndex + 1) + "問目 / " + r.questions.length + "問中" : "終了";
    $("roomStatus").textContent = "状態: " + label;
    $("nextBtn").disabled = !(r.status === "playing" && r.currentIndex < r.questions.length - 1);
  });
  unsubPlayers = onSnapshot(collection(db, "rooms", roomCode, "players"), (snap) => {
    playersCache = snap.docs.map((d) => ({ nickname: d.id, ...d.data() }));
    renderPlayers();
  });
  unsubAnswers = onSnapshot(collection(db, "rooms", roomCode, "answers"), (snap) => {
    answersCache = snap.docs.map((d) => d.data());
    renderPlayers();
  });
}

let playersCache = [];
function renderPlayers() {
  if (!roomCode) return;
  const el = $("playersTable");
  if (playersCache.length === 0) { el.textContent = "まだ誰も入っていません。"; return; }
  let html = "<table><tr><th>ニックネーム</th><th>回答数</th><th>正解</th><th>獲得ポイント</th></tr>";
  for (const p of playersCache) {
    const mine = answersCache.filter((a) => a.nickname === p.nickname);
    html += "<tr><td>" + p.nickname + "</td><td>" + mine.length + "</td><td>" +
      (p.correct === undefined || p.correct === null ? "-" : p.correct) + "</td><td>" +
      (p.earned === undefined || p.earned === null ? "-" : p.earned) + "</td></tr>";
  }
  el.innerHTML = html + "</table>";
}

$("startBtn").addEventListener("click", async () => {
  await updateDoc(doc(db, "rooms", roomCode), { status: "playing", currentIndex: 0 });
});
$("nextBtn").addEventListener("click", async () => {
  const ref = doc(db, "rooms", roomCode);
  const snap = await getDoc(ref);
  await updateDoc(ref, { currentIndex: snap.data().currentIndex + 1 });
});
$("finishBtn").addEventListener("click", async () => {
  const ref = doc(db, "rooms", roomCode);
  const room = (await getDoc(ref)).data();
  if (room.scored) { alert("すでに結果を出しています"); return; }
  const quiz = SAMPLE_QUIZZES.find((q) => q.id === room.quizId);
  const answersSnap = await getDocs(collection(db, "rooms", roomCode, "answers"));
  const playersSnap = await getDocs(collection(db, "rooms", roomCode, "players"));
  const byNick = {};
  answersSnap.forEach((d) => {
    const a = d.data();
    byNick[a.nickname] = byNick[a.nickname] || { answered: 0, correct: 0 };
    byNick[a.nickname].answered++;
    if (quiz.questions[a.q] && quiz.questions[a.q].answer === a.choice) byNick[a.nickname].correct++;
  });
  for (const p of playersSnap.docs) {
    const nick = p.id;
    const s = byNick[nick] || { answered: 0, correct: 0 };
    const earned = s.answered * POINTS_JOIN_PER_QUESTION + s.correct * POINTS_CORRECT;
    await updateDoc(doc(db, "rooms", roomCode, "players", nick), { correct: s.correct, answered: s.answered, earned });
    await setDoc(doc(db, "teachers", uid, "students", nick), { exp: increment(earned), points: increment(earned), plays: increment(1) }, { merge: true });
    await setDoc(doc(db, "teachers", uid, "records", roomCode + "_" + nick), {
      date: new Date().toISOString(), roomCode, quizId: room.quizId, nickname: nick,
      correctCount: s.correct, totalCount: room.questions.length
    });
  }
  await updateDoc(ref, { status: "finished", scored: true });
  $("roomStatus").textContent = "結果を出しました";
});
