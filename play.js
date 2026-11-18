import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const SYMBOLS = ["●", "▲", "■", "◆"];

let roomCode = null;
let nickname = null;
let room = null;
let answeredFor = -1; // 回答済みの問題番号

function show(id) {
  ["codeCard", "nickCard", "waitCard", "quizCard", "doneCard"].forEach((c) =>
    $(c).classList.toggle("hidden", c !== id));
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
  await setDoc(doc(db, "rooms", roomCode, "players", nickname), { joinedAt: Date.now() }, { merge: true });
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
    const p = snap.data();
    if (room && room.status === "finished" && p.earned !== undefined && p.earned !== null) {
      $("resultText").textContent = room.questions.length + "もん中 " + p.correct + "もん せいかい！";
      $("pointText").textContent = p.earned + " ポイント ゲット！";
      show("doneCard");
    }
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
    if ($("resultText").textContent === "") $("resultText").textContent = "けっさんちゅう…";
    return;
  }
  const idx = room.currentIndex;
  if (answeredFor === idx) {
    show("waitCard");
    $("waitText").textContent = "こたえたよ。つぎの もんだいを まってね";
    return;
  }
  const q = room.questions[idx];
  $("qProgress").textContent = (idx + 1) + " / " + room.questions.length + " もんめ";
  $("qText").textContent = q.text;
  const box = $("qChoices");
  box.innerHTML = "";
  q.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "choice c" + i;
    b.textContent = SYMBOLS[i] + " " + c;
    b.addEventListener("click", async () => {
      answeredFor = idx;
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
