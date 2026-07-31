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
