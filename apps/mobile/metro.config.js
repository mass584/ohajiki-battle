// Metro 設定。ゲーム本体（自己完結 HTML）をアセットとして同梱するため、
// .html を assetExts に足す。これで require('./assets/game.html') が
// バンドルに含まれ、オフラインで WebView に読み込める。
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

// モノレポのルートも watch させ、scripts/inline.mjs が更新する assets を拾えるように
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.assetExts = [...config.resolver.assetExts, 'html'];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
