'use strict';
// ホーム画面に追加したときにオフラインで起動するための Service Worker。
// やることはキャッシュだけで、通信も収集も一切しない。
//
// 方針:
//   - ページ本体（index.html）は **ネットワーク優先**。ゲームは 1 枚の HTML に
//     すべて入っていて更新が頻繁なので、キャッシュ優先にすると古い版に貼り付く。
//     オフラインのときだけ、最後に取れた版へ落ちる。
//   - アイコンや manifest は **キャッシュ優先**。ほぼ変わらないし、毎回取りに
//     行く意味がない。
//
// パスはすべて相対。GitHub Pages はサブパス（/ohajiki-battle/）で配信されるので、
// '/index.html' のような絶対パスにすると別サイトを指してしまう。

// 中身を変えたらここを上げる。古いキャッシュは activate で捨てる。
const CACHE = 'ohajiki-v1';

// オフライン起動に必要な最小限。ゲーム本体は index.html 1 枚に閉じている
// （外部の JS/CSS/画像/音源を持たない方針）ので、並べるのはこれだけで足りる。
const SHELL = './index.html';
const ASSETS = [
  SHELL,
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1 つでも失敗すると addAll ごと落ちるので、取れたものだけ入れる
    await Promise.all(ASSETS.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // GET 以外と他オリジンは素通し（このゲームはどちらも発生しないが、念のため）
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // ページの読み込み: ネットワーク優先。取れたら SHELL として上書き保存する。
  // リクエスト URL（'/ohajiki-battle/' など）ではなく SHELL の鍵で入れるのは、
  // 同じ HTML を 2 重に持たないため。
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(SHELL, copy)));
        }
        return res;
      } catch (err) {
        const hit = await caches.match(SHELL);
        if (hit) return hit;
        throw err; // キャッシュも無い初回オフライン。ブラウザの既定表示に任せる
      }
    })());
    return;
  }

  // それ以外（アイコン・manifest）: キャッシュ優先
  e.respondWith((async () => (await caches.match(req)) || fetch(req))());
});
