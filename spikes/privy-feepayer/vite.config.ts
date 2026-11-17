import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  envDir: `${here}/..`, // spikes/.env — only VITE_* vars are exposed to the browser
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://localhost:8788" } },
});
