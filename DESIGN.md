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

## 実装の現状（2026-11-19追記）
当初の設計から、実装は以下の形に落ち着いている。新しい実装はこちらの現状に合わせること。

### 実際のデータ構造
- rooms はトップレベル（部屋コードで直接引くため）。rooms/{roomCode}
  - フィールド：teacherId, quizId, quizTitle, questions（答えを含まない写し。各要素は title, text, choices）, roster, status（waiting/playing/finished/closed）, phase（lobby/title/question/reveal）, currentIndex, answerIndex, scoredQ, scored, hint（{q, hidden}）, podium（発表の進み）, cardsShown, createdAt
- rooms/{roomCode}/players/{nickname}：joinedAt, totalEarned, correctCount, lastEarned, lastCorrect
- rooms/{roomCode}/answers/{nickname}_{q}：nickname, q, choice, at
- teachers/{uid}/students/{nickname}：exp, points, plays, active（false=一覧から外す）, participating（false=部屋の対象外）, isTest（テスト用：記録に残さず完全削除可）
- teachers/{uid}/quizzes/{quizId}：title, questions（各要素は title, text, choices, answer）, archived, updatedAt
- teachers/{uid}/records/{roomCode}_{nickname}：date, roomCode, quizId, quizTitle, nickname, correctCount, totalCount, earned

### 得点（暫定値）
- 回答すると +2点、正解すると さらに +8点。経験値と使えるポイントは同じ増分で両方に加算（分離はデータ上のみ）

### ゲームの流れ（決定事項）
- ロビー → 問題ごとに「タイトルカード（phase=title、タイトルが空なら『問題○』）」→ 先生の「問題を出す」で出題 → 全員回答で自動で答え合わせ（手動ボタンも可）→ 順位発表（ポイントのアニメーション付き）→ 次の問題へ（進みは先生のボタン）
- 終了時は先生画面で結果発表：3位→2位→1位の順に、ドラムロール→名前表示と同時にジャジャーン→発表用BGMが流れ続ける。4位以下は順位を出さず同サイズのタイルで結果のみ（発表が終わってから表示）
- 子どものがんばりカードは、発表後に先生が「がんばりカードを みせる」ボタンを押したときだけ表示（room.cardsShown）
- ヒント：先生のボタンで間違いの選択肢2つを消す（room.hint）
- 子どもの答え合わせ画面には正解数と現在の順位（○位／○人中）も表示する

### 音（sound.js）
- BGM・効果音はすべてプログラム合成（音声ファイルなし）。124BPMのグルーヴ系BGM（ロビー／問題／結果／発表用の4モード）
- 音を変えるときは「短い試聴サンプル→本人の了承→実装」の順を守る

### クイズ作成（editor.html）
- 先生専用ページで自作クイズの作成・編集・複製・削除（一覧から消す方式）
- 言葉クイズ自動生成：単語リスト＋型（最初／最後／真ん中を○隠し、文字並び替え）＋指示文から一括生成し、通常の編集で直せる

### セキュリティルール
- 本番用ルールの下書きは firestore.rules、テストの下書きは tests/、移行手順は PRODUCTION.md
- 開発プロジェクトは現在テストモード。本番使用前に必ず差し替えること

### ふくしゅうモードと記録の詳細（2026-11-19追記）
- ふくしゅう部屋：rooms に mode: "review" と quizzes（複数クイズの写し）を入れる。子どもは自分のペースで解き、答え合わせはその場で出る。そのため復習用の写しには答え（keys）を含める（本番モードでは従来通り答えを渡さない）。ポイントは正解1問2点、最初の完了1回だけ。採点と記録は先生の端末が行う
- 進み具合は rooms/{roomCode}/review/{nickname}_{quizId}（answers, correctCount, done, scored）
- 記録（records）には問題ごとの結果 detail（q, choice, correct）と区分 mode（live/review）を持ち、CSVには正答率と問題ごとの○×－を出す
