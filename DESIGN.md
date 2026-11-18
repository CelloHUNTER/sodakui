# そだクイ DESIGN.md

このファイルは、そだクイのデータ構造とセキュリティルールの方針を定めるものです。
実装するAI（Muse／Claude Code／Gemini）は、コードを書く前に必ずこの方針に従ってください。
詳細な仕様は仕様書（quiz_chara_spec）が正で、このファイルは実装上の要約です。

## 技術構成
- 公開：GitHub Pages（公開リポジトリ、静的ファイルのみ）
- データ・認証・同期：Firebase（Sparkプラン＝無料枠のみ。Blazeへ移行しない）
  - Authentication：先生＝メールアドレス＋パスワード、子ども＝匿名認証（自動）
  - Cloud Firestore：保存場所は asia-northeast1（東京）で作成する。作成後は変更不可
- 使わないもの：Cloud Storage（ドット絵はリポジトリに置き Pages から配信）、Cloud Functions（採点は先生の端末側で行う）
- システム内にAIは使わない。AIは制作時にのみ使う

## データ構造（Firestore）
すべての業務データは先生（teacherId）の配下に分離する。

- teachers/{uid}
  - 先生の許可リスト。存在する uid のみが「先生」。管理者（本人）が手動で作成する＝招待制の実装
  - フィールド：displayName, createdAt
- teachers/{uid}/quizzes/{quizId}
  - 問題セット。フィールド：title, questions（配列）, createdAt, updatedAt
  - questions の各要素：text（問題文）, choices（2〜4個の配列）, answerIndex（正解の番号）, image（任意、リポジトリ内パス）, mask（任意、絵本マスクの図形データ）
  - 注意：answerIndex を含むため、このコレクションは先生本人のみ読み書き可（下記ルール参照）
- teachers/{uid}/rooms/{roomId}
  - 開催中の部屋。roomId は推測しにくいランダム文字列。フィールド：quizId, status（waiting/playing/finished）, currentIndex, createdAt
  - 子ども向けには、正解を含まない出題情報だけを別ドキュメント（rooms/{roomId}/public/question）として配信する
- teachers/{uid}/rooms/{roomId}/answers/{answerId}
  - 子どもの回答。フィールド：nickname, questionIndex, choiceIndex, answeredAt
  - 書き込みは匿名認証済みの端末から、自分の回答のみ。1問につき1回まで（クライアントとルールの両方で制限）
- teachers/{uid}/students/{nickname}
  - 子どもごとの育成記録。フィールド：partnerId（キャラ系統）, exp（経験値）, points（使えるポイント）, level, updatedAt
  - キーはニックネーム。本名・イニシャルは入れない
- teachers/{uid}/records/{recordId}
  - 授業ごとの学習記録。フィールド：date, quizId, nickname, correctCount, totalCount, details
  - CSV書き出しの元データ

## セキュリティルールの方針
- デフォルトは全拒否（allow read, write: if false）から始める
- 先生：request.auth.uid が teachers/{uid} に一致し、かつ teachers/{uid} ドキュメントが存在する場合のみ、その配下を読み書き可
- 子ども（匿名認証）：request.auth が存在すれば、開催中（status が waiting/playing）の部屋の public 情報の読み取りと、自分の answers の作成のみ可。quizzes・students・records は直接読み書きさせない
  - 育成記録の更新は、回答時に先生の端末側が集計して書き込む方式を基本とする（子ども端末に students への書き込み権限を与えない）
- ルールは GitHub Actions 上の Firebase Emulator テストで検証してからマージする

## 通信量の設計原則
- 集計（全員の回答状況）は先生の端末だけが読む
- 子どもの端末は「現在の問題（public）」「自分の育成記録の表示に必要な最小限」だけを読む
- リスナー（onSnapshot）は画面ごとに必要最小限にし、二重登録しない

## 復帰処理
- 子どもの端末は、参加中の部屋IDとニックネームを localStorage に保持し、リロード／スリープ復帰時は同じ部屋・同じ自分に自動復帰する

## キャラクター画像
- リポジトリ内 assets/characters/ に置く。命名規則：{系統ID}_{段階}.png（例：cat_1.png, cat_2.png, cat_3.png）
- 系統ID一覧：cat, dog, bird, train, truck, fire, police, sports, momotaro, kasajizo, tyrano, tricera, ptera, robot, puni
- 最初は仮画像（単色の図形）で仕組みを完成させ、後から差し替える

## プロジェクト運用
- Firebaseプロジェクトは開発用と本番用の2つ。開発中は開発用のみ使う
- コードはブランチ→プルリクエストで変更し、main への直接 push はしない
