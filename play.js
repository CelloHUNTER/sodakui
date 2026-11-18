import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const SYMBOLS = ["●", "▲", "■", "◆"];
const CARDS = ["codeCard", "nickCard", "waitCard", "quizCard", "revealCard", "doneCard"];

let roomCode = null;
let nickname = null;
let room = null;
let me = null; // players/{nickname} の内容
let myChoices = {}; // q -> choice（この端末で答えた内容）

function show(id) {
  CARDS.forEach((c) => $(c).classList.toggle("hidden", c !== id));
}

async function enterRoom(code) {
  roomCode = code.toUpperCase();
  const snap = await getDoc(doc(db, "rooms", roomCode));
  if (!snap.exists()) { $("codeErr").textContent = "その へやは ありません"; return; }
  room = snap.data();
  localStorage.setItem("sodakui_room", roomCode);
  const savedNick = localStorage.getItem("sodakui_nickname");
  if (savedNick && room.roster.includes(savedNick)) {
    await joinAs(savedNick);
  } else {
    const grid = $("nickGrid");
    grid.innerHTML = "";
    room.roster.forEach((n) => {
      const b = document.createElement("button");
      b.className = "nick";
      b.textContent = n;
      b.addEventListener("click", () => joinAs(n));
      grid.appendChild(b);
    });
    show("nickCard");
  }
}

async function joinAs(nick) {
  nickname = nick;
  localStorage.setItem("sodakui_nickname", nickname);
  await setDoc(doc(db, "rooms", roomCode, "players", nickname),
    { joinedAt: Date.now() }, { merge: true });
  // リロード復帰用に、自分の過去の回答を読み直す
  const roomSnap = await getDoc(doc(db, "rooms", roomCode));
  room = roomSnap.data();
  for (let i = 0; i < room.questions.length; i++) {
    const a = await getDoc(doc(db, "rooms", roomCode, "answers", nickname + "_" + i));
    if (a.exists()) myChoices[i] = a.data().choice;
  }
  show("waitCard");
  $("waitName").textContent = nickname;
  $("waitText").textContent = "じゅんびちゅう…";
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
}

function render() {
  if (!room) return;
  if (room.status === "waiting") {
    show("waitCard");
    $("waitText").textContent = "じゅんびちゅう…";
    return;
  }
  if (room.status === "finished") {
    show("doneCard");
    if (me && me.totalEarned !== undefined) {
      $("resultText").textContent = room.questions.length + "もん中 " + (me.correctCount || 0) + "もん せいかい！";
      $("pointText").textContent = "ぜんぶで " + (me.totalEarned || 0) + " ポイント ゲット！";
    } else {
      $("resultText").textContent = "けっさんちゅう…";
    }
    return;
  }
  const idx = room.currentIndex;
  const q = room.questions[idx];
  if (room.phase === "reveal") {
    const mine = myChoices[idx];
    const correct = mine !== undefined && mine === room.answerIndex;
    $("revealMark").textContent = mine === undefined ? "―" : correct ? "◎" : "×";
    $("revealText").textContent = mine === undefined ? "こたえなかった もんだい" : correct ? "せいかい！" : "ざんねん…";
    $("revealAnswer").textContent = "せいかいは「" + q.choices[room.answerIndex] + "」";
    $("revealPoints").textContent = me && me.lastEarned !== undefined
      ? "この もんだいで " + me.lastEarned + " ポイント（ごうけい " + (me.totalEarned || 0) + "）" : "";
    show("revealCard");
    return;
  }
  // phase === "question"
  if (myChoices[idx] !== undefined) {
    show("waitCard");
    $("waitText").textContent = "こたえたよ。答え合わせを まってね";
    return;
  }
  $("qProgress").textContent = (idx + 1) + " / " + room.questions.length + " もんめ";
  $("qText").textContent = q.text;
  const box = $("qChoices");
  box.innerHTML = "";
  q.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "choice c" + i;
    b.textContent = SYMBOLS[i] + " " + c;
    b.addEventListener("click", async () => {
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
  await signInAnonymously(auth);
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("room");
  const saved = localStorage.getItem("sodakui_room");
  if (fromUrl) enterRoom(fromUrl);
  else if (saved) enterRoom(saved).catch(() => show("codeCard"));
})();
