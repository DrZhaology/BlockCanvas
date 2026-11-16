import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// BlockCanvas · electron-vite 配置
// 三进程构建统一在此声明：main / preload / renderer
// 渲染进程走 Vite + React；主进程与预加载用 esbuild 打包并外置 electron

/**
 * v0.4.6（R6-13）：把版本号**编译进**渲染层。
 *
 * 浏览器版没有 package.json 可读，`window.bc.getLocalVersion()` 必须有个值。
 * 源头仍然是根目录 version.json（唯一真源），这里只是搬运。
 */
const ver = JSON.parse(
  readFileSync(resolve(__dirname, 'version.json'), 'utf-8').replace(/^\uFEFF/, '')
) as { version?: string; stage?: string };

const sharedDefine = {
  __BC_VERSION__: JSON.stringify(String(ver.version ?? '0.0.0')),
  __BC_STAGE__: JSON.stringify(String(ver.stage ?? ''))
};

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
    // v0.4.6：版本号编译进产物（浏览器宿主用它回答 getLocalVersion）
    define: sharedDefine,
    build: {
      outDir: 'out/renderer',
      emptyOutDir: true
    },
    plugins: [react()],
    server: { port: 5173, strictPort: true }
  }
});
