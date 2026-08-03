import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MediaJournal } from "../app/MediaJournal";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing application root.");
}

createRoot(root).render(
  <StrictMode>
    <MediaJournal />
  </StrictMode>,
);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    const workerUrl = new URL("sw.js", document.baseURI);
    void navigator.serviceWorker.register(workerUrl.pathname, {
      scope: new URL("./", document.baseURI).pathname,
    });
  });
}
