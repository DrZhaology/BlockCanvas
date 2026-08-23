import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// BlockCanvas · electron-vite 配置
// 三进程构建统一在此声明：main / preload / renderer
// 渲染进程走 Vite + React；主进程与预加载用 esbuild 打包并外置 electron

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { main: resolve(__dirname, 'src/main/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { preload: resolve(__dirname, 'src/preload/preload.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@comp': resolve(__dirname, 'src/renderer/components'),
        '@store': resolve(__dirname, 'src/renderer/store'),
        '@lib': resolve(__dirname, 'src/renderer/lib')
      }
    },
    build: {
      outDir: 'out/renderer',
      emptyOutDir: true
    },
    plugins: [react()],
    server: { port: 5173, strictPort: true }
  }
});
