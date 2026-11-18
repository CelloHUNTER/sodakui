import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261118f";

// 名前付きアプリに分けることで、同じブラウザでも先生側のログインと混ざらないようにする
const app = initializeApp(firebaseConfig, "child");
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
let revealAnim = { idx: -1, done: false }; // ポイント加算モーションの管理

function show(id) {
  CARDS.forEach((c) => $(c).classList.toggle("hidden", c !== id));
  $("exitBtn").classList.toggle("hidden", id === "codeCard");
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

async function enterRoom(code) {
  roomCode = code.toUpperCase();
  const snap = await getDoc(doc(db, "rooms", roomCode));
  if (!snap.exists()) { $("codeErr").textContent = "その へやは ありません"; return; }
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
    $("revealMark").textContent = mine === undefined ? "―" : correct ? "◎" : "！";
    $("revealText").textContent = mine === undefined ? "こたえなかった もんだい" : correct ? "せいかい！" : "おしい！";
    $("revealQ").textContent = q.text;
    $("revealAnswer").textContent = "せいかいは「" + q.choices[room.answerIndex] + "」";
    if (me && me.lastEarned !== undefined) {
      const total = me.totalEarned || 0;
      const earned = me.lastEarned || 0;
      const prev = total - earned;
      if (revealAnim.idx !== idx) {
        revealAnim = { idx, done: false };
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
