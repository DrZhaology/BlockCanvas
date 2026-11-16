/// <reference types="vite/client" />

/**
 * v0.4.6（R6-13）：构建期注入的版本信息。
 *
 * 浏览器版没有 package.json 可读，版本号只能编译进来；
 * 值来自 electron.vite.config 的 define（源头仍是根目录 version.json）。
 */
declare const __BC_VERSION__: string;
declare const __BC_STAGE__: string;

