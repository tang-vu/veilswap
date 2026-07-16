import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so the static build works on GitHub Pages' /veilswap/ subpath
  // as well as any root-hosted deployment.
  base: "./",
  server: { port: 5173 },
});
