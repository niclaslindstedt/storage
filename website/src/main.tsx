// Client entry: hydrate the prerendered page (never createRoot, which would
// wipe the server-rendered body).
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

import { App } from "./App";
import { pageFor } from "./site";
import "./styles.css";

const page = pageFor(window.location.pathname);
// The doc body is already in the DOM; reuse it rather than shipping every
// doc in the bundle.
const docBody = document.getElementById("doc-body")?.innerHTML ?? "";

hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <App page={page} docBody={docBody} />
  </StrictMode>,
);
