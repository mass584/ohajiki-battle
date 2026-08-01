# @ohajiki/mobile — おはじきバトル ネイティブアプリ（Expo + WebView）

既存の Web ゲーム（リポジトリ直下の `index.html`）を **WebView で包んだ iOS / Android アプリ**です。
ゲーム本体は無改造で、外部リソースを 1 つも持たない自己完結 HTML をアプリ内に同梱してオフライン動作します。

## しくみ

- `scripts/inline.mjs` が `index.html` を「自己完結 1 枚 HTML」に畳んで
  `apps/mobile/assets/game.html` を生成する（`postinstall` / `prestart` で自動実行）。
  WebView は `file://` 越しに ES モジュールを読めない（CORS）ため、同梱版は 1 枚にまとめる。
- `App.js` がその HTML を読み込み、安定した `baseUrl`（`https://ohajiki.local/`）で WebView に渡す。
  記録は WebView 内の `localStorage`（キー `ohajiki.save`）にオリジン単位で永続化される。
- iOS の消音スイッチ対策として、起動時に `Audio.setAudioModeAsync({ playsInSilentModeIOS: true })` で
  アプリ共有の AVAudioSession を playback にし、マナーモードでも Web Audio（BGM/効果音）が鳴るようにする。
- Android のハード戻るボタンは、単一画面のため「アプリ終了の確認」を挟む。
- バックグラウンド移行時に `visibilitychange` を WebView へ発火させ、記録の取りこぼしを防ぐ。

## 開発手順

前提: Node 18+、`pnpm i`（リポジトリ直下）で依存を入れる。iOS は macOS + Xcode、Android は Android Studio。

```sh
cd apps/mobile
pnpm start           # prestart で game.html を再生成し、Expo Dev Client を起動
pnpm ios             # iOS シミュレータ/実機（要 dev client ビルド）
pnpm android         # Android エミュレータ/実機
```

react-native-webview 等のネイティブモジュールを使うため、**Expo Go では動きません**。
初回は `pnpm ios` / `pnpm android`（= `expo run:*`）で Dev Client をビルドしてください。

## ストア向けビルド（EAS）

```sh
npm i -g eas-cli
eas login
eas build -p ios --profile production
eas build -p android --profile production
eas submit -p ios     # / android
```

> EAS 上で `assets/game.html` を確実に用意するため、`postinstall` で `scripts/inline.mjs` を実行しています。
> pnpm の設定で postinstall がスキップされる環境では、`eas.json` の各プロファイルに
> `"prebuildCommand"` かビルドフックで `node ../../scripts/inline.mjs` を明示してください。

## まだ用意していないもの（本番前に差し替え）

- **アイコン / スプラッシュ画像**: 現在は Expo 既定。`assets/` に `icon.png`・`adaptive-icon.png`・
  `splash.png` を置き、`app.json` で参照する。
- **バンドル ID / package 名**: `app.json` の `io.github.mass584.ohajikibattle` は仮。所有ドメインに合わせて変更。

## 既知のトレードオフ

- 描画は WebView（Canvas 2D）のまま。低スペック端末では Skia ネイティブ描画に劣るが、
  重いテクスチャは起動/ステージ切替時の一括生成で、毎フレーム負荷は中程度。
- 将来ネイティブ描画へ移る場合は、共有 sim（`packages/sim`）を土台に `@shopify/react-native-skia` +
  `react-native-audio-api` へ段階移行できる（ゲームロジックは書き直し不要）。
