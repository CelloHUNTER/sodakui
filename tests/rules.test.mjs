// そだクイ セキュリティルールの自動テスト
// 実行（このフォルダで。ログイン・デプロイはしない。デモ用プロジェクトIDで動く）:
//   npm install
//   npm test
// ※ Firebase Emulator（Java が必要）を使う。本番・開発の Firebase には触れない。
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, deleteField } from "firebase/firestore";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId: "demo-sodakui", firestore: { rules } });

const anon = { firebase: { sign_in_provider: "anonymous" } };
const pw = { firebase: { sign_in_provider: "password" } };
const T1 = "teacher1", T2 = "teacher2", NODOC = "nodoc";

// 端末（匿名）：A=たろうの端末、B=はなこの端末、X=関係ない人
const dbT1 = env.authenticatedContext(T1, pw).firestore();
const dbT2 = env.authenticatedContext(T2, pw).firestore();
const dbNoDoc = env.authenticatedContext(NODOC, pw).firestore();
const dbA = env.authenticatedContext("devA", anon).firestore();
const dbB = env.authenticatedContext("devB", anon).firestore();
const dbX = env.authenticatedContext("devX", anon).firestore();
const dbAnonT = env.authenticatedContext(T1, anon).firestore(); // 匿名で先生と同じuidを名乗るケース（実際には起こらないが念のため）
const dbNone = env.unauthenticatedContext().firestore();

const TARO = "たろう", HANA = "はなこ", OUT = "さぶろう";
const room = (over) => ({ teacherId: T1, quizId: "qz", status: "waiting", phase: "lobby", currentIndex: 0,
  roster: [TARO, HANA], questions: [{}, {}, {}], ...over });

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "teachers", T1), { displayName: "t1" });
    await setDoc(doc(db, "teachers", T2), { displayName: "t2" });
    for (const n of [TARO, HANA, OUT]) await setDoc(doc(db, "teachers", T1, "students", n), { exp: 10, points: 20, plays: 1 });
    await setDoc(doc(db, "teachers", T1, "images", "img1"), { data: "x" });
    await setDoc(doc(db, "rooms", "WAIT"), room({}));
    await setDoc(doc(db, "rooms", "PLAY"), room({ status: "playing", phase: "question", currentIndex: 1 }));
    await setDoc(doc(db, "rooms", "FIN"), room({ status: "finished", phase: "reveal", keys: { 0: [1] } }));
    await setDoc(doc(db, "rooms", "CLOSED"), room({ status: "closed" }));
  });
}
// 先に「たろう」を端末Aに紐づけた状態にする
async function bindTaro(uid = "devA") {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), "teachers", T1, "students", TARO), { ownerUid: uid });
  });
}
async function bindHana(uid = "devB") {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), "teachers", T1, "students", HANA), { ownerUid: uid });
  });
}

let passed = 0, failed = 0;
async function check(name, promise, shouldSucceed) {
  try {
    if (shouldSucceed) await assertSucceeds(promise); else await assertFails(promise);
    console.log("OK  ", name); passed++;
  } catch (e) {
    console.log("NG  ", name, "-", String(e.message).split("\n")[0]); failed++;
  }
}
const stu = (db, n) => doc(db, "teachers", T1, "students", n);

// ===== 先生 =====
console.log("\n--- 先生 ---");
await seed();
await check("先生: 自分の生徒を読み書き", updateDoc(stu(dbT1, TARO), { exp: 11 }), true);
await check("先生: 自分の生徒を一覧", getDocs(collection(dbT1, "teachers", T1, "students")), true);
await check("先生: クイズを作成", setDoc(doc(dbT1, "teachers", T1, "quizzes", "q1"), { title: "t", questions: [] }), true);
await check("先生: 画像を保存", setDoc(doc(dbT1, "teachers", T1, "images", "i2"), { data: "x" }), true);
await check("先生: 記録を保存", setDoc(doc(dbT1, "teachers", T1, "records", "r1"), { nickname: TARO }), true);
await check("先生: 自分の先生ドキュメントを読む", getDoc(doc(dbT1, "teachers", T1)), true);
await check("先生: 自分の先生ドキュメントの作成は不可（招待制）", setDoc(doc(dbNoDoc, "teachers", NODOC), { displayName: "x" }), false);
await check("他の先生: 生徒を読めない", getDoc(stu(dbT2, TARO)), false);
await check("他の先生: クイズを書けない", setDoc(doc(dbT2, "teachers", T1, "quizzes", "q2"), { title: "x" }), false);
await check("先生ドキュメントが無いログイン者: 自分の配下に書けない", setDoc(doc(dbNoDoc, "teachers", NODOC, "quizzes", "q"), { title: "x" }), false);
await check("匿名（先生と同じuid）: 先生として書けない", setDoc(doc(dbAnonT, "teachers", T1, "quizzes", "q3"), { title: "x" }), false);
await check("未ログイン: 何も読めない", getDoc(doc(dbNone, "rooms", "WAIT")), false);

// ===== 部屋 =====
console.log("\n--- 部屋 ---");
await seed();
await check("先生: 部屋を作成", setDoc(doc(dbT1, "rooms", "NEW1"), room({})), true);
await check("先生: 他人のteacherIdで部屋を作れない", setDoc(doc(dbT1, "rooms", "NEW2"), room({ teacherId: T2 })), false);
await check("先生ドキュメントが無い人: 部屋を作れない", setDoc(doc(dbNoDoc, "rooms", "NEW3"), room({ teacherId: NODOC })), false);
await check("子ども（匿名）: 部屋を作れない", setDoc(doc(dbA, "rooms", "NEW4"), room({ teacherId: "devA" })), false);
await check("先生: 自分の部屋を一覧（復帰用）", getDocs(query(collection(dbT1, "rooms"), where("teacherId", "==", T1))), true);
await check("先生: 他人の部屋を一覧できない", getDocs(query(collection(dbT1, "rooms"), where("teacherId", "==", T2))), false);
await check("子ども: 部屋を一覧できない", getDocs(collection(dbA, "rooms")), false);
await check("先生: 部屋を更新", updateDoc(doc(dbT1, "rooms", "WAIT"), { status: "playing" }), true);
await check("他の先生: 部屋を更新できない", updateDoc(doc(dbT2, "rooms", "WAIT"), { status: "closed" }), false);
await check("子ども: 部屋を更新できない", updateDoc(doc(dbA, "rooms", "WAIT"), { status: "closed" }), false);
await check("子ども: 部屋を読める", getDoc(doc(dbA, "rooms", "WAIT")), true);

// ===== 紐づけ（claim）と生徒データの読み取り =====
console.log("\n--- 紐づけと生徒データ ---");
await seed();
await check("子ども（未紐づけ）: 生徒データを読めない", getDoc(stu(dbA, TARO)), false);
await check("子ども: 生徒の一覧は読めない", getDocs(collection(dbA, "teachers", T1, "students")), false);
await check("子ども: roster外の名前は紐づけられない", updateDoc(stu(dbA, OUT), { ownerUid: "devA", claimedIn: "WAIT" }), false);
await check("子ども: 閉じた部屋では紐づけられない", updateDoc(stu(dbA, TARO), { ownerUid: "devA", claimedIn: "CLOSED" }), false);
await check("子ども: 終了した部屋では紐づけられない", updateDoc(stu(dbA, TARO), { ownerUid: "devA", claimedIn: "FIN" }), false);
await check("子ども: 他人のuidで紐づけられない", updateDoc(stu(dbA, TARO), { ownerUid: "devB", claimedIn: "WAIT" }), false);
await check("子ども: 点数も一緒には書けない", updateDoc(stu(dbA, TARO), { ownerUid: "devA", claimedIn: "WAIT", points: 9999 }), false);
await check("子ども: 紐づけできる（端末A→たろう）", updateDoc(stu(dbA, TARO), { ownerUid: "devA", claimedIn: "WAIT" }), true);
await check("端末A: 自分の生徒データを読める（授業の外でも）", getDoc(stu(dbA, TARO)), true);
await check("端末B: たろうは読めない", getDoc(stu(dbB, TARO)), false);
await check("端末B: すでに紐づいた名前は紐づけ直せない", updateDoc(stu(dbB, TARO), { ownerUid: "devB", claimedIn: "WAIT" }), false);
await check("端末A: 自分の点数は書き換えられない", updateDoc(stu(dbA, TARO), { points: 9999 }), false);
await check("端末A: 自分のexpも書き換えられない", updateDoc(stu(dbA, TARO), { exp: 9999 }), false);
await check("端末A: 紐づけを外せない（解除は先生だけ）", updateDoc(stu(dbA, TARO), { ownerUid: deleteField() }), false);
await check("端末A: 紐づけを他の端末へ書き換えられない", updateDoc(stu(dbA, TARO), { ownerUid: "devB" }), false);
await check("端末A: パートナーを初めて選べる", updateDoc(stu(dbA, TARO), { partner: "cat" }), true);
await check("端末A: パートナーを選び直せない", updateDoc(stu(dbA, TARO), { partner: "dog" }), false);
await check("端末B: たろうのパートナーを変えられない", updateDoc(stu(dbB, TARO), { partner: "dog" }), false);
await check("先生: 紐づけを解除できる", updateDoc(stu(dbT1, TARO), { ownerUid: deleteField(), claimedIn: deleteField(), partner: deleteField() }), true);
await check("解除後: 端末Aはもう読めない", getDoc(stu(dbA, TARO)), false);
await check("解除後: 端末Bが紐づけられる（端末の交換）", updateDoc(stu(dbB, TARO), { ownerUid: "devB", claimedIn: "WAIT", partner: "cat" }), true);
await seed();
await check("子ども: 紐づけと同時にパートナーを選べる", updateDoc(stu(dbA, TARO), { ownerUid: "devA", claimedIn: "WAIT", partner: "cat" }), true);
await check("子ども: 生徒データを新規作成できない", setDoc(stu(dbX, "ゆうれい"), { ownerUid: "devX" }), false);
await check("子ども: 生徒データを削除できない", deleteDoc(stu(dbA, TARO)), false);
await check("子ども: クイズ（答えを含む）は読めない", getDoc(doc(dbA, "teachers", T1, "quizzes", "q1")), false);
await check("子ども: 記録は読めない", getDoc(doc(dbA, "teachers", T1, "records", "r1")), false);
await check("子ども: 画像は読める（IDを知っていれば）", getDoc(doc(dbA, "teachers", T1, "images", "img1")), true);
await check("子ども: 画像の一覧は読めない", getDocs(collection(dbA, "teachers", T1, "images")), false);
await check("子ども: 画像を書けない", setDoc(doc(dbA, "teachers", T1, "images", "evil"), { data: "x" }), false);

// ===== 参加者（players） =====
console.log("\n--- 参加者 ---");
await seed(); await bindTaro(); await bindHana();
await check("端末A: たろうとして参加できる", setDoc(doc(dbA, "rooms", "WAIT", "players", TARO), { joinedAt: 1, partner: null }), true);
await check("端末A: 再入室（merge）できる", setDoc(doc(dbA, "rooms", "WAIT", "players", TARO), { joinedAt: 2, partner: null }, { merge: true }), true);
await check("端末A: 終了した部屋にも再入室できる（がんばりカード用）", setDoc(doc(dbA, "rooms", "FIN", "players", TARO), { joinedAt: 2, partner: null }, { merge: true }), true);
await check("端末A: 閉じた部屋には新規参加できない", setDoc(doc(dbA, "rooms", "CLOSED", "players", TARO), { joinedAt: 2, partner: null }), false);
await check("端末A: 自分のパートナーを更新できる", updateDoc(doc(dbA, "rooms", "WAIT", "players", TARO), { partner: "cat" }), true);
await check("端末X: はなことして参加できない（紐づけが別）", setDoc(doc(dbX, "rooms", "WAIT", "players", HANA), { joinedAt: 1, partner: null }), false);
await check("端末A: 他人（はなこ）として参加できない", setDoc(doc(dbA, "rooms", "WAIT", "players", HANA), { joinedAt: 1, partner: null }), false);
await check("端末X: roster外の名前で参加できない", setDoc(doc(dbX, "rooms", "WAIT", "players", OUT), { joinedAt: 1, partner: null }), false);
await check("端末A: 点数つきで参加できない", setDoc(doc(dbA, "rooms", "WAIT", "players", TARO), { joinedAt: 1, partner: null, totalEarned: 999 }), false);
await check("端末A: 自分の点数を書き換えられない", updateDoc(doc(dbA, "rooms", "WAIT", "players", TARO), { totalEarned: 999 }), false);
await check("端末B: 他人の参加者を削除できない", deleteDoc(doc(dbB, "rooms", "WAIT", "players", TARO)), false);
await check("子ども: 参加者の一覧は読める（順位・ロビー用）", getDocs(collection(dbA, "rooms", "WAIT", "players")), true);
await check("先生: 点数を更新できる", updateDoc(doc(dbT1, "rooms", "WAIT", "players", TARO), { totalEarned: 10 }), true);
await check("他の先生: 点数を更新できない", updateDoc(doc(dbT2, "rooms", "WAIT", "players", TARO), { totalEarned: 10 }), false);
await check("端末A: 自分の参加者を削除できる（退出）", deleteDoc(doc(dbA, "rooms", "WAIT", "players", TARO)), true);

// ===== 回答（answers） =====
console.log("\n--- 回答 ---");
await seed(); await bindTaro(); await bindHana();
const ans = (n, q, c) => ({ nickname: n, q, choice: c, at: 1 });
await check("端末A: 出題中の問題に回答できる", setDoc(doc(dbA, "rooms", "PLAY", "answers", TARO + "_1"), ans(TARO, 1, 2)), true);
await check("端末A: 同じ問題に上書きできない", setDoc(doc(dbA, "rooms", "PLAY", "answers", TARO + "_1"), ans(TARO, 1, 3)), false);
await check("端末A: 出題中でない問題には回答できない", setDoc(doc(dbA, "rooms", "PLAY", "answers", TARO + "_0"), ans(TARO, 0, 1)), false);
await check("端末A: 他人（はなこ）の名前で回答できない", setDoc(doc(dbA, "rooms", "PLAY", "answers", HANA + "_1"), ans(HANA, 1, 1)), false);
await check("端末X: 紐づかない端末は回答できない", setDoc(doc(dbX, "rooms", "PLAY", "answers", HANA + "_1"), ans(HANA, 1, 1)), false);
await check("端末B: docIdと中身が食い違う回答はできない", setDoc(doc(dbB, "rooms", "PLAY", "answers", HANA + "_9"), ans(HANA, 1, 1)), false);
await check("端末B: 選択肢の範囲外は送れない", setDoc(doc(dbB, "rooms", "PLAY", "answers", HANA + "_1"), ans(HANA, 1, 7)), false);
await check("端末B: 余計な項目つきは送れない", setDoc(doc(dbB, "rooms", "PLAY", "answers", HANA + "_1"), { ...ans(HANA, 1, 1), bonus: 100 }), false);
await check("端末A: ロビー（開始前）の部屋には回答できない", setDoc(doc(dbA, "rooms", "WAIT", "answers", TARO + "_0"), ans(TARO, 0, 1)), false);
await check("端末A: 終了した部屋には回答できない", setDoc(doc(dbA, "rooms", "FIN", "answers", TARO + "_1"), ans(TARO, 1, 1)), false);
await check("端末A: 自分の回答を読める（復帰用）", getDoc(doc(dbA, "rooms", "PLAY", "answers", TARO + "_1")), true);
await check("端末B: 他人の回答は読めない", getDoc(doc(dbB, "rooms", "PLAY", "answers", TARO + "_1")), false);
await check("子ども: 回答の一覧は読めない", getDocs(collection(dbA, "rooms", "PLAY", "answers")), false);
await check("先生: 回答の一覧を読める", getDocs(collection(dbT1, "rooms", "PLAY", "answers")), true);
await check("子ども: 回答を更新・削除できない", deleteDoc(doc(dbA, "rooms", "PLAY", "answers", TARO + "_1")), false);
await check("先生: 回答を削除できる", deleteDoc(doc(dbT1, "rooms", "PLAY", "answers", TARO + "_1")), true);

// ===== ふくしゅう（review） =====
console.log("\n--- ふくしゅう ---");
await seed(); await bindTaro(); await bindHana();
const rv = (n, over) => ({ nickname: n, quizId: "qz", title: "t", answers: [null, null, null], correctCount: 0, done: false, scored: false, startedAt: 1, ...over });
await check("端末A: 終了した部屋でふくしゅうを始められる", setDoc(doc(dbA, "rooms", "FIN", "review", TARO + "_qz"), rv(TARO, {})), true);
await check("端末A: 進み具合を更新できる", updateDoc(doc(dbA, "rooms", "FIN", "review", TARO + "_qz"), { answers: [1, null, null], correctCount: 1 }), true);
await check("端末A: 完了にできる", updateDoc(doc(dbA, "rooms", "FIN", "review", TARO + "_qz"), { done: true }), true);
await check("端末A: scored を自分で true にできない", updateDoc(doc(dbA, "rooms", "FIN", "review", TARO + "_qz"), { scored: true }), false);
await check("端末A: 問題数より多い正解数は書けない", updateDoc(doc(dbA, "rooms", "FIN", "review", TARO + "_qz"), { correctCount: 99 }), false);
await check("端末A: nickname を書き換えられない", updateDoc(doc(dbA, "rooms", "FIN", "review", TARO + "_qz"), { nickname: HANA }), false);
await check("端末A: 自分の進み具合を読める", getDoc(doc(dbA, "rooms", "FIN", "review", TARO + "_qz")), true);
await check("端末B: たろうの進み具合は読めない", getDoc(doc(dbB, "rooms", "FIN", "review", TARO + "_qz")), false);
await check("子ども: 一覧は読めない", getDocs(collection(dbA, "rooms", "FIN", "review")), false);
await check("端末B: たろうの名前でふくしゅうを作れない", setDoc(doc(dbB, "rooms", "FIN", "review", TARO + "_qz"), rv(TARO, {})), false);
await check("端末B: 他人のdocIdには作れない", setDoc(doc(dbB, "rooms", "FIN", "review", TARO + "_x"), rv(HANA, {})), false);
await check("端末B: scored:true で作れない", setDoc(doc(dbB, "rooms", "FIN", "review", HANA + "_qz"), rv(HANA, { scored: true })), false);
await check("端末B: 正解数が問題数を超える作成は不可", setDoc(doc(dbB, "rooms", "FIN", "review", HANA + "_qz"), rv(HANA, { correctCount: 50 })), false);
await check("端末B: ゲーム中の部屋ではふくしゅうを作れない", setDoc(doc(dbB, "rooms", "PLAY", "review", HANA + "_qz"), rv(HANA, {})), false);
await check("先生: 一覧を読める", getDocs(collection(dbT1, "rooms", "FIN", "review")), true);
await check("先生: scored を true にできる", updateDoc(doc(dbT1, "rooms", "FIN", "review", TARO + "_qz"), { scored: true }), true);
await check("端末A: 採点後に、再作成で scored を戻せない", setDoc(doc(dbA, "rooms", "FIN", "review", TARO + "_qz"), rv(TARO, {})), false);

console.log(`\n結果: ${passed} passed, ${failed} failed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
