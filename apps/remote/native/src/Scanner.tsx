// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The QR scanner the page asks for (a pairing code on the server's screen,
// or an invite to a shared folder): a full-screen camera that answers with
// the first QR code it reads, or null when the user cancels. No frame is
// kept or sent; only the decoded text goes back to the page.

import { useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";

export function Scanner({ onResult }: { onResult(text: string | null): void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain)
      void requestPermission();
  }, [permission, requestPermission]);

  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onResult(text);
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => finish(null)}
    >
      <View style={styles.fill}>
        {permission?.granted ? (
          <CameraView
            style={styles.fill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => finish(data)}
          />
        ) : (
          <View style={styles.center}>
            <Text style={styles.message}>
              {permission && !permission.canAskAgain
                ? "Camera access is off for this app. Allow it in Settings, or paste the code instead."
                : "Waiting for camera access…"}
            </Text>
          </View>
        )}
        <SafeAreaView edges={["bottom"]} style={styles.bar}>
          <Text style={styles.hint}>Point the camera at the QR code</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => finish(null)}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  message: { color: "#fff", fontSize: 16, textAlign: "center" },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  hint: { color: "#fff", fontSize: 15, marginBottom: 12 },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  pressed: { opacity: 0.8 },
  buttonLabel: { color: "#141a26", fontSize: 16, fontWeight: "600" },
});
