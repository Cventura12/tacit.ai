import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),

  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname),
      },
    },
    // Keep heavy Node.js packages out of the browser bundle
    ssr: {
      external: ["@napi-rs/canvas", "tesseract.js", "pdf-parse", "pdfjs-dist"],
    },
  },

  server: {
    host: "127.0.0.1",
    port: 3000,
  },
});
