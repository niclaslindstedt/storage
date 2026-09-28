// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The Expo config, as a function so the version comes from the storage
// monorepo's package.json: the wrapper ships one build of Storage Remote,
// and the two never disagree about which one.

const { version } = require("../../../package.json");

const { DISPLAY_NAME, BUNDLE_ID, EAS_PROJECT_ID } = require("./identifiers.js");

// The console's light background (--bg in the console stylesheet); only
// paints the splash and the chrome before the page reports its own.
const BRAND_BG = "#f5f6f9";

module.exports = () => ({
  expo: {
    name: DISPLAY_NAME,
    slug: "storage-remote",
    version,
    orientation: "default",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    icon: "./assets/icon.png",
    scheme: BUNDLE_ID,
    backgroundColor: BRAND_BG,
    assetBundlePatterns: ["**/*"],

    ios: {
      supportsTablet: true,
      bundleIdentifier: BUNDLE_ID,
      infoPlist: {
        // The camera reads pairing and invite QR codes, nothing else; no
        // frame is stored or sent.
        NSCameraUsageDescription:
          "Scan the pairing code your server shows, or an invite to a shared folder.",
        // The bundled app is served over plain HTTP on the loopback interface;
        // ATS stays ON for everything else, so the storage server itself must
        // be reached over HTTPS with a publicly trusted certificate.
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: true,
          NSExceptionDomains: {
            localhost: {
              NSExceptionAllowsInsecureHTTPLoads: true,
              NSIncludesSubdomains: false,
            },
          },
        },
        // The app uses only the platform's own cryptography (WebCrypto,
        // Keychain) — exempt; see README.md before submitting.
        ITSAppUsesNonExemptEncryption: false,
      },
    },

    android: {
      package: BUNDLE_ID,
      // The camera (QR codes) and nothing else. No storage permission: files
      // leave through the share sheet, and uploads come in through the
      // system picker, which needs none.
      permissions: ["android.permission.CAMERA"],
      // Modules add these by default; this app never needs them.
      blockedPermissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#2743e6",
      },
    },

    plugins: [
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          imageWidth: 160,
          resizeMode: "contain",
          backgroundColor: BRAND_BG,
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "Scan the pairing code your server shows, or an invite to a shared folder.",
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
      "expo-secure-store",
      // The bundled static server needs Android minSdk 28, and the loopback
      // origin is plain HTTP so cleartext has to be permitted.
      [
        "expo-build-properties",
        { android: { minSdkVersion: 28, usesCleartextTraffic: true } },
      ],
    ],

    extra: {
      // NO remote URL: the app serves the Storage Remote build bundled inside
      // it (assets/webroot.zip). EXPO_PUBLIC_REMOTE_URL points a debug build
      // at a dev server instead (src/config.ts).
      ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    },
  },
});
