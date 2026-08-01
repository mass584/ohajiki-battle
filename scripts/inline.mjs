#!/usr/bin/env node
// index.html を「外部リソース 0 の自己完結 1 枚 HTML」に畳んで
// apps/mobile/assets/game.html へ出力する。WebView は file:// 越しに
// ES モジュールを読めない（CORS）ので、ネイティブに同梱する版はここで 1 枚にする。
//
// 重いバンドラは入れない方針（AGENT.md）。やることは単純:
//   - <script type="module" src="./xxx.js"> を、その中身に置き換える
//   - <link rel="stylesheet" href="..."> があれば <style> に取り込む
// いまは index.html が既に自己完結（外部 src 無し）なので、実質コピーになる。
// web を sim パッケージへ分割した後も、この 1 本で同梱版を作れるようにしてある。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'index.html');
const OUT = join(ROOT, 'apps', 'mobile', 'assets', 'game.html');

let html = readFileSync(SRC, 'utf8');

// <script type="module" src="./path"> をファイル内容で置き換える（相対 src のみ）
const moduleTag = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'](\.[^"']+)["'][^>]*><\/script>/g;
html = html.replace(moduleTag, (whole, src) => {
  const p = resolve(dirname(SRC), src);
  if (!existsSync(p)) {
    console.warn(`[inline] 見つからないモジュールを素通し: ${src}`);
    return whole;
  }
  const code = readFileSync(p, 'utf8');
  // 依存を辿る簡易版：さらに import 'xxx' があってもここでは展開しない。
  // web を分割するときは 1 段のバレル（sim/index.js）に集約して 1 回で取り込めるようにする。
  return `<script type="module">\n${code}\n</script>`;
});

// 外部 CSS（現状は無し。将来のために対応だけ入れておく）
const linkTag = /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["'](\.[^"']+)["'][^>]*>/g;
html = html.replace(linkTag, (whole, href) => {
  const p = resolve(dirname(SRC), href);
  if (!existsSync(p)) return whole;
  return `<style>\n${readFileSync(p, 'utf8')}\n</style>`;
});

// 念のため：外部 http(s) 参照が残っていないか警告（自己完結の担保）
const external = [...html.matchAll(/\b(?:src|href)=["'](https?:\/\/[^"']+)["']/g)].map(m => m[1]);
if (external.length) {
  console.warn(`[inline] 外部参照が残っています（${external.length} 件）。同梱版はオフラインで動かない可能性:`);
  external.slice(0, 8).forEach(u => console.warn(`   - ${u}`));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`[inline] 出力: apps/mobile/assets/game.html (${(html.length / 1024).toFixed(0)} KB)`);
