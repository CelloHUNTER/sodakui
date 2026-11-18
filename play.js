import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261118j";
import * as S from "./sound.js?v=20261118j";

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
  onSnapshot(collection(db, "rooms", roomCode, "players"), (snap) => {
    allPlayers = snap.docs.map((d) => ({ nickname: d.id, ...d.data() }));
    render();
  });
}

function render() {
  if (!room) return;
  if (room.status === "waiting") {
    document.body.className = "";
    show("waitCard");
    $("waitText").textContent = "じゅんびちゅう…";
    return;
  }
  if (room.status === "finished" || room.status === "closed") {
    document.body.className = "";
    show("doneCard");
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
    return;
  }
  const idx = room.currentIndex;
  const q = room.questions[idx];
  if (room.phase === "reveal") {
    const mine = myChoices[idx];
    const correct = mine !== undefined && mine === room.answerIndex;
    document.body.className = mine === undefined ? "bgmu" : correct ? "bgok" : "bgng";
    $("revealMark").textContent = mine === undefined ? "―" : correct ? "◎" : "！";
    $("revealText").textContent = mine === undefined ? "こたえなかった もんだい" : correct ? "せいかい！" : "おしい！";
    $("revealQ").textContent = q.text;
    $("revealAnswer").textContent = "せいかいは「" + q.choices[room.answerIndex] + "」";
    $("revealCount").textContent = me && me.correctCount !== undefined ? "いま " + me.correctCount + " もん せいかい" : "";
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
  await signInAnonymously(auth);
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("room");
  const saved = localStorage.getItem("sodakui_room");
  if (fromUrl) enterRoom(fromUrl);
  else if (saved) enterRoom(saved).catch(() => show("codeCard"));
})();
