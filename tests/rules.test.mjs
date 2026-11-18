// そだクイ セキュリティルールの自動テスト（下書き）
// 実行には Firebase Emulator が必要:
//   npm install （このフォルダで）
//   npx firebase emulators:exec --only firestore "node rules.test.mjs"
// GitHub Actions での自動実行は、ワークフローファイルを GitHub の Web 画面から
// 1回置いてもらう必要がある（連携アプリからは .github/workflows を書けないため）。
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({
  projectId: "sodakui-rules-test",
  firestore: { rules }
});

const TEACHER = "teacher1";
const OTHER = "teacher2";
const teacherDb = env.authenticatedContext(TEACHER).firestore();
const otherDb = env.authenticatedContext(OTHER).firestore();
const childDb = env.anonymousContext ? env.anonymousContext().firestore() : env.unauthenticatedContext().firestore();

// 先生ドキュメントはコンソール作成が前提なので、テストではルールを外して用意する
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const { doc, setDoc } = await import("firebase/firestore");
  await setDoc(doc(db, "teachers", TEACHER), { displayName: "t" });
  await setDoc(doc(db, "rooms", "ABC123"), { teacherId: TEACHER, status: "waiting", phase: "lobby" });
});

const { doc, setDoc, getDoc, updateDoc, deleteDoc } = await import("firebase/firestore");

let passed = 0, failed = 0;
async function check(name, promise, shouldSucceed) {
  try {
    if (shouldSucceed) await assertSucceeds(promise); else await assertFails(promise);
    console.log("OK  ", name); passed++;
  } catch (e) {
    console.log("NG  ", name, "-", e.message); failed++;
  }
}

// 先生は自分の生徒・クイズ・記録を読み書きできる
await check("先生: 自分の生徒を作成", setDoc(doc(teacherDb, "teachers", TEACHER, "students", "ねこたろう"), { exp: 0 }), true);
await check("先生: 自分のクイズを作成", setDoc(doc(teacherDb, "teachers", TEACHER, "quizzes", "q1"), { title: "t", questions: [] }), true);
await check("先生: 自分の記録を読む", getDoc(doc(teacherDb, "teachers", TEACHER, "records", "r1")), true);
// 他の先生は読めない・書けない
await check("他の先生: 生徒を読めない", getDoc(doc(otherDb, "teachers", TEACHER, "students", "ねこたろう")), false);
await check("他の先生: クイズを書けない", setDoc(doc(otherDb, "teachers", TEACHER, "quizzes", "q2"), { title: "x" }), false);
// 先生ドキュメントの自己作成はできない（招待制）
await check("先生: 自分の先生ドキュメント作成は不可", setDoc(doc(otherDb, "teachers", OTHER), { displayName: "x" }), false);
// 子ども（匿名）は部屋を読めるが、生徒データには触れない
await check("子ども: 部屋を読む", getDoc(doc(childDb, "rooms", "ABC123")), true);
await check("子ども: 生徒データを読めない", getDoc(doc(childDb, "teachers", TEACHER, "students", "ねこたろう")), false);
await check("子ども: 参加者として参加できる", setDoc(doc(childDb, "rooms", "ABC123", "players", "ねこたろう"), { totalEarned: 0 }), true);
await check("子ども: 回答を送れる", setDoc(doc(childDb, "rooms", "ABC123", "answers", "ねこたろう_0"), { q: 0, choice: 1 }), true);
// 子どもは点数を書き換えられない（更新は先生だけ）
await check("子ども: 点数の更新はできない", updateDoc(doc(childDb, "rooms", "ABC123", "players", "ねこたろう"), { totalEarned: 999 }), false);
await check("先生: 点数の更新ができる", updateDoc(doc(teacherDb, "rooms", "ABC123", "players", "ねこたろう"), { totalEarned: 10 }), true);

console.log(`\n結果: ${passed} passed, ${failed} failed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
