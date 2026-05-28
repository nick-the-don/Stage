import React from "react";
import { createRoot } from "react-dom/client";
import StageApp from "./App.jsx";

async function loadConfig() {
  const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Config request failed (${response.status})`);
  }
  return response.json();
}

function BootError({ error }) {
  return (
    <div id="boot">
      <div className="card">
        <h3>
          Stage failed to start <span className="pill err">ERROR</span>
        </h3>
        <div className="muted">The React app loaded, but the server config endpoint did not respond.</div>
        <pre>{String(error && (error.stack || error.message) || error)}</pre>
      </div>
    </div>
  );
}

async function main() {
  const root = createRoot(document.getElementById("root"));
  try {
    window.__VEO_CONFIG__ = await loadConfig();
    root.render(<StageApp />);
  } catch (error) {
    root.render(<BootError error={error} />);
  }
}

main();
