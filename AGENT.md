# AGENT.md

このリポジトリで作業するときの前提と約束。ゲームの内容は [README.md](README.md) を参照。

## 全体像

- **`index.html` 1 ファイル**（約 5,900 行）。依存パッケージもビルドもない。
  JS はすべて 1 つの IIFE の中にあり、`'use strict'`。
- 外部画像を持たない。キャラも地面も紋章もファビコンも、その場で Canvas / SVG で描く。
- 音は Web Audio の合成音のみ。音源ファイルは無い。
- **オンライン対戦とグローバルランキングへ向けた改造の途中**。詳細は下の「進行中の設計」。

## 動かす

```sh
python3 -m http.server 8731     # file:// では開けない（今後のモジュール分割の前提に合わせている）
```

構文チェックは `<script>` の中身を取り出して行う。

```sh
s=$(grep -n "^<script>" index.html | cut -d: -f1)
e=$(grep -n "^</script>" index.html | cut -d: -f1)
awk -v s="$s" -v e="$e" 'NR>s && NR<e' index.html > /tmp/game.js && node --check /tmp/game.js
```

## 変更したら必ず回帰テストを通す

CPU 同士の自動対戦を 50 戦回し、最終盤面の指紋を [`test/selfplay-baseline.txt`](test/selfplay-baseline.txt)
と突き合わせる。**1 行でも変われば、どこかで挙動が変わっている。**

ブラウザで `index.html` を開き、コンソールで:

```js
const fp = s => { let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0'); };
copy(__ohajiki.selfplaySuite(1, 50).map(r =>
  `${r.seed} st${r.stage} p${r.players} ai${r.aiLevel} f${r.factions.join('')} ` +
  `${r.plies}/${r.steps} d${r.done ? 1 : 0} w${r.winner} ${fp(JSON.stringify(r))}`).join('\n'));
```

結果は**区切り方に依存しない**。`selfplaySuite(1,50)` でも 1 戦ずつでも逆順でも同じになる。
ならなければ、試合をまたぐ状態漏れが入り込んでいる。

意図して挙動を変えたときは、ベースラインを取り直してファイル冒頭の「取得時点」を更新する。

`__ohajiki` には検証用の入口が一式ある（`selfplay` / `createMatch` / `useMatch` / `reset` /
`applyPlan` / `simUntilRest` / `digest` / `setSeed` / `headless` / `pieceHitBox` /
`wipe` / `unlockAll` / `fillMatrix` / `runStart` / `give` / `warp` など）。

## 中心にあるもの：マッチ状態 `M`

**1 試合ぶんの状態はすべて `M`（`createMatch()` が返すオブジェクト）に入っている。**

| 分類 | 中身 |
|---|---|
| ステージ | `stageIdx` `ST` `ARENA` `HOLES` `FRICTION` `holeSpin` `stageT` `pulseK` |
| 対戦条件 | `players` `factions` `aiLevel` |
| 進行 | `pieces` `turn` `phase` `winner` `shooter` `armed` `arrow` `bomb` `extraShot` `started` `potions` `stats` |
| 乱数 | `rng` |

`M` は「いま進めている対局」を指し、`useMatch(m)` で差し替える。
**複数の対局を 1 プロセスで同時に保持できる**（交互に 1 手ずつ進めても互いに干渉しない）。
サーバーもこの仕組みで対局を回す前提。

グローバルに残っているのは**画面のための状態だけ**で、サーバーには持っていかない:
`effects` `drag` `hoverId` `activeId` `turnFade` `drawMs` `pulseFrame` `ai` `MODE` `RUN` `MATCH` `SAVE`。

### 守ること

- **ルールに効く乱数は必ず `M.rng()` を通す。** `Math.random()` を使ってよいのは火花・煙・
  効果音・BGM といった演出だけ。演出を `M.rng` に載せると、演出をひとつ足しただけで
  以降の乱数列がずれ、同じ手を再生しても盤面が変わってしまう。
- **乱数列は対局ごとに独立させる。** 共有すると並行して進めたとき互いの乱数を食い合う。
- 新しく可変の状態を足すときは、勝敗に効くなら `M` へ、見た目だけならグローバルへ。

## sim と client の分離

サーバーで動かす部分（sim）から、演出・音・HUD・実績を追い出してある。

- `stepPhysics` `damage` `kill` と能力系（`fireArrow` `stepArrow` `throwBomb` `explode`
  `stepBomb` `teleport` `raiseShield` `usePotion` `revive`）は**ルール判定だけ**を行う。
  DOM も Audio も触らない。
- 副作用はすべて `hooks` 経由。実装が 2 つある:
  - `gameHooks` … 火花・音・HUD・実績を出す。遊んでいる画面用
  - `aiHooks` … すべて no-op。先読みと、将来のサーバー用
- 実績判定は `metaOnDamage` / `metaOnKill` / `metaOnSkill` / `metaOnPotion` に集約し、
  メタ進行層に置いてある。

**この 2 つの関数群に `effects.push` / `beep` / `sfx*` / `updateHud` / `ach()` を書き足さないこと。**
必要なら hooks を増やす。機械的に確認できる:

```sh
for f in damage kill stepPhysics fireArrow revive usePotion throwBomb explode stepBomb teleport raiseShield stepArrow; do
  st=$(grep -n "^function $f(" index.html | cut -d: -f1)
  en=$(awk -v s="$st" 'NR>s && /^}/ {print NR; exit}' index.html)
  n=$(awk -v s="$st" -v e="$en" 'NR>=s&&NR<=e' index.html | grep -c "effects\.push\|beep(\|sfx\|updateHud\|ach(\|MATCH\.")
  printf "%-14s %s\n" "$f" "$n"      # 全部 0 が正常
done
```

## メタ進行層

`==== メタ進行層 ====` の帯コメントで囲まれた 1 ブロック（保存・生涯戦績・実績・制覇表・
ハイスコア・連戦）。将来 `<script src>` に切り出すときは帯の間をコピーすれば済む。

- 保存は `localStorage` の単一キー `ohajiki.save`。
- 集計は配列でなく**疎な連想配列**。陣営やステージが増えても既存データが壊れず移行コードが要らない。
- `fillDefaults()` が欠損値だけを既定値で埋め、**知らないキーはそのまま残す**
  （新しい版が書いた値を消さない）。破損 JSON は黙って新規から始める。
- `saveOk=false` になった環境（プライベートモード等）では以後静かに諦める。

**オンライン化後もここはクライアント側に残す。** 実績・制覇・連戦は偽造しても被害が本人に
閉じるので、サーバーへ移す利益がない。サーバーが持つのはランキングと対戦レートだけ。

## 描画

- `drawPiece` が 1 つのコマを描く。当たり判定 `pieceHitBox` は
  **`drawPiece` と同じ式（`pt` `ry` `fh` など）から導いている**ので、片方を変えたらもう片方も直す。
- テクスチャ生成は約 1,800 行（8 種族の立ち姿 `makeFigure`、地面・壁・背景）。
  ここは 100% クライアント専用で、サーバーには一生行かない。
- `HEADLESS` を立てると音・トースト・ステージの絵の作り直しを止める。自動対戦で使う。

## 過去に踏んだ落とし穴

同じ形の間違いを繰り返さないための記録。

- **`HOLES = ST.holes` の参照コピー**（修正済み）。崩落と公転が `STAGES` の原本を破壊し、
  同じステージを 2 回遊ぶと穴が広がったまま始まった。ステージ表からは必ず `cloneHoles()` で複製する。
- **`stageT` / `pulseK` のリセット漏れ**（修正済み）。`radiusAt()` はステージの種類に関わらず
  `pulseK` を掛けるのに、書き換えるのは脈動ステージだけだった。「終焉の大渦」を遊ぶと
  次のステージの盤面半径が最大 ±7% ずれた。`resetPulse()` を `applyStageRules()` と
  `reset()` の両方から呼んでいる。
- **当たり判定を盤面座標で測っていた**（修正済み）。コマは厚み 22 の円盤の上に背丈 104 の
  人物が立っていて、見た目の重心は床よりずっと上。床へ逆投影して判定すると、
  人物を狙うほど外れる。判定は画面座標で行う。
- **`MATCH.myLost` を加護「反撃の狼煙」が読んでいた**（修正済み）。勝敗に効く処理が実績用の
  一時カウンタに依存していた。いまは `stats[0].lost` を読む。

### ブラウザで検証するときの注意

- **非表示タブでは `requestAnimationFrame` も CSS アニメーションも止まる。**
  実プレイのループを自動で検証しようとしても進まない。物理だけなら
  `__ohajiki.tick()` / `simUntilRest()` で rAF を介さずに進められる。
- 表示状態を CSS アニメーションに依存させない。`animation: … both` で `opacity:0` から
  始めると、非表示タブで読み込んだとき時刻 0 で固まって永久に見えない。
  入場の動きは `transform` だけに掛ける。
- 同じ URL への再読み込みは **bfcache が前回の DOM ごと復元する**ことがある。
  「消したはずの要素が残っている」ように見えたらクエリ文字列を変えて読み直す。

## 進行中の設計：オンライン化

段階を追って進めている。詳細な計画は別途あるが、要点は以下。

- **完了**: 回帰テストの土台（乱数のシード化・自動対戦ハーネス）／副作用の hooks 追い出し／
  可変グローバルのマッチ状態オブジェクト化
- **次**: ES モジュールへの分割と、Node で sim をヘッドレス実行すること。
  完了条件は「ファイルが分かれたこと」ではなく **`node test/selfplay.js` が DOM 無しで
  対戦を最後まで回すこと**。
- その先: Intent / Replay 形式の確定 → サーバー権威のオンライン対戦 → ランキング。

### 決めてあること

- **ロックステップ決定論は追わない。** `radiusAt` / `wallNormal` が使う
  `Math.cos/sin/atan2/hypot` は実装依存で、エンジン間・バージョン間で最下位ビットがずれる。
  ターン制で 1 手数秒なので、**サーバーが唯一の権威として回し、静止後の盤面を配る**設計にする。
  クライアントは演出のためローカルでも同じ手を流し、静止時にサーバーの盤面へスナップする。
- ランキングに載せる値は**サーバーが自分で計算したものに限る**。ソロスコアは
  Replay をサーバーが再生して得点を出し直す。`rollout()` がその原型。
- ビルドツールは入れない。ES モジュールはブラウザネイティブで、http 配信さえすれば足りる。

## 公開リポジトリとして扱う

**このリポジトリは公開されている。** コミットするものは全世界から読めるし、
一度 push したものは履歴に残るので、消しても取り消せないと考えること。

### 絶対にコミットしないもの

- **秘密情報** — API キー、トークン、パスワード、秘密鍵、証明書、接続文字列。
  サーバーを足すときは必ず環境変数から読む。ソースに直書きしない。
  `.env` などは `.gitignore` で塞いである。
- **個人情報** — 実名、メールアドレス、住所、端末名。
- **手元の環境が漏れるもの** — `/Users/名前/...` のような絶対パス、社内ホスト名、
  内部 IP、社内 URL。パスを書くときは必ずリポジトリからの相対パスにする。
- **OS やエディタのゴミ** — `.DS_Store`（macOS で Finder を開くだけで生える。
  公開リポジトリでいちばん多い事故）、`.vscode/`、`.idea/`、`*.swp`。
- **検証で仕込んだ一時コード** — 画面に重ねたデバッグ描画、`sessionStorage` への記録、
  `console.log` の置きっぱなし。作業が終わったら必ず消す。
- **第三者の著作物** — コピーしてきたコード、フォント、画像、音源。
  この作品が「外部リソースを 1 つも持たない」方針なのは、見た目の統一だけでなく
  ライセンスの問題を持ち込まないためでもある。

### コミット前のスキャン

```sh
# 秘密情報・個人情報・手元のパス
grep -rniE "api[_-]?key|secret|token|password|credential|bearer|private[_-]?key|BEGIN [A-Z ]*PRIVATE|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|xox[baprs]-" . --exclude-dir=.git
grep -rniE "/Users/|/home/|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|192\.168|10\.[0-9]+\." . --exclude-dir=.git

# 消し忘れたデバッグの残骸
grep -rniE "console\.(log|debug)|debugger|TODO|FIXME" . --exclude-dir=.git

# OS のゴミが紛れていないか
find . -name ".DS_Store" -o -name "._*"

# 何かを隠した長い base64 が無いか
grep -roE "[A-Za-z0-9+/]{200,}={0,2}" . --exclude-dir=.git
```

`127.0.0.1:8731` は開発サーバーの手順として README と AGENT.md に意図して書いてある。
これは検出されてよい。

### 知っておくこと

- `__ohajiki` は**セーブを書き換えられる操作を公開している**（`wipe` `unlockAll`
  `fillMatrix` `give` `warp`）。手元だけで完結する単独プレイの記録なので、
  改変できても被害は本人に閉じる。ただし**オンラインのランキングは、この値を
  絶対に信用してはいけない**。サーバーが自分で計算した値だけを載せる（上の設計参照）。
- ライセンスファイルは今のところ無い。**明示しない限り既定は「著作権者が全権利を保有」**
  になり、読む人は再利用も改変もできない。それでよいかは所有者が決めること。

## コードの書きかた

- コメントは日本語。**何をしているかではなく、なぜそうしているかを書く。**
  特に「素直に書くとこうなるが、それだとこう壊れる」を残す。
- 既存のセクション帯コメント（`// ---- 名前 ----`）の粒度に合わせる。
- 定数は先頭の「チューニング値」に集める。マジックナンバーを散らさない。
- UI の選択の強調色は既定の `#cfe6c0`。色に意味を持たせるのは、CPU の強さ（難易度の
  グラデーション）と連戦（金）だけ。**盤面では色はプレイヤーを表し、陣営は紋章で見分ける**
  決まりなので、陣営に色を結び付けない。
