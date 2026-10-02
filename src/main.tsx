import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { installImageRecovery } from "./lib/images";
import { getWorkspacePath } from "./lib/storage";

// Team mode: retry local images that fail because the cloud client
// hasn't delivered the file yet (see lib/images.ts).
installImageRecovery();

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Prime the workspace-root cache before the first paint so image paths
// written on a teammate's machine resolve on the very first render.
// Never block startup on it: render anyway after a short timeout or on
// any failure (no Tauri runtime in tests, settings unreadable, ...).
let rendered = false;
const renderOnce = () => {
  if (rendered) return;
  rendered = true;
  render();
};
window.setTimeout(renderOnce, 400);
getWorkspacePath().then(renderOnce, renderOnce);
