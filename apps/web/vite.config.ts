import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..", "..")],
    },
  },
});
