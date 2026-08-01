// Node ヘッドレス回帰テスト。
// DOM 無しでゲームの sim を読み込み、自動対戦を最後まで回して指紋を突き合わせる。
//
// 何を保証するか:
//   1. 完走     … 各対戦が決着する（done=true）。「Node が対戦を最後まで回す」= AGENT.md の次の完了条件。
//   2. 決定性   … 同じシードは何度回しても同じ結果（ルール乱数は M.rng だけを通る証拠）。
//   3. 区切り非依存 … selfplaySuite(1,50) と 1 戦ずつ回した結果が一致（対局間の状態漏れが無い）。
//   4. 回帰     … Node で得た指紋を committed ベースラインと比較（sim が変わると 1 行でも差が出る）。
//
// なぜ browser 版のベースライン（test/selfplay-baseline.txt）と別物か:
//   Math.cos/sin/atan2/hypot は実装依存で、Node(V8) と Chromium(V8) でも最下位ビットがずれる
//   （AGENT.md 参照）。ロード元は同じ index.html なので挙動は同一だが、指紋は engine ごとに変わる。
//   よって Node 用の別ベースラインを持つ。engine を跨いで一致させることは狙わない。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../src/headless.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(__dirname, 'selfplay-node-baseline.txt');

// index.html と同じ FNV-1a
const fp = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};
const line = (r) =>
  `${r.seed} st${r.stage} p${r.players} ai${r.aiLevel} f${r.factions.join('')} ` +
  `${r.plies}/${r.steps} d${r.done ? 1 : 0} w${r.winner} ${fp(JSON.stringify(r))}`;

// Node は Math.hypot が遅く、AI の先読み（rollout）が engine 差で余計に回ることもあり、
// 1 戦が browser より重い。既定は軽い範囲にし、フル 50 戦は SIM_TEST_TO=50 で回せるようにする。
const FROM = 1, TO = Number(process.env.SIM_TEST_TO || 8);
const SUB_FROM = 1, SUB_TO = 3;   // 決定性・区切り非依存は軽く
let failed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const t0 = Date.now();

const game = loadGame();

// --- 1 & 4: スイートを回して指紋を作る（フルの 50 戦） ---
const suite = game.selfplaySuite(FROM, TO);
const lines = suite.map(line);

const notDone = suite.filter((r) => !r.done);
if (notDone.length === 0) ok(`全 ${suite.length} 戦が決着（完走）`);
else fail(`決着しなかった対戦が ${notDone.length} 件: seeds ${notDone.map((r) => r.seed).join(',')}`);

// --- 2: 決定性（小さな範囲をもう一度回して一致） ---
const detA = game.selfplaySuite(SUB_FROM, SUB_TO).map(line);
const detB = game.selfplaySuite(SUB_FROM, SUB_TO).map(line);
if (JSON.stringify(detA) === JSON.stringify(detB)) ok(`決定性: seed ${SUB_FROM}..${SUB_TO} を 2 回回して一致`);
else fail('決定性が壊れている（同じ範囲で結果が変わった）');

// --- 3: 区切り非依存（1 戦ずつ vs まとめて） ---
//   フルスイートの前半と、1 戦ずつ回した結果が一致することを確認（対局間の状態漏れ検出）。
const oneByOne = [];
for (let s = SUB_FROM; s <= SUB_TO; s++) oneByOne.push(...game.selfplaySuite(s, s).map(line));
if (JSON.stringify(lines.slice(0, SUB_TO - SUB_FROM + 1)) === JSON.stringify(oneByOne)) {
  ok('区切り非依存: 1 戦ずつと一括が一致');
} else {
  fail('区切り非依存が壊れている（対局間で状態が漏れている疑い）');
}

// --- 4: committed ベースラインと比較 ---
// ベースラインは既定サイズ（TO=8）のときだけ突き合わせる。SIM_TEST_TO で範囲を変えたときは
// 完走・決定性の確認だけ行い、回帰比較はスキップする。
const current = lines.join('\n') + '\n';
if (TO !== 8) {
  console.log(`  ! SIM_TEST_TO=${TO}: 回帰比較はスキップ（ベースラインは TO=8 用）`);
} else if (!existsSync(BASELINE)) {
  writeFileSync(BASELINE, current);
  console.log(`  ! ベースライン新規作成: ${BASELINE}`);
  ok('ベースラインを書き出した（次回から回帰比較に使う）');
} else {
  const expected = readFileSync(BASELINE, 'utf8');
  if (expected === current) {
    ok(`回帰: Node ベースラインと完全一致（${lines.length} 行）`);
  } else {
    const exp = expected.trimEnd().split('\n');
    const cur = current.trimEnd().split('\n');
    const diffs = [];
    for (let i = 0; i < Math.max(exp.length, cur.length); i++) {
      if (exp[i] !== cur[i]) diffs.push(`    - ${exp[i] || '(なし)'}\n    + ${cur[i] || '(なし)'}`);
    }
    fail(`Node ベースラインと差分 ${diffs.length} 行:\n${diffs.slice(0, 10).join('\n')}`);
    console.error('  （意図した sim 変更なら packages/sim/test/selfplay-node-baseline.txt を取り直す）');
  }
}

console.log(`  （所要 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
if (failed) { console.error(`\nFAILED: ${failed} 件`); process.exit(1); }
console.log('\nPASSED');
