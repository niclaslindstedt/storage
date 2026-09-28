// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// THE SCRIPT THE WRAPPER INJECTS BEFORE THE PAGE LOADS: it installs the
// three capabilities the page looks for, each forwarding to the native side
// over `ReactNativeWebView.postMessage` and waiting for the answer the
// wrapper injects back through `resolveScript`.
//
//   __ossKeyVault           the framework's native key vault seam (SPEC §4.4):
//                           keys in the Keychain / Android Keystore
//   __storageRemoteScanner  scan a QR code with the camera
//   __storageRemoteShare    hand a file to the system share sheet
//
// The names are the page's (apps/remote/src/hosts.ts) and the framework's
// (KEY_VAULT_HOST_PROPERTY / _EVENT); a mismatch fails silently — the page
// just finds no host — so apps/remote/tests/native_bridge_test.ts pins them.
//
// It must run BEFORE the page's scripts: the client picks its key vault once,
// at start. Exports STRINGS, not behaviour; keep the script ES5-ish, it runs
// untranspiled in the page. Imports only wire.ts (which imports nothing).

import { BRIDGE_GLOBAL, BRIDGE_MESSAGE, scriptLiteral } from "./wire";
import type { BridgeResult } from "./wire";

export const BRIDGE_SCRIPT = `(function () {
  if (window.${BRIDGE_GLOBAL}) return;
  var pending = {};
  var next = 0;
  function call(op, args) {
    return new Promise(function (resolve, reject) {
      var id = "b" + (++next) + "-" + Math.random().toString(36).slice(2, 10);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: ${scriptLiteral(BRIDGE_MESSAGE)}, id: id, op: op, args: args
        }));
      } catch (e) {
        delete pending[id];
        reject(new Error("the app bridge is not available"));
      }
    });
  }
  window.${BRIDGE_GLOBAL} = {
    resolve: function (id, result) {
      var p = pending[id];
      if (!p) return;
      delete pending[id];
      if (result && result.ok) p.resolve(result.value);
      else p.reject(new Error((result && result.error) || "the app could not do that"));
    }
  };
  function install(property, event, host) {
    try {
      Object.defineProperty(window, property, {
        value: Object.freeze(host), writable: false, configurable: false
      });
      window.dispatchEvent(new Event(event));
    } catch (e) {}
  }
  install("__ossKeyVault", "oss:key-vault-host", {
    version: 1,
    get: function (id) { return call("vault.get", [id]); },
    put: function (id, value) { return call("vault.put", [id, value]).then(function () {}); },
    delete: function (id) { return call("vault.delete", [id]).then(function () {}); },
    clear: function (prefix) { return call("vault.clear", [prefix || ""]).then(function () {}); }
  });
  install("__storageRemoteScanner", "storage-remote:scanner", {
    version: 1,
    scan: function () { return call("scan", []); }
  });
  install("__storageRemoteShare", "storage-remote:share", {
    version: 1,
    share: function (file) { return call("share", [file]).then(function () {}); }
  });
})(); true;`;

/** The script that hands one answer back to the waiting page. */
export function resolveScript(id: string, result: BridgeResult): string {
  return `(function () { var b = window.${BRIDGE_GLOBAL}; if (b) b.resolve(${scriptLiteral(id)}, ${scriptLiteral(result)}); })(); true;`;
}
