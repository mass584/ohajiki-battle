# @ohajiki/sim — sim を DOM 無しで回すヘッドレス host

物理・AI・ルール（sim）を **DOM/Canvas/Web Audio の無い Node** で実行するためのパッケージ。
`node packages/sim/test/selfplay.js` で自動対戦を最後まで回し、指紋で回帰を検出する。
これは AGENT.md ロードマップの「次」の完了条件（**Node が DOM 無しで対戦を最後まで回す**）を満たす。

## 設計判断（重要）— なぜ sim を別ファイルへ「切り出さない」か

当初計画は「sim を `packages/sim/src` へ物理的に切り出し、web はそれを import する」だった。
しかし実装前調査で、**sim と client の絡みが想定より深い**ことが分かった:

- `reset()` / `release()` / `nextTurn()` などルールの中核関数に、演出（`effects`/`sfx`）・実績
  （`MATCH` カウンタ）・連戦（`RUN`/`BLESS`）の副作用が点在している。
- これらを剥がす大手術は、**自動対戦の指紋では検出できない領域**（加護・連戦・実績は selfplay 中は
  中立化される）に回帰リスクを持ち込む。動いている公開ゲームを壊しかねない。

そこで方針を変えた:

> **ゲーム本体（リポジトリ直下 `index.html`）を「1 つの真実」として無改造のまま保ち、
> ここでは最小の DOM/Canvas スタブを与えて、その sim を Node で評価する。**

利点:
- **二重管理ゼロ**（sim のソースは index.html だけ。コピーを持たない = ユーザー要件どおり）。
- **公開ゲームへの回帰リスクゼロ**（ゲームを一切書き換えない）。
- それでも **Node ヘッドレスでの自動対戦・回帰テスト**が回る。

将来サーバー権威のオンライン化へ進むときは、この host を土台に段階的な ES モジュール分割を
進められる（`rollout()` が権威計算の原型。AGENT.md 参照）。

## 使い方

```sh
# リポジトリ直下から
node packages/sim/test/selfplay.js
# または
pnpm test:sim
```

```js
import { loadGame } from '@ohajiki/sim';
const game = loadGame();                       // DOM 無しでゲームの sim を読み込む
const r = game.selfplay({ seed: 1, stage: 5, players: 4, aiLevel: 1, factions: [6,1,5,0] });
console.log(r.done, r.winner, r.plies);
const suite = game.selfplaySuite(1, 50);       // 回帰用のまとめ実行
```

`loadGame()` が返すのは index.html の `window.__ohajiki`（`selfplay`/`selfplaySuite`/`digest`/
`createMatch`/`useMatch`/`applyPlan`/`simUntilRest`/`setSeed` など）。

## テストが保証すること

1. **完走** … 各対戦が決着する（`done=true`）。
2. **決定性** … 同じシードは何度でも同じ結果（ルール乱数が `M.rng` だけを通る証拠）。
3. **区切り非依存** … 1 戦ずつと一括が一致（対局間の状態漏れが無い）。
4. **回帰** … Node で得た指紋を `test/selfplay-node-baseline.txt` と比較。1 行でも変われば sim が変わっている。

### browser 版ベースライン（`/test/selfplay-baseline.txt`）との違い

`Math.cos/sin/atan2/hypot` は実装依存で、Node(V8) と Chromium(V8) でも最下位ビットがずれる
（AGENT.md「ロックステップ決定論は追わない」）。**ロード元は同じ index.html なので挙動は同一**だが、
指紋は engine ごとに変わるため、Node 用に別ベースラインを持つ。engine を跨いだ一致は狙わない。

意図して sim を変えたら、`test/selfplay-node-baseline.txt` を取り直す:

```sh
rm packages/sim/test/selfplay-node-baseline.txt && node packages/sim/test/selfplay.js
```
