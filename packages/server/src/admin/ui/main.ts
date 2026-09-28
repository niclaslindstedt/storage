// The admin console single-page app (SPEC §11.1). Served as /app.js by the
// console; talks only to the console's own /api (same origin, session
// cookie, CSRF header). The frame and the pages live in shell.ts, which the
// remote app mounts too (SPEC §11.2).

import "./styles.css";

import { h } from "./dom.ts";
import { mountConsole } from "./shell.ts";

const app = document.getElementById("app")!;

mountConsole({
  root: app,
  serverName: app.dataset.name ?? "storage",
  fallback: true,
  actions: h(
    "form",
    { method: "post", action: "/logout", class: "logout" },
    h("button", { type: "submit", "data-testid": "sign-out" }, "Sign out"),
  ),
  onTitle: (title) => (document.title = title),
});
