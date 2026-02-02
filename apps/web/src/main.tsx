console.log("[DEBUG] main.tsx start");
import React from "react";
import ReactDOM from "react-dom/client";
console.log("[DEBUG] main.tsx before App import");
import App from "./App";
console.log("[DEBUG] main.tsx after App import");
import "./style.css";

console.log("[DEBUG] main.tsx before render");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
console.log("[DEBUG] main.tsx after render");

