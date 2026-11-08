
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: "public",
  server: {
    cors: {
      origin: "https://www.owlbear.rodeo",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        board: "board.html"
      }
    }
  }
});
