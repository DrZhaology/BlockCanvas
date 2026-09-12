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
const ZIP = 'E:\\Develop\\BlockCanvas-0.4.0-win64.zip';

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
    tag_name: 'v0.4.0',
    name: 'BlockCanvas v0.4.0（阶段4三断点响应式正式版）',
    body: `BlockCanvas 积木画布 · v0.4.0\n\n### 阶段4重大里程碑：三断点响应式体系 + 全键盘高频快捷键\n- 三断点响应式引擎：电脑 (Desktop, >768px) / 平板 (Tablet, 481~768px) / 手机 (Mobile, ≤480px)\n- 级联继承模型：电脑端为样式源，平板/手机仅记录覆盖差异，支持一键还原继承与覆盖小圆点提示\n- 专业 CSS 导出：自动编译为标准 @media (max-width: 768px) 与 @media (max-width: 480px) 媒体查询\n- 移动端高频胶囊：一键手机隐藏 (display:none)、一键转竖排 (flex-direction:column)、一键撑满全宽 (100%)\n- 手机端真机视口：375px 模式下配备沉浸式微圆角真机外框\n- 全键盘生产力：Delete 删除、Ctrl+D 原地克隆、Esc 取消选择、方向键 1px/10px 微调、? 键呼出速查表\n- 模板库全绿通过 0 冲突，口袋撑开记忆，设置中心 Fluent 规范升级\n\n### 了解更多\n[功能规划](https://github.com/DrZhaology/BlockCanvas/blob/main/docs/功能规划.md) ｜ [开发历程](https://github.com/DrZhaology/BlockCanvas/blob/main/docs/开发历程.md) ｜ [设计语言](https://github.com/DrZhaology/BlockCanvas/blob/main/docs/设计语言.md) ｜ [许可证 MIT](https://github.com/DrZhaology/BlockCanvas/blob/main/LICENSE)`,
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
