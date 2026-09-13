// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
var __electron_vite_injected_dirname = "E:\\Develop\\BlockCanvas";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { main: resolve(__electron_vite_injected_dirname, "src/main/main.ts") }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { preload: resolve(__electron_vite_injected_dirname, "src/preload/preload.ts") }
      }
    }
  },
  renderer: {
    root: "src/renderer",
    resolve: {
      alias: {
        "@renderer": resolve(__electron_vite_injected_dirname, "src/renderer"),
        "@comp": resolve(__electron_vite_injected_dirname, "src/renderer/components"),
        "@store": resolve(__electron_vite_injected_dirname, "src/renderer/store"),
        "@lib": resolve(__electron_vite_injected_dirname, "src/renderer/lib")
      }
    },
    build: {
      outDir: "out/renderer",
      emptyOutDir: true
    },
    plugins: [react()],
    server: { port: 5173, strictPort: true }
  }
});
export {
  electron_vite_config_default as default
};
