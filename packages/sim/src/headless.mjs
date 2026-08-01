// おはじきバトルの sim を「DOM の無い Node」で動かすためのヘッドレス host。
//
// 設計の意図（重要）:
//   ゲーム本体（リポジトリ直下 index.html）は 1 ファイルに sim も client も入っている。
//   sim を物理的に別ファイルへ切り出すと、reset()/release()/nextTurn() に散っている
//   演出・実績の副作用まで剥がす必要があり、自動対戦の指紋では検出できない部分
//   （加護・連戦・実績）に回帰リスクが出る。そこで **ゲームは 1 つの真実として無改造のまま** に保ち、
//   ここでは最小限の DOM/Canvas/Web Audio スタブを与えて index.html の <script> を Node で評価する。
//   これで「Node が DOM 無しで対戦を最後まで回す」（AGENT.md の次の完了条件）を、
//   コードの二重管理も、動いているゲームの改変も無しに満たす。
//
// スタブの方針:
//   - 描画・音・レイアウトの呼び出しは副作用の無い no-op（値を読む所だけ妥当な数を返す）。
//   - ルールに効くのは Math と M.rng だけなので、スタブは盤面計算に一切関与しない。
//   - selfplay は HEADLESS=true を立て、演出/音/トーストを内部で止める。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(__dirname, '../../../index.html');

// 何でも受け止める連鎖スタブ。関数呼び出しにも、プロパティ read/write にも耐える。
// get: 未設定のプロパティは「呼ぶと自分を返す関数」を返す（メソッド連鎖が壊れない）。
// set: 素直に覚える（el.style.display = 'none' などの代入を通す）。
function makeStub(seed = {}) {
  const store = { ...seed };
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;      // 数値化されても NaN にしない
      if (prop === Symbol.iterator) return undefined;
      if (prop in store) return store[prop];
      // gradient/pattern など戻り値を使い回す呼び出しにも耐えるよう、子スタブを返す
      const child = makeStub();
      store[prop] = child;
      return child;
    },
    set(_t, prop, val) { store[prop] = val; return true; },
    has() { return true; },
    apply() { return proxy; },
  });
  return proxy;
}

// Canvas 2D コンテキスト。gradient/pattern だけは addColorStop を持つスタブを返す。
function makeCtx() {
  const ctx = makeStub({
    createLinearGradient: () => makeStub(),
    createRadialGradient: () => makeStub(),
    createPattern: () => makeStub(),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    measureText: () => ({ width: 0 }),
  });
  return ctx;
}

function makeCanvas(w = 960, h = 720) {
  return makeStub({
    width: w, height: h, clientWidth: w, clientHeight: h,
    style: makeStub(), classList: makeStub(),
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    addEventListener: () => {}, removeEventListener: () => {},
    setPointerCapture: () => {}, releasePointerCapture: () => {},
    appendChild: () => {}, remove: () => {},
    toDataURL: () => '',
  });
}

export function loadGame() {
  const html = readFileSync(INDEX_HTML, 'utf8');
  // <script> 本体を取り出す（AGENT.md の構文チェックと同じ切り出し）
  const m = html.match(/<script>\s*\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('index.html の <script> 本体が見つからない');
  const code = m[1];

  // ---- 最小 DOM/Web API スタブ ----
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      // 'cv' は寸法と 2D コンテキストが要るので実寸のキャンバス相当にする
      elements.set(id, id === 'cv' ? makeCanvas() : makeStub({
        style: makeStub(), classList: makeStub(),
        addEventListener: () => {}, removeEventListener: () => {},
        appendChild: () => {}, removeChild: () => {}, remove: () => {},
        showModal: () => {}, close: () => {}, open: false,
        querySelector: () => makeStub(), querySelectorAll: () => [],
      }));
    }
    return elements.get(id);
  };

  const documentStub = makeStub({
    getElementById: (id) => getEl(id),
    createElement: (tag) => (tag === 'canvas' ? makeCanvas(1, 1) : makeStub({
      style: makeStub(), classList: makeStub(), dataset: {},
      addEventListener: () => {}, appendChild: () => {}, removeChild: () => {}, remove: () => {},
      querySelector: () => makeStub(), querySelectorAll: () => [],
    })),
    createElementNS: () => makeStub(),
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => makeStub(), querySelectorAll: () => [],
    dispatchEvent: () => true,
    hidden: false, visibilityState: 'visible',
    body: makeStub(), documentElement: makeStub(),
    head: makeStub(),
  });

  const windowStub = makeStub({
    devicePixelRatio: 1,
    addEventListener: () => {}, removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    requestAnimationFrame: () => 0,     // ループを回さない（1 回で止める）
    cancelAnimationFrame: () => {},
    AudioContext: function () { return makeStub(); },
    webkitAudioContext: function () { return makeStub(); },
    localStorage,
    performance: { now: () => 0 },
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
  });

  const sandbox = {
    window: windowStub,
    document: documentStub,
    localStorage,
    navigator: { userAgent: 'node', language: 'ja' },
    devicePixelRatio: 1,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    AudioContext: function () { return makeStub(); },
    webkitAudioContext: function () { return makeStub(); },
    performance: { now: () => 0 },
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    // 素の（window 省略の）グローバル呼び出し
    addEventListener: () => {}, removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    getComputedStyle: () => makeStub(),
    console,
    Math, JSON, Date, Object, Array, Number, String, Boolean,
    isFinite, isNaN, parseInt, parseFloat, Uint8ClampedArray, Float64Array,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'ohajiki-game.js' });

  const api = windowStub.__ohajiki;
  if (!api || typeof api.selfplaySuite !== 'function') {
    throw new Error('__ohajiki.selfplaySuite が公開されていない（スタブ不足の可能性）');
  }
  return api;
}
