import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, onSnapshot, updateDoc, increment, arrayUnion, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261118d";

// 仮の数値（未決定）。後で設定で変えられるようにする。
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
let room = null;
let playersCache = [];
let answersCache = [];
let revealing = false;

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
    .map((d) => ({ name: d.id, participating: d.data().participating !== false, isTest: d.data().isTest === true }))
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

function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

$("createRoomBtn").addEventListener("click", async () => {
  const quiz = SAMPLE_QUIZZES[Number(quizSelect.value)];
  const snap = await getDocs(collection(db, "teachers", uid, "students"));
  const roster = snap.docs.filter((d) => d.data().active !== false && d.data().participating !== false).map((d) => d.id).sort();
  if (roster.length === 0) { alert("先にニックネームを登録してください"); return; }
  roomCode = makeCode();
  await setDoc(doc(db, "rooms", roomCode), {
    teacherId: uid, quizId: quiz.id, quizTitle: quiz.title,
    questions: quiz.questions.map((q) => ({ text: q.text, choices: q.choices })),
    roster, status: "waiting", phase: "lobby", currentIndex: 0,
    answerIndex: null, scoredQ: [], scored: false, createdAt: Date.now()
  });
  $("setupCard").classList.add("hidden");
  $("roomCard").classList.remove("hidden");
  $("roomCode").textContent = roomCode;
  const url = new URL("./play.html", location.href);
  url.searchParams.set("room", roomCode);
  $("roomUrl").textContent = url.toString();
  $("qrcode").innerHTML = "";
  new QRCode($("qrcode"), { text: url.toString(), width: 200, height: 200 });
  watchRoom();
});

function watchRoom() {
  onSnapshot(doc(db, "rooms", roomCode), (snap) => {
    if (!snap.exists()) return;
    room = snap.data();
    renderDisplay();
  });
  onSnapshot(collection(db, "rooms", roomCode, "players"), (snap) => {
    playersCache = snap.docs.map((d) => ({ nickname: d.id, ...d.data() }));
    renderChips(); renderRanking();
  });
  onSnapshot(collection(db, "rooms", roomCode, "answers"), (snap) => {
    answersCache = snap.docs.map((d) => d.data());
    renderChips(); renderDisplayCounts();
    maybeAutoReveal();
  });
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
  room.roster.forEach((n) => {
    const d = document.createElement("div");
    d.className = "chip";
    if (room.phase === "question" || room.phase === "reveal") {
      if (answered.has(n)) d.classList.add("answered");
      d.textContent = n;
    } else {
      if (joined.has(n)) d.classList.add("joined");
      d.textContent = n;
    }
    box.appendChild(d);
  });
  $("chipsNote").textContent =
    room.phase === "question" ? "色が変わった子が、答えた子です" :
    room.status === "waiting" ? "色が変わった子が、入れた子です" : "";
}

function renderDisplay() {
  if (!room) return;
  const inGame = room.status === "playing" || room.status === "finished";
  $("lobbyArea").classList.toggle("hidden", inGame);
  $("displayArea").classList.toggle("hidden", !inGame);
  if (!inGame) { renderChips(); return; }
  const idx = room.currentIndex;
  const q = room.questions[idx];
  $("dProgress").textContent = (idx + 1) + " / " + room.questions.length + " もんめ　「" + room.quizTitle + "」";
  $("dText").textContent = q.text;
  const box = $("dChoices");
  box.innerHTML = "";
  q.choices.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "dchoice c" + i;
    if (room.phase === "reveal") {
      if (i === room.answerIndex) d.classList.add("correct");
      else d.classList.add("dim");
    }
    d.innerHTML = "<span>" + SYMBOLS[i] + " " + c + "</span><span class='dcount' id='dc" + i + "'></span>";
    box.appendChild(d);
  });
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
      if (el) el.textContent = ans.filter((a) => a.choice === i).length + "人";
    });
  }
}

function renderRanking() {
  const area = $("rankingArea");
  if (!room || (room.phase !== "reveal" && room.status !== "finished")) {
    area.classList.add("hidden");
    return;
  }
  area.classList.remove("hidden");
  const sorted = [...playersCache].sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
  $("rankingList").innerHTML = sorted.map((p, i) =>
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
    const quiz = SAMPLE_QUIZZES.find((q) => q.id === room.quizId);
    const answerIndex = quiz.questions[idx].answer;
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
        const correct = answered && choice === answerIndex;
        const earned = (answered ? POINTS_JOIN : 0) + (correct ? POINTS_CORRECT : 0);
        await updateDoc(doc(db, "rooms", roomCode, "players", p.nickname), {
          totalEarned: increment(earned),
          correctCount: increment(correct ? 1 : 0),
          lastEarned: earned, lastCorrect: correct
        });
      }
      await updateDoc(doc(db, "rooms", roomCode), { scoredQ: arrayUnion(idx) });
    }
    await updateDoc(doc(db, "rooms", roomCode), { phase: "reveal", answerIndex });
  } finally {
    revealing = false;
  }
}

$("revealBtn").addEventListener("click", reveal);

$("startBtn").addEventListener("click", async () => {
  await updateDoc(doc(db, "rooms", roomCode), { status: "playing", phase: "question", currentIndex: 0 });
});

$("nextBtn").addEventListener("click", async () => {
  const idx = room.currentIndex;
  if (idx < room.questions.length - 1) {
    await updateDoc(doc(db, "rooms", roomCode), { phase: "question", currentIndex: idx + 1, answerIndex: null });
  } else {
    await finishRoom();
  }
});

async function finishRoom() {
  const ref = doc(db, "rooms", roomCode);
  const fresh = (await getDoc(ref)).data();
  if (!fresh.scored) {
    for (const p of playersCache) {
      const stu = await getDoc(doc(db, "teachers", uid, "students", p.nickname));
      if (stu.exists() && stu.data().isTest === true) continue; // テスト用は記録に残さない
      await setDoc(doc(db, "teachers", uid, "students", p.nickname),
        { exp: increment(p.totalEarned || 0), points: increment(p.totalEarned || 0), plays: increment(1) }, { merge: true });
      await setDoc(doc(db, "teachers", uid, "records", roomCode + "_" + p.nickname), {
        date: new Date().toISOString(), roomCode, quizId: room.quizId, nickname: p.nickname,
        correctCount: p.correctCount || 0, totalCount: room.questions.length
      });
    }
    await updateDoc(ref, { scored: true });
  }
  await updateDoc(ref, { status: "finished", phase: "reveal" });
}
