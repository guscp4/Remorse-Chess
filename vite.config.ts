import { defineConfig } from "vite";

// Relative base so the built site works both at the project root (local preview)
// and under a GitHub Pages project subpath (e.g. /Remorse-Chess/).
export default defineConfig({
  base: "./",
});
