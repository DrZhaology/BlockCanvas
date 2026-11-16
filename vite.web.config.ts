import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// BlockCanvas · Web 版构建配置（v0.4.6 / R6-13）
//
// 目的：产出**一个 .html 文件**，双击就能用（file:// 也行），放到静态托管也能用。
// 同一份渲染层源码，两份构建产物：
//   · electron.vite.config.ts  → 桌面版（out/renderer，走 preload 注入的 window.bc）
//   · 本文件                    → Web 版（dist-web/index.html，走 adapter/browser.ts）
//
// 关键点：
//   1. `base: './'` —— 相对路径，`file://` 下也能找到资源（绝对路径会失效）；
//   2. `viteSingleFile()` 把 JS/CSS 全内联，产物只有 index.html 一个文件；
//   3. 版本号用 define 编译进来（浏览器里没有 package.json 可读）；
//   4. 不加载 Electron 专属资源（logo png 之类会被 webpack 当资源 → 内联成 data URI，
//      singlefile 会自动处理，体积换可移植性，值得）。

const ver = JSON.parse(
  readFileSync(resolve(__dirname, 'version.json'), 'utf-8').replace(/^\uFEFF/, '')
) as { version?: string; stage?: string };

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  define: {
    __BC_VERSION__: JSON.stringify(String(ver.version ?? '0.0.0')),
    __BC_STAGE__: JSON.stringify(String(ver.stage ?? ''))
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@comp': resolve(__dirname, 'src/renderer/components'),
      '@store': resolve(__dirname, 'src/renderer/store'),
      '@lib': resolve(__dirname, 'src/renderer/lib')
    }
  },
  plugins: [
    react(),
    viteSingleFile({
      removeViteModuleLoader: true,
      // 我们的产物本来就只有 JS + CSS 两个 chunk，inline 起来约 2.7MB
      useRecommendedBuildConfig: true
    })
  ],
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    // 单文件模式下不要 code split（额外 chunk 会让"只有一个文件"失效）
    cssCodeSplit: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    rollupOptions: {
      output: {
        manualChunks: undefined,
        inlineDynamicImports: true
      }
    },
    target: 'chrome110'
  }
});
