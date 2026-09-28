// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// THE WHOLE APP: a WebView over the bundled Storage Remote build, and the
// three things a page cannot do for itself, offered as capabilities it looks
// for (never "am I native?"):
//
//   - keep its keys in the Keychain / Android Keystore (`__ossKeyVault`, the
//     framework's seam) instead of the WebView's IndexedDB;
//   - scan a QR code with the camera (pairing, invites);
//   - hand a decrypted file to the system share sheet.
//
// Like time's wrapper, it serves the app FROM INSIDE THE DOWNLOAD over a
// loopback server, keeps the native chrome in step with the page's theme and
// sends links out of the app to the system browser. Everything a user sees
// is the web app, unchanged. See README.md.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from "react-native-webview";

import { BRIDGE_SCRIPT, resolveScript } from "./src/bridge";
import {
  FALLBACK_BACKGROUND,
  FALLBACK_FOREGROUND,
  REMOTE_URL,
} from "./src/config";
import {
  AFTER_LOAD_SCRIPT,
  isThemeReport,
  statusBarStyleFor,
} from "./src/injected";
import { vaultClear, vaultDelete, vaultGet, vaultPut } from "./src/keychain";
import { startLocalServer, type LocalServer } from "./src/local-server";
import { Scanner } from "./src/Scanner";
import { shareFile } from "./src/share";
import { type BridgeRequest, isBridgeRequest } from "./src/wire";

void SplashScreen.preventAutoHideAsync().catch(() => {});

const SPLASH_TIMEOUT_MS = 10_000;

// iOS runs edge to edge (the page pads itself with env(safe-area-inset-*));
// Android frames the page inside the system bars.
const FRAME_EDGES =
  Platform.OS === "ios" ? ([] as const) : (["top", "bottom"] as const);

type ServerState =
  | { status: "starting" }
  | { status: "ready"; origin: string }
  | { status: "failed"; error: Error };

export default function App() {
  const [server, setServer] = useState<ServerState>(
    REMOTE_URL
      ? { status: "ready", origin: REMOTE_URL }
      : { status: "starting" },
  );
  const [pageBackground, setPageBackground] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const background = pageBackground ?? FALLBACK_BACKGROUND;
  const webViewRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const serverRef = useRef<LocalServer | null>(null);

  const start = useCallback(async () => {
    if (REMOTE_URL) return;
    setServer({ status: "starting" });
    try {
      const running = await startLocalServer();
      serverRef.current = running;
      setServer({ status: "ready", origin: running.origin });
    } catch (error) {
      setServer({
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, []);

  useEffect(() => {
    void start();
    return () => {
      void serverRef.current?.stop();
    };
  }, [start]);

  const splashHidden = useRef(false);
  const hideSplash = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
  useEffect(() => {
    const timer = setTimeout(hideSplash, SPLASH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hideSplash]);
  useEffect(() => {
    if (server.status === "failed") hideSplash();
  }, [server.status, hideSplash]);

  const origin = server.status === "ready" ? server.origin : null;

  const answer = useCallback((id: string, run: () => Promise<unknown>) => {
    void run().then(
      (value) =>
        webViewRef.current?.injectJavaScript(
          resolveScript(id, { ok: true, value: value ?? null }),
        ),
      (err: unknown) =>
        webViewRef.current?.injectJavaScript(
          resolveScript(id, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
    );
  }, []);

  const handle = useCallback(
    (req: BridgeRequest) => {
      const [a, b] = req.args;
      switch (req.op) {
        case "vault.get":
          return answer(req.id, () => vaultGet(a));
        case "vault.put":
          return answer(req.id, () => vaultPut(a, b));
        case "vault.delete":
          return answer(req.id, () => vaultDelete(a));
        case "vault.clear":
          return answer(req.id, () => vaultClear(a));
        case "share":
          return answer(req.id, () => shareFile(a));
        case "scan":
          // One scanner at a time; a second request gets "cancelled".
          if (scanning) return answer(req.id, async () => null);
          setScanning(req.id);
          return;
      }
    },
    [answer, scanning],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      // Only the bundled app may use the keystore: a message from any other
      // page (which should never load here anyway) is ignored.
      if (!origin || !event.nativeEvent.url.startsWith(origin)) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.nativeEvent.data) as unknown;
      } catch {
        return;
      }
      if (isBridgeRequest(parsed)) return handle(parsed);
      if (!isThemeReport(parsed)) return;
      const reported = parsed.theme.background;
      if (typeof reported === "string" && reported.trim() !== "")
        setPageBackground(reported.trim());
    },
    [origin, handle],
  );

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      webViewRef.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation) => {
      if (!origin) return false;
      if (request.url.startsWith(origin)) return true;
      if (request.url.startsWith("about:")) return true;
      void Linking.openURL(request.url);
      return false;
    },
    [origin],
  );

  if (server.status === "failed") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.center}>
          <StatusBar style={statusBarStyleFor(FALLBACK_BACKGROUND)} />
          <Text style={styles.errorTitle}>Could not start Storage Remote</Text>
          <Text style={styles.errorBody}>{server.error.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void start()}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.retryButtonPressed,
            ]}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.fill, { backgroundColor: background }]}
        edges={FRAME_EDGES}
      >
        <StatusBar style={statusBarStyleFor(pageBackground)} />
        {origin ? (
          <WebView
            ref={webViewRef}
            source={{ uri: origin }}
            style={[styles.fill, { backgroundColor: background }]}
            javaScriptEnabled
            domStorageEnabled
            incognito={false}
            allowsBackForwardNavigationGestures
            setSupportMultipleWindows={false}
            // The bridge must exist before the page's first script runs: the
            // framework client picks its key vault once, at start.
            injectedJavaScriptBeforeContentLoaded={BRIDGE_SCRIPT}
            injectedJavaScript={AFTER_LOAD_SCRIPT}
            onMessage={onMessage}
            onLoadEnd={hideSplash}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            onNavigationStateChange={(nav) => {
              canGoBack.current = nav.canGoBack;
            }}
            bounces={false}
            overScrollMode="never"
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        )}
        {scanning ? (
          <Scanner
            onResult={(text) => {
              const id = scanning;
              setScanning(null);
              answer(id, async () => text);
            }}
          />
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: FALLBACK_BACKGROUND },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: FALLBACK_BACKGROUND,
    padding: 24,
  },
  errorTitle: {
    color: FALLBACK_FOREGROUND,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  errorBody: { color: "#5b6477", fontSize: 14, textAlign: "center" },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#e6eaef",
  },
  retryButtonPressed: { backgroundColor: "#d3dae1" },
  retryLabel: { color: FALLBACK_FOREGROUND, fontSize: 15, fontWeight: "600" },
});
