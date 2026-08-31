// BlockCanvas · 通过 Watt Toolkit 本地代理（TLS 中间人）调用 GitHub REST API 发布 Release + 上传附件。
// 用法（先设好 GIT_TOKEN）：
//   node tools/gh-release.mjs
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 26561;
const OWNER = 'DrZhaology';
const REPO = 'BlockCanvas';
const ZIP = 'E:\\Develop\\BlockCanvas-0.3.1-win64.zip';

const TOKEN = process.env.GIT_TOKEN;
if (!TOKEN) { console.error('GIT_TOKEN 未设置'); process.exit(1); }

// 通过本地代理建立到 target:443 的 CONNECT 隧道，再在其上发 HTTPS 请求（rejectUnauthorized:false 以兼容代理中间人证书）
function req({ host, path: p, method = 'GET', headers = {}, body, file, label = 'req' }) {
  return new Promise((resolve, reject) => {
    const connectReq = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: 'CONNECT',
      path: `${host}:443`
    });
    connectReq.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`${label} CONNECT failed: ${res.statusCode}`));
        return;
      }
      const r = https.request({
        host, port: 443, path: p, method, headers,
        agent: false,
        createConnection: () => socket,
        rejectUnauthorized: false
      }, (resp) => {
        let data = '';
        resp.on('data', (c) => (data += c));
        resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
      });
      r.on('error', (e) => reject(new Error(`${label} request error: ${e.message}`)));
      if (file) {
        const st = fs.statSync(file);
        r.setHeader('Content-Length', st.size);
        fs.createReadStream(file).pipe(r);
      } else if (body) {
        r.setHeader('Content-Length', Buffer.byteLength(body));
        r.write(body);
        r.end();
      } else {
        r.end();
      }
    });
    connectReq.once('error', (e) => reject(new Error(`${label} CONNECT err: ${e.message}`)));
    connectReq.end();
  });
}

async function main() {
  const auth = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'blockcanvas' };

  // 0) 连通性探针
  const probe = await req({ host: 'api.github.com', path: `/repos/${OWNER}/${REPO}/releases`, method: 'GET', headers: auth, label: 'probe' });
  console.log('probe status:', probe.status);

  // 1) 创建 Release
  const body = JSON.stringify({
    tag_name: 'v0.3.1',
    name: 'BlockCanvas v0.3.1（阶段3测试版）',
    body: `BlockCanvas 积木画布 · v0.3.1\n\n### 本轮更新\n- 新增自动更新系统：启动静默检测 GitHub Releases，设置页可手动检测，下载 zip 后精确覆盖更新（保留 data/ 全部用户数据）\n- 扩展目录统一至 data/extensions/，内置插件（深色模式）和资源包（新手模板 14 个）随更新自动同步\n- 修复检查更新显示版本号 0.0.0 的 BUG（改用 app.getVersion() 兼容 asar）\n- 修复缓存清理无效问题（改为只清文件不清目录，避免 Chromium 立即重建）\n- 修复设置页「一键立即清理」按钮垂直偏移\n- 设置中心新增「自动更新」检测卡片，明确提示 Watt Toolkit 兼容问题\n\n### 特性\n- 纯绿色便携：所有数据存 data/ 目录，不写 AppData 和注册表\n- 拖拖拽拽画界面，14 个高质量模板一键插入\n- 伪类交互编辑（:hover/:active/:focus/:link），全量可视化属性（transform/shadow/transition…）\n- 导出干净、语义化的 HTML + CSS\n\n### 使用\n解压即用；把插件/资源包放进同目录 extensions/ 即可。\n\n### 了解更多\n[功能规划](https://github.com/DrZhaology/BlockCanvas/blob/main/docs/功能规划.md) ｜ [开发历程](https://github.com/DrZhaology/BlockCanvas/blob/main/docs/开发历程.md) ｜ [许可证 MIT](https://github.com/DrZhaology/BlockCanvas/blob/main/LICENSE)`,
    draft: false,
    prerelease: true
  });
  const created = await req({
    host: 'api.github.com',
    path: `/repos/${OWNER}/${REPO}/releases`,
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json; charset=utf-8' },
    body,
    label: 'create'
  });
  console.log('create status:', created.status);
  if (created.status >= 400) { console.error('create error:', created.body); process.exit(1); }
  const rel = JSON.parse(created.body);
  console.log(`release id=${rel.id} tag=${rel.tag_name} name=${rel.name}`);

  // 2) 上传附件
  const name = encodeURIComponent(path.basename(ZIP));
  const up = await req({
    host: 'uploads.github.com',
    path: `/repos/${OWNER}/${REPO}/releases/${rel.id}/assets?name=${name}`,
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/zip' },
    file: ZIP,
    label: 'upload'
  });
  console.log('upload status:', up.status);
  if (up.status >= 400) { console.error('upload error:', up.body); process.exit(1); }
  const asset = JSON.parse(up.body);
  console.log(`asset id=${asset.id} name=${asset.name} size=${asset.size} bytes`);
  console.log('done');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
