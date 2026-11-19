import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261119h";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const SYMBOLS = ["●", "▲", "■", "◆"];

let teacherUid = null;
let currentId = null;      // 編集中のクイズID（新規は null）
let questions = [];        // 編集中の問題 [{title, text, choices[], answer}]
let previewIdx = 0;

onAuthStateChanged(auth, async (user) => {
  if (user && !user.isAnonymous) {
    teacherUid = user.uid;
    $("authMsg").textContent = user.email + " でログイン中";
    await showList();
  } else {
    teacherUid = null;
    $("authMsg").innerHTML = "先生ログインが必要です。<a href='./teacher.html'>先生画面</a>でログインしてから開いてください。";
    $("listView").classList.add("hidden");
    $("editView").classList.add("hidden");
  }
});

async function showList() {
  $("editView").classList.add("hidden");
  $("listView").classList.remove("hidden");
  const box = $("quizList");
  box.innerHTML = "<p>読み込み中…</p>";
  const snap = await getDocs(collection(db, "teachers", teacherUid, "quizzes"));
  const items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((q) => !q.archived)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  box.innerHTML = "";
  if (items.length === 0) {
    box.innerHTML = "<p class='note'>まだクイズがありません。「あたらしいクイズ」から作れます。</p>";
  }
  items.forEach((q) => {
    const card = document.createElement("div");
    card.className = "card";
    const date = q.updatedAt ? new Date(q.updatedAt).toLocaleDateString("ja-JP") : "";
    card.innerHTML = "<p class='big'>" + q.title + "</p><p class='note'>" +
      (q.questions ? q.questions.length : 0) + "問　" + date + "</p>";
    const row = document.createElement("div");
    row.className = "row";
    const edit = document.createElement("button");
    edit.textContent = "編集";
    edit.addEventListener("click", () => openEditor(q.id, q));
    const dup = document.createElement("button");
    dup.className = "sub"; dup.textContent = "複製";
    dup.addEventListener("click", async () => {
      await addDoc(collection(db, "teachers", teacherUid, "quizzes"), {
        title: q.title + " のコピー",
        questions: q.questions || [],
        archived: false,
        updatedAt: Date.now()
      });
      showList();
    });
    const del = document.createElement("button");
    del.className = "gray"; del.textContent = "削除";
    del.addEventListener("click", async () => {
      if (!confirm("「" + q.title + "」を一覧から消しますか？（記録のためにデータ自体は残ります）")) return;
      await updateDoc(doc(db, "teachers", teacherUid, "quizzes", q.id), { archived: true });
      showList();
    });
    row.append(edit, dup, del);
    card.appendChild(row);
    box.appendChild(card);
  });
}

function blankQuestion() {
  return { title: "", text: "", choices: ["", "", "", ""], answer: 0 };
}

function openEditor(id, data) {
  currentId = id;
  questions = JSON.parse(JSON.stringify(data && data.questions && data.questions.length ? data.questions : [blankQuestion()]));
  $("quizTitle").value = data ? data.title || "" : "";
  $("saveMsg").textContent = "";
  previewIdx = 0;
  $("previewBox").classList.add("hidden");
  $("listView").classList.add("hidden");
  $("editView").classList.remove("hidden");
  renderQuestions();
}

function renderQuestions() {
  const box = $("questionsBox");
  box.innerHTML = "";
  questions.forEach((q, qi) => {
    const card = document.createElement("div");
    card.className = "card qedit";
    const head = document.createElement("div");
    head.className = "row";
    head.innerHTML = "<strong>問題" + (qi + 1) + "</strong>";
    const mkBtn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "mini " + (cls || "");
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    head.append(
      mkBtn("↑", "gray", () => { if (qi > 0) { [questions[qi - 1], questions[qi]] = [questions[qi], questions[qi - 1]]; renderQuestions(); } }),
      mkBtn("↓", "gray", () => { if (qi < questions.length - 1) { [questions[qi + 1], questions[qi]] = [questions[qi], questions[qi + 1]]; renderQuestions(); } }),
      mkBtn("複製", "sub", () => { questions.splice(qi + 1, 0, JSON.parse(JSON.stringify(q))); renderQuestions(); }),
      mkBtn("削除", "gray", () => { if (questions.length > 1) { questions.splice(qi, 1); renderQuestions(); } })
    );
    card.appendChild(head);

    const tLabel = document.createElement("label");
    tLabel.textContent = "タイトル（空のままだと「問題" + (qi + 1) + "」になります）";
    const tInput = document.createElement("input");
    tInput.value = q.title || "";
    tInput.addEventListener("input", () => { q.title = tInput.value; });
    card.append(tLabel, tInput);

    const qLabel = document.createElement("label");
    qLabel.textContent = "問題文";
    const qInput = document.createElement("textarea");
    qInput.rows = 2;
    qInput.value = q.text || "";
    qInput.addEventListener("input", () => { q.text = qInput.value; });
    card.append(qLabel, qInput);

    const chBox = document.createElement("div");
    q.choices.forEach((c, ci) => {
      const row = document.createElement("div");
      row.className = "row choicerow";
      const dot = document.createElement("span");
      dot.className = "cdot c" + ci;
      dot.textContent = SYMBOLS[ci];
      const input = document.createElement("input");
      input.style.flex = "1";
      input.value = c;
      input.placeholder = "選択肢" + (ci + 1);
      input.addEventListener("input", () => { q.choices[ci] = input.value; });
      const ans = document.createElement("button");
      ans.type = "button";
      ans.className = "mini ansbtn" + (q.answer === ci ? " on" : "");
      ans.textContent = q.answer === ci ? "正解" : "正解にする";
      ans.addEventListener("click", () => { q.answer = ci; renderQuestions(); });
      row.append(dot, input, ans);
      if (q.choices.length > 2) {
        const delc = document.createElement("button");
        delc.type = "button"; delc.className = "mini gray"; delc.textContent = "×";
        delc.addEventListener("click", () => {
          q.choices.splice(ci, 1);
          if (q.answer >= q.choices.length) q.answer = 0;
          if (q.answer === ci) q.answer = 0;
          renderQuestions();
        });
        row.appendChild(delc);
      }
      chBox.appendChild(row);
    });
    card.appendChild(chBox);
    if (q.choices.length < 4) {
      const addc = document.createElement("button");
      addc.type = "button"; addc.className = "mini sub"; addc.textContent = "＋ 選択肢を追加";
      addc.addEventListener("click", () => { q.choices.push(""); renderQuestions(); });
      card.appendChild(addc);
    }
    box.appendChild(card);
  });
}

// ===== 言葉クイズ自動生成 =====
const KANA_POOL = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";
function shuffleArr(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}
$("genBtn").addEventListener("click", () => {
  const words = [...new Set($("genWords").value.split(/\n/).map((s) => s.trim()).filter(Boolean))];
  const type = $("genType").value;
  const inst = $("genInst").value.trim();
  const msg = $("genMsg");
  if (words.length === 0) { msg.textContent = "単語を入れてください"; return; }
  const made = [];
  const skipped = [];
  for (const w of words) {
    const chars = [...w];
    if (type === "shuffle") {
      if (chars.length < 2) { skipped.push(w); continue; }
      let sh = shuffleArr(chars).join("");
      let tries = 0;
      while (sh === w && tries < 10) { sh = shuffleArr(chars).join(""); tries++; }
      if (sh === w) { skipped.push(w); continue; }
      const others = shuffleArr(words.filter((x) => x !== w)).slice(0, 3);
      const choices = shuffleArr([w, ...others]);
      made.push({ title: inst, text: sh, choices, answer: choices.indexOf(w) });
    } else {
      const pos = type === "first" ? 0 : type === "last" ? chars.length - 1 : Math.floor(chars.length / 2);
      if (chars.length < 2 || (type === "middle" && chars.length < 3)) { skipped.push(w); continue; }
      const correct = chars[pos];
      const samePos = new Set();
      words.forEach((other) => {
        const oc = [...other];
        if (oc.length > pos && oc[pos] !== correct) samePos.add(oc[pos]);
      });
      let distract = shuffleArr([...samePos]).slice(0, 3);
      if (distract.length < 3) {
        const pool = shuffleArr([...KANA_POOL].filter((k) => k !== correct && !distract.includes(k)));
        distract = distract.concat(pool.slice(0, 3 - distract.length));
      }
      const choices = shuffleArr([correct, ...distract]);
      const disp = chars.map((c, i) => (i === pos ? "○" : c)).join("");
      made.push({ title: inst, text: disp, choices, answer: choices.indexOf(correct) });
    }
  }
  if (made.length === 0) { msg.textContent = "作れる問題がありませんでした（単語が短すぎる等）"; return; }
  if (questions.length === 1 && !questions[0].text && questions[0].choices.every((c) => !c)) questions = [];
  questions = questions.concat(made);
  renderQuestions();
  msg.textContent = made.length + "問を追加しました" + (skipped.length ? "（作れなかった単語：" + skipped.join("、") + "）" : "");
});

$("newQuizBtn").addEventListener("click", () => openEditor(null, null));
$("addQBtn").addEventListener("click", () => { questions.push(blankQuestion()); renderQuestions(); });
$("backBtn").addEventListener("click", showList);

$("previewBtn").addEventListener("click", () => {
  $("previewBox").classList.toggle("hidden");
  renderPreview();
});
function renderPreview() {
  if ($("previewBox").classList.contains("hidden")) return;
  if (previewIdx >= questions.length) previewIdx = 0;
  const nav = $("previewNav");
  nav.innerHTML = "";
  questions.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mini" + (i === previewIdx ? "" : " gray");
    b.textContent = "問題" + (i + 1);
    b.addEventListener("click", () => { previewIdx = i; renderPreview(); });
    nav.appendChild(b);
  });
  const q = questions[previewIdx];
  if (!q) return;
  $("pvTitle").textContent = q.title || "問題" + (previewIdx + 1);
  $("pvText").textContent = q.text || "（問題文が未入力）";
  const box = $("pvChoices");
  box.innerHTML = "";
  q.choices.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "choice c" + i;
    d.textContent = SYMBOLS[i] + " " + (c || "（未入力）");
    box.appendChild(d);
  });
}

$("saveBtn").addEventListener("click", async () => {
  const title = $("quizTitle").value.trim();
  const msg = $("saveMsg");
  if (!title) { msg.textContent = "クイズのタイトルを入れてください"; return; }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.text.trim()) { msg.textContent = "問題" + (i + 1) + " の問題文が空です"; return; }
    if (q.choices.some((c) => !c.trim())) { msg.textContent = "問題" + (i + 1) + " に空の選択肢があります"; return; }
  }
  const data = {
    title,
    questions: questions.map((q) => ({
      title: (q.title || "").trim(),
      text: q.text.trim(),
      choices: q.choices.map((c) => c.trim()),
      answer: q.answer
    })),
    archived: false,
    updatedAt: Date.now()
  };
  try {
    if (currentId) {
      await setDoc(doc(db, "teachers", teacherUid, "quizzes", currentId), data);
    } else {
      const ref = await addDoc(collection(db, "teachers", teacherUid, "quizzes"), data);
      currentId = ref.id;
    }
    msg.textContent = "保存しました";
    setTimeout(showList, 600);
  } catch (e) {
    msg.textContent = "保存に失敗しました：" + e.message;
  }
});
