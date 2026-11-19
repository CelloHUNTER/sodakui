import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261119o";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const SYMBOLS = ["●", "▲", "■", "◆"];

let teacherUid = null;
let currentId = null;      // 編集中のクイズID（新規は null）
let questions = [];        // 編集中の問題 [{title, text, choices[], answer}]
let previewIdx = 0;
let pvShowHints = false;

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
  draftReady = false;
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
      (q.questions ? q.questions.length : 0) + "問　" + date + (q.draft ? "　・下書きあり" : "") + "</p>";
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
  window.scrollTo(0, keepY);
  buildMarkCtl();
  scheduleDraft();
}

function blankQuestion() {
  return { title: "", text: "", choices: ["", "", "", ""], answers: [0], imageId: null, masks: [], hints: [] };
}

// ===== 画像（絵本のページなど） =====
const imgCache = {};
async function loadEditorImage(imageId) {
  if (!imageId) return null;
  if (imgCache[imageId]) return imgCache[imageId];
  const s = await getDoc(doc(db, "teachers", teacherUid, "images", imageId));
  if (!s.exists()) return null;
  imgCache[imageId] = s.data().data;
  return imgCache[imageId];
}
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function openEditor(id, data) {
  selMark = null;
  undoStack = [];
  redoStack = [];
  updateUndoBtns();
  draftReady = false;
  currentId = id;
  let srcData = data;
  if (id && data && data.draft && data.draft.questions && data.draft.questions.length) {
    if (confirm("下書きがあります。下書きから続けますか？\n（キャンセルで、前回保存した内容を開きます）")) {
      srcData = { title: data.draft.title, questions: data.draft.questions };
    }
  }
  questions = JSON.parse(JSON.stringify(srcData && srcData.questions && srcData.questions.length ? srcData.questions : [blankQuestion()]));
  // 旧形式（answer が1つ）から新形式（answers の配列）へそろえる
  questions.forEach((q) => {
    if (!Array.isArray(q.answers) || q.answers.length === 0) {
      q.answers = [typeof q.answer === "number" ? q.answer : 0];
    }
    delete q.answer;
    if (!Array.isArray(q.masks)) q.masks = [];
    if (!Array.isArray(q.hints)) q.hints = [];
  });
  $("quizTitle").value = srcData ? srcData.title || "" : "";
  $("saveMsg").textContent = "";
  previewIdx = 0;
  $("previewBox").classList.add("hidden");
  $("listView").classList.add("hidden");
  $("editView").classList.remove("hidden");
  renderQuestions();
  baselineStr = snapState();
  draftReady = true;
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

// ===== マスク・ヒント図形の編集 =====
let selMark = null; // {q, kind: "mask"|"hint", i}
let dragMark = null;

// ===== 編集の履歴（もどる/すすむ）=====
let undoStack = [];
let redoStack = [];
function snapState() { return JSON.stringify({ title: $("quizTitle").value, questions }); }
function pushSnap(str) {
  undoStack.push(str);
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  updateUndoBtns();
}
function pushHistory() { pushSnap(snapState()); }
function restoreState(str) {
  const o = JSON.parse(str);
  questions = o.questions;
  $("quizTitle").value = o.title;
  selMark = null;
  renderQuestions();
  updateUndoBtns();
}
function updateUndoBtns() {
  const u = $("undoBtn"), r = $("redoBtn");
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}
// 文字入力は「入力し終わったとき」に1手として記録する
function watchText(el) {
  let pre = null, preVal = "";
  el.addEventListener("focus", () => { pre = snapState(); preVal = el.value; });
  el.addEventListener("change", () => { if (pre && el.value !== preVal) pushSnap(pre); pre = null; });
}

function editorMarkEl(qi, kind, m, i) {
  const d = markEl(m, kind === "hint");
  if (selMark && selMark.q === qi && selMark.kind === kind && selMark.i === i) d.classList.add("sel");
  d.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    selMark = { q: qi, kind, i };
    document.querySelectorAll(".imgwrap.ed .mark").forEach((el) => el.classList.remove("sel"));
    d.classList.add("sel");
    buildMarkCtl();
    const wrap = d.parentElement.parentElement;
    dragMark = { qi, kind, i, rect: wrap.getBoundingClientRect(), startX: ev.clientX, startY: ev.clientY, origX: m.x, origY: m.y, el: d, snap: snapState() };
  });
  return d;
}
window.addEventListener("pointermove", (ev) => {
  if (!dragMark) return;
  const q = questions[dragMark.qi];
  if (!q) return;
  const arr = dragMark.kind === "mask" ? q.masks : q.hints;
  const m = arr && arr[dragMark.i];
  if (!m) return;
  m.x = Math.max(0, Math.min(100 - m.w, dragMark.origX + (ev.clientX - dragMark.startX) / dragMark.rect.width * 100));
  m.y = Math.max(0, Math.min(100 - m.h, dragMark.origY + (ev.clientY - dragMark.startY) / dragMark.rect.height * 100));
  dragMark.el.style.left = m.x + "%";
  dragMark.el.style.top = m.y + "%";
});
window.addEventListener("pointerup", () => {
  if (dragMark) {
    const q = questions[dragMark.qi];
    const arr = q && (dragMark.kind === "mask" ? q.masks : q.hints);
    const m = arr && arr[dragMark.i];
    if (m && (m.x !== dragMark.origX || m.y !== dragMark.origY)) pushSnap(dragMark.snap);
  }
  dragMark = null;
});

function repaintEditorMarks(qi) {
  const layer = document.querySelector('.marks[data-q="' + qi + '"]');
  if (!layer) return;
  layer.innerHTML = "";
  const q = questions[qi];
  (q.masks || []).forEach((m, i) => layer.appendChild(editorMarkEl(qi, "mask", m, i)));
  (q.hints || []).forEach((m, i) => layer.appendChild(editorMarkEl(qi, "hint", m, i)));
}
function syncMarkEl(qi) {
  if (!selMark || selMark.q !== qi) return;
  const layer = document.querySelector('.marks[data-q="' + qi + '"]');
  if (!layer) return;
  const q = questions[qi];
  const arr = selMark.kind === "mask" ? q.masks : q.hints;
  const m = arr && arr[selMark.i];
  const idx = selMark.kind === "mask" ? selMark.i : (q.masks || []).length + selMark.i;
  const el = layer.children[idx];
  if (!el || !m) return;
  el.style.width = m.w + "%";
  el.style.height = m.h + "%";
  el.style.transform = "rotate(" + (m.rot || 0) + "deg)";
  const sp = el.querySelector(".mq");
  if (sp) sp.style.transform = "rotate(" + (-(m.rot || 0)) + "deg)";
}
function sliderRow(label, val, min, max, fn) {
  const div = document.createElement("div");
  div.className = "slider-row";
  const lab = document.createElement("span");
  lab.textContent = label;
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.value = val;
  const num = document.createElement("span");
  num.className = "note"; num.textContent = val;
  inp.addEventListener("input", () => { num.textContent = inp.value; fn(Number(inp.value)); });
  let preSnap = null, preVal = val;
  inp.addEventListener("pointerdown", () => { preSnap = snapState(); preVal = Number(inp.value); });
  inp.addEventListener("change", () => { if (preSnap && Number(inp.value) !== preVal) pushSnap(preSnap); preSnap = null; });
  div.append(lab, inp, num);
  return div;
}
function mkMiniBtn(label, cls, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mini " + (cls || "");
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}
// ===== 下書きの自動保存 =====
let draftReady = false;
let baselineStr = "";
let draftTimer = null;
function scheduleDraft() {
  if (!draftReady) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 2500);
}
async function saveDraft() {
  if (!draftReady || !teacherUid) return;
  const str = snapState();
  if (str === baselineStr) return;
  const o = JSON.parse(str);
  try {
    if (currentId) {
      await updateDoc(doc(db, "teachers", teacherUid, "quizzes", currentId), {
        draft: { title: o.title, questions: o.questions, updatedAt: Date.now() }
      });
    } else {
      localStorage.setItem("sodakui_draft_new", JSON.stringify({ title: o.title, questions: o.questions, updatedAt: Date.now() }));
    }
  } catch (e) { /* 下書きが保存できない環境では無視する */ }
}
window.addEventListener("beforeunload", (e) => {
  if (draftReady && !$("editView").classList.contains("hidden") && snapState() !== baselineStr) {
    e.preventDefault();
    e.returnValue = "";
  }
});

function iconBtn(ic, cap, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mini sub iconbtn";
  const s = document.createElement("span");
  s.className = "ic " + ic;
  const c = document.createElement("span");
  c.className = "cap";
  c.textContent = cap;
  b.append(s, c);
  b.addEventListener("click", fn);
  return b;
}
function buildMarkCtl() {
  const bar = $("markBar");
  if (!bar) return;
  bar.innerHTML = "";
  const q = selMark && questions[selMark.q];
  const arr = q && (selMark.kind === "mask" ? (q.masks || []) : (q.hints || []));
  const m = arr && arr[selMark.i];
  if (!q || !m) {
    bar.classList.add("hidden");
    document.body.classList.remove("bar-open");
    return;
  }
  bar.classList.remove("hidden");
  document.body.classList.add("bar-open");
  const qi = selMark.q;
  const title = document.createElement("p");
  title.className = "grouplabel";
  title.style.margin = "2px 0 4px";
  title.textContent = (selMark.kind === "mask" ? "選んだマスクの調整" : "選んだヒント図形の調整") + "（ドラッグで移動）";
  bar.appendChild(title);
  bar.appendChild(sliderRow("横幅", m.w, 5, 100, (v) => { m.w = v; syncMarkEl(qi); scheduleDraft(); }));
  bar.appendChild(sliderRow("高さ", m.h, 5, 100, (v) => { m.h = v; syncMarkEl(qi); scheduleDraft(); }));
  bar.appendChild(sliderRow("回転", m.rot || 0, 0, 360, (v) => { m.rot = v; syncMarkEl(qi); scheduleDraft(); }));
  const row = document.createElement("div");
  row.className = "row";
  if (selMark.kind === "mask") {
    row.appendChild(mkMiniBtn(m.qmark === false ? "？を出す" : "？を消す", "sub", () => {
      pushHistory();
      m.qmark = m.qmark === false ? true : false;
      repaintEditorMarks(qi);
      buildMarkCtl();
      scheduleDraft();
    }));
  }
  row.appendChild(mkMiniBtn("複製", "sub", () => {
    pushHistory();
    const copy = JSON.parse(JSON.stringify(m));
    copy.x = Math.min(100 - copy.w, copy.x + 4);
    copy.y = Math.min(100 - copy.h, copy.y + 4);
    arr.push(copy);
    selMark = { q: qi, kind: selMark.kind, i: arr.length - 1 };
    renderQuestions();
  }));
  row.appendChild(mkMiniBtn("この図形を消す", "delbtn", () => {
    pushHistory();
    arr.splice(selMark.i, 1);
    selMark = null;
    renderQuestions();
  }));
  row.appendChild(mkMiniBtn("閉じる", "gray", () => {
    selMark = null;
    document.querySelectorAll(".imgwrap.ed .mark").forEach((el) => el.classList.remove("sel"));
    buildMarkCtl();
  }));
  bar.appendChild(row);
}

function wrapAspect(qi) {
  const layer = document.querySelector('.marks[data-q="' + qi + '"]');
  if (!layer || !layer.parentElement) return 1;
  const r = layer.parentElement.getBoundingClientRect();
  return r.height > 0 ? r.width / r.height : 1;
}
function addMark(qi, kind, shape) {
  pushHistory();
  const q = questions[qi];
  const asp = wrapAspect(qi);
  if (kind === "mask") {
    q.masks = q.masks || [];
    let w = 30, h = 30;
    if (shape === "rect") { h = Math.max(5, Math.min(100, Math.round(w * asp))); }
    if (shape === "circle") { w = 26; h = Math.max(5, Math.min(100, Math.round(w * asp))); }
    if (shape === "tri") { w = 30; h = Math.max(5, Math.min(100, Math.round(w * asp * 0.866))); }
    q.masks.push({ shape, x: 35, y: Math.max(0, Math.min(30, 100 - h)), w, h, rot: 0, qmark: true });
    selMark = { q: qi, kind, i: q.masks.length - 1 };
  } else {
    q.hints = q.hints || [];
    const defs = { arrow: [26, 18], fcircle: [32, Math.max(5, Math.min(100, Math.round(32 * asp)))], frect: [32, 26], ruler: [48, 11] };
    const wh = defs[shape] || [30, 30];
    q.hints.push({ kind: shape, x: 30, y: 40, w: wh[0], h: wh[1], rot: 0 });
    selMark = { q: qi, kind, i: q.hints.length - 1 };
  }
  renderQuestions();
  const layer = document.querySelector('.marks[data-q="' + qi + '"]');
  if (layer) layer.parentElement.scrollIntoView({ block: "center" });
}

function renderQuestions() {
  const keepY = window.scrollY;
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
      mkBtn("↑", "gray", () => { if (qi > 0) { pushHistory(); [questions[qi - 1], questions[qi]] = [questions[qi], questions[qi - 1]]; renderQuestions(); } }),
      mkBtn("↓", "gray", () => { if (qi < questions.length - 1) { pushHistory(); [questions[qi + 1], questions[qi]] = [questions[qi], questions[qi + 1]]; renderQuestions(); } }),
      mkBtn("複製", "sub", () => { pushHistory(); questions.splice(qi + 1, 0, JSON.parse(JSON.stringify(q))); renderQuestions(); }),
      mkBtn("削除", "gray", () => { if (questions.length > 1) { pushHistory(); questions.splice(qi, 1); if (selMark) { if (selMark.q === qi) selMark = null; else if (selMark.q > qi) selMark.q--; } renderQuestions(); } })
    );
    card.appendChild(head);

    const tLabel = document.createElement("label");
    tLabel.textContent = "タイトル（空のままだと「問題" + (qi + 1) + "」になります）";
    const tInput = document.createElement("input");
    tInput.value = q.title || "";
    tInput.addEventListener("input", () => { q.title = tInput.value; scheduleDraft(); });
    watchText(tInput);
    card.append(tLabel, tInput);

    const qLabel = document.createElement("label");
    qLabel.textContent = "問題文";
    const qInput = document.createElement("textarea");
    qInput.rows = 2;
    qInput.value = q.text || "";
    qInput.addEventListener("input", () => { q.text = qInput.value; scheduleDraft(); });
    watchText(qInput);
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
      input.addEventListener("input", () => { q.choices[ci] = input.value; scheduleDraft(); });
      watchText(input);
      const ans = document.createElement("button");
      ans.type = "button";
      const isAns = (q.answers || []).includes(ci);
      ans.className = "mini ansbtn" + (isAns ? " on" : "");
      ans.textContent = isAns ? "正解" : "正解にする";
      ans.addEventListener("click", () => {
        pushHistory();
        const set = new Set(q.answers || []);
        if (set.has(ci)) { if (set.size > 1) set.delete(ci); } else { set.add(ci); }
        q.answers = [...set].sort((a, b) => a - b);
        renderQuestions();
      });
      row.append(dot, input, ans);
      if (q.choices.length > 2) {
        const delc = document.createElement("button");
        delc.type = "button"; delc.className = "mini gray"; delc.textContent = "×";
        delc.addEventListener("click", () => {
          pushHistory();
          q.choices.splice(ci, 1);
          q.answers = (q.answers || []).filter((a) => a !== ci).map((a) => (a > ci ? a - 1 : a));
          if (q.answers.length === 0) q.answers = [0];
          renderQuestions();
        });
        row.appendChild(delc);
      }
      chBox.appendChild(row);
    });
    const imgBox = document.createElement("div");
    imgBox.className = "imgbox";
    if (q.imageId) {
      const wrap = document.createElement("div");
      wrap.className = "imgwrap ed";
      const im = document.createElement("img");
      im.className = "qimg2";
      im.alt = "";
      loadEditorImage(q.imageId).then((url) => { if (url) im.src = url; });
      const layer = document.createElement("div");
      layer.className = "marks";
      layer.dataset.q = qi;
      (q.masks || []).forEach((m, mi) => layer.appendChild(editorMarkEl(qi, "mask", m, mi)));
      (q.hints || []).forEach((m, mi) => layer.appendChild(editorMarkEl(qi, "hint", m, mi)));
      wrap.append(im, layer);
      imgBox.appendChild(wrap);
      const g1 = document.createElement("p");
      g1.className = "grouplabel";
      g1.textContent = "かくす（マスク）";
      const note1 = document.createElement("p");
      note1.className = "note";
      note1.textContent = "問題の間だけ隠れて、答え合わせで外れます";
      const row1 = document.createElement("div");
      row1.className = "markrow";
      row1.append(
        iconBtn("rect", "四角", () => addMark(qi, "mask", "rect")),
        iconBtn("circle", "丸", () => addMark(qi, "mask", "circle")),
        iconBtn("tri", "三角", () => addMark(qi, "mask", "tri"))
      );
      const g2 = document.createElement("p");
      g2.className = "grouplabel";
      g2.textContent = "ヒント図形";
      const note2 = document.createElement("p");
      note2.className = "note";
      note2.textContent = "ゲーム中、先生が「ヒント」ボタンを押したときだけ出ます";
      const row2 = document.createElement("div");
      row2.className = "markrow";
      row2.append(
        iconBtn("arrow", "矢印", () => addMark(qi, "hint", "arrow")),
        iconBtn("fcircle", "丸枠", () => addMark(qi, "hint", "fcircle")),
        iconBtn("frect", "四角枠", () => addMark(qi, "hint", "frect")),
        iconBtn("ruler", "定規", () => addMark(qi, "hint", "ruler"))
      );
      const rm = document.createElement("button");
      rm.type = "button"; rm.className = "mini gray"; rm.textContent = "画像を外す";
      rm.addEventListener("click", () => { pushHistory(); q.imageId = null; q.masks = []; q.hints = []; if (selMark && selMark.q === qi) selMark = null; renderQuestions(); });
      imgBox.append(g1, note1, row1, g2, note2, row2, rm);
    } else {
      const add = document.createElement("button");
      add.type = "button"; add.className = "mini sub"; add.textContent = "＋ 画像をつける（絵本のページなど）";
      const file = document.createElement("input");
      file.type = "file"; file.accept = "image/*"; file.className = "hidden";
      add.addEventListener("click", () => file.click());
      file.addEventListener("change", async () => {
        if (!file.files || !file.files[0]) return;
        add.textContent = "読み込み中…"; add.disabled = true;
        try {
          const dataUrl = await downscaleImage(file.files[0]);
          const ref = await addDoc(collection(db, "teachers", teacherUid, "images"), { data: dataUrl, createdAt: Date.now() });
          pushHistory();
          q.imageId = ref.id;
          renderQuestions();
        } catch (e) {
          add.textContent = "＋ 画像をつける（絵本のページなど）"; add.disabled = false;
          alert("画像を付けられませんでした");
        }
      });
      imgBox.append(add, file);
    }
    card.appendChild(imgBox);
    card.appendChild(chBox);
    if (q.choices.length < 4) {
      const addc = document.createElement("button");
      addc.type = "button"; addc.className = "mini sub"; addc.textContent = "＋ 選択肢を追加";
      addc.addEventListener("click", () => { pushHistory(); q.choices.push(""); renderQuestions(); });
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
  if (type === "odd") {
    const groups = $("genWords").value.split(/\n\s*\n/)
      .map((g) => [...new Set(g.split(/\n/).map((s) => s.trim()).filter(Boolean))])
      .filter((g) => g.length > 0);
    const usable = groups.filter((g) => g.length >= 3);
    const allWords = groups.flat();
    if (groups.length < 2 || usable.length === 0) {
      msg.textContent = "仲間外れには、空行で分けた2グループ以上（1グループ3語以上）が必要です";
      return;
    }
    const oddText = inst && inst !== "○に はいるのは どれ？" ? inst : "仲間外れは どれ？";
    const madeOdd = [];
    for (const g of usable) {
      const trio = shuffleArr(g).slice(0, 3);
      const outsiders = allWords.filter((w) => !g.includes(w));
      if (outsiders.length === 0) continue;
      const oddOne = outsiders[Math.floor(Math.random() * outsiders.length)];
      const choices = shuffleArr([...trio, oddOne]);
      madeOdd.push({ title: "", text: oddText, choices, answers: [choices.indexOf(oddOne)], imageId: null, masks: [], hints: [] });
    }
    if (madeOdd.length === 0) { msg.textContent = "作れる問題がありませんでした"; return; }
    if (questions.length === 1 && !questions[0].text && questions[0].choices.every((c) => !c)) questions = [];
    pushHistory();
    questions = questions.concat(madeOdd);
    renderQuestions();
    msg.textContent = madeOdd.length + "問を追加しました";
    return;
  }
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
      made.push({ title: inst, text: sh, choices, answers: [choices.indexOf(w)], imageId: null, masks: [], hints: [] });
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
      made.push({ title: inst, text: disp, choices, answers: [choices.indexOf(correct)], imageId: null, masks: [], hints: [] });
    }
  }
  if (made.length === 0) { msg.textContent = "作れる問題がありませんでした（単語が短すぎる等）"; return; }
  if (questions.length === 1 && !questions[0].text && questions[0].choices.every((c) => !c)) questions = [];
  pushHistory();
  questions = questions.concat(made);
  renderQuestions();
  msg.textContent = made.length + "問を追加しました" + (skipped.length ? "（作れなかった単語：" + skipped.join("、") + "）" : "");
});

$("newQuizBtn").addEventListener("click", () => {
  let d = null;
  try { d = JSON.parse(localStorage.getItem("sodakui_draft_new") || "null"); } catch (e) { /* 読めなければ無視 */ }
  if (d && d.questions && d.questions.length && confirm("下書き（新しいクイズ）があります。下書きから続けますか？")) {
    openEditor(null, { title: d.title, questions: d.questions });
    return;
  }
  openEditor(null, null);
});
$("addQBtn").addEventListener("click", () => { pushHistory(); questions.push(blankQuestion()); renderQuestions(); });
watchText($("quizTitle"));
$("quizTitle").addEventListener("input", scheduleDraft);
$("undoBtn").addEventListener("click", () => {
  if (!undoStack.length) return;
  redoStack.push(snapState());
  restoreState(undoStack.pop());
});
$("redoBtn").addEventListener("click", () => {
  if (!redoStack.length) return;
  undoStack.push(snapState());
  restoreState(redoStack.pop());
});
$("backBtn").addEventListener("click", () => { saveDraft(); showList(); });

$("previewBtn").addEventListener("click", () => {
  $("previewBox").classList.toggle("hidden");
  renderPreview();
});
$("pvHintBtn").addEventListener("click", () => { pvShowHints = !pvShowHints; renderPreview(); });
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
  const pvImg = $("pvImg");
  const pvWrap = $("pvImgWrap");
  if (q.imageId) {
    loadEditorImage(q.imageId).then((url) => {
      if (url && questions[previewIdx] === q) { pvImg.src = url; pvWrap.classList.remove("hidden"); }
    });
    pvWrap.classList.add("hidden");
  } else {
    pvWrap.classList.add("hidden");
    pvImg.removeAttribute("src");
  }
  paintMarks($("pvMarks"), q.masks || [], pvShowHints ? (q.hints || []) : []);
  $("pvHintBtn").textContent = "ヒント表示：" + (pvShowHints ? "オン" : "オフ");
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
      answers: q.answers && q.answers.length ? q.answers : [0],
      imageId: q.imageId || null,
      masks: q.masks || [],
      hints: q.hints || []
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
    baselineStr = snapState();
    draftReady = false;
    try { localStorage.removeItem("sodakui_draft_new"); } catch (e) { /* 無視 */ }
    msg.textContent = "保存しました";
    setTimeout(showList, 600);
  } catch (e) {
    msg.textContent = "保存に失敗しました：" + e.message;
  }
});
