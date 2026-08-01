import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { setAudioModeAsync } from 'expo-audio';

// ゲーム本体は「外部リソース 0 の自己完結 HTML」。scripts/inline.mjs が
// index.html から生成した assets/game.html を同梱し、オフラインで読み込む。
const GAME_HTML = require('./assets/game.html');

// WebView 内の localStorage（記録 'ohajiki.save'）はオリジン単位で保存される。
// 端末をまたいでも起動のたびに同じオリジンになるよう、安定した baseUrl を与える。
// （website 版とは WebView のストレージが別なので、この値は一致させる必要はない）
const BASE_URL = 'https://ohajiki.local/';

// 盤面の暗い背景に合わせる（ロード中やセーフエリア外の色）
const BG = '#0c120e';

export default function App() {
  const [html, setHtml] = useState(null);
  const webRef = useRef(null);

  // 起動時: iOS の消音スイッチでも音が鳴るよう AVAudioSession を playback にし、
  // 同梱 HTML を読み込む
  useEffect(() => {
    (async () => {
      try {
        // WKWebView の音声はアプリ共有の AudioSession に従う。ここを playback に
        // しておくと、マナーモードでも BGM/効果音（Web Audio）が鳴る。
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          interruptionMode: 'duckOthers',
          allowsRecording: false,
        });
      } catch (e) {
        // 音の設定に失敗しても、ゲーム自体は続行する
      }
      const asset = Asset.fromModule(GAME_HTML);
      await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;
      const text = await new File(uri).text();
      setHtml(text);
    })();
  }, []);

  // Android のハード戻る: 単一画面 SPA なので既定の「即終了」を避け、確認を挟む
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBack = () => {
      Alert.alert('おはじきバトル', 'アプリを終了しますか？', [
        { text: 'つづける', style: 'cancel' },
        { text: '終了', style: 'destructive', onPress: () => BackHandler.exitApp() },
      ]);
      return true; // 既定の終了を止める
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, []);

  // バックグラウンドへ移るとき、WebView 内の保存フックを確実に叩く。
  // （ゲームは visibilitychange / pagehide で saveNow する。WebView でも
  //   保険として明示的に発火させ、記録の取りこぼしを防ぐ）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if ((state === 'background' || state === 'inactive') && webRef.current) {
        webRef.current.injectJavaScript(
          "document.dispatchEvent(new Event('visibilitychange')); true;"
        );
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" backgroundColor={BG} />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
          {html ? (
            <WebView
              ref={webRef}
              style={styles.web}
              originWhitelist={['*']}
              source={{ html, baseUrl: BASE_URL }}
              // 描画・入力
              javaScriptEnabled
              domStorageEnabled                // Android: localStorage を有効化
              allowFileAccess
              overScrollMode="never"
              bounces={false}
              scrollEnabled={false}            // ページのスクロールは無効（盤面は自前でズーム/パン）
              // 音声: ユーザー操作なしでも Web Audio を許可（primeAudio が初回タップで unlock）
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback
              // パフォーマンス
              androidLayerType="hardware"
              setBuiltInZoomControls={false}
              // 予期せぬ外部遷移は開かせない（自己完結アプリ）
              onShouldStartLoadWithRequest={(req) =>
                req.url.startsWith(BASE_URL) || req.url === 'about:blank'
              }
            />
          ) : (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#cfe6c0" />
            </View>
          )}
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
});
