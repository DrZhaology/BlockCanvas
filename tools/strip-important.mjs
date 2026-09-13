// 一次性脚本：移除 styles.css 中所有 !important，并同步调整特异性（保证视觉与行为不变）
// 用法：node tools/strip-important.mjs
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const P = resolve(process.cwd(), 'src/renderer/styles.css');
let s = readFileSync(P, 'utf8');
const before = (s.match(/!important/g) || []).length;

/** 精确替换，找不到就报错（避免静默漏改） */
function rep(oldStr, newStr, label) {
  if (!s.includes(oldStr)) throw new Error('NOT FOUND: ' + label);
  s = s.split(oldStr).join(newStr);
}

// 1) 全局输入控件规则：用 .app 前缀 + :where() 压低特异性，不再需要 !important
rep(
`input, textarea, select, [contenteditable='true'], [contenteditable=''], [contenteditable] {
  -webkit-user-select: text !important;
  user-select: text !important;
  pointer-events: auto !important;
}`,
`/* 输入类控件始终可输入、可选中（.app 前缀保证足够特异性；拖拽态规则排在其后，可正常覆盖） */
.app input,
.app textarea,
.app select,
.app [contenteditable='true'],
.app [contenteditable=''],
.app [contenteditable] {
  -webkit-user-select: text;
  user-select: text;
  pointer-events: auto;
}`,
'input protect');

rep(
`input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"]),
textarea {
  cursor: text !important;
}`,
`/* 光标形状：:where() 让 :not() 链不贡献特异性，各处可按需覆盖（无需 !important） */
.app input:where(:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"])),
.app textarea {
  cursor: text;
}`,
'input cursor');

// 2) 标签页按钮：:hover 本身已高于基础态，去掉 !important
rep(`.tab-rename-btn-front:hover {
  opacity: 1 !important;`, `.tab-rename-btn-front:hover {
  opacity: 1;`, 'tab rename hover');
rep(`.tab-close-btn:hover {
  background: #fee2e2;
  color: #ef4444;
  opacity: 1 !important;
}`, `.tab-close-btn:hover {
  background: #fee2e2;
  color: #ef4444;
  opacity: 1;
}`, 'tab close hover');

// 3) 工具栏主按钮：.toolbar .btn-primary (0,2,0) 已胜过 .toolbar button (0,1,1)
rep(`.toolbar .btn-primary {
  background: var(--accent) !important;
  color: #fff !important;
  border-color: var(--accent-hover) !important;`,
`.toolbar .btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent-hover);`, 'toolbar btn-primary');
rep(`.toolbar .btn-primary:hover:not(:disabled) { background: var(--accent-hover) !important; }`,
  `.toolbar .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }`, 'toolbar btn-primary hover');

// 4) 手机真机外框：.canvas.is-mobile-frame (0,2,0) 已胜过 .canvas (0,1,0)
rep(`  border-radius: 40px !important;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.22), 0 0 0 8px #1e222b, 0 0 0 10px #3c4250 !important;`,
`  border-radius: 40px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.22), 0 0 0 8px #1e222b, 0 0 0 10px #3c4250;`, 'mobile frame');

// 5) 三断点快捷按钮：加父级前缀提升特异性（.btn-mini 定义在后面，原本只能靠 !important 取胜）
rep(`.bp-clear-btn {
  color: #2563eb !important;
  border-color: #93c5fd !important;
  font-size: 10.5px !important;
  height: 22px !important;
  padding: 0 6px !important;
}`,
`.inspector-bp-banner-head .bp-clear-btn {
  color: #2563eb;
  border-color: #93c5fd;
  font-size: 10.5px;
  height: 22px;
  padding: 0 6px;
}`, 'bp-clear-btn');
rep(`.bp-quick-btn {
  font-size: 11px !important;
  padding: 2px 8px !important;
  height: 24px !important;
  border-radius: 4px !important;
  background: var(--bg-panel) !important;
  color: var(--text) !important;
}`,
`.inspector-bp-actions .bp-quick-btn {
  font-size: 11px;
  padding: 2px 8px;
  height: 24px;
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
}`, 'bp-quick-btn');
rep(`/* 修复：.btn-mini:hover 会把文字刷成 #fff，这里必须显式给出 hover 配色，
   否则白底白字（三断点快捷操作栏「在此设备隐藏 / 一键切竖排 / 撑满全宽」） */
.bp-quick-btn:hover:not(:disabled) {
  background: var(--hover-accent) !important;
  color: var(--accent) !important;
  border-color: var(--accent) !important;
}
.bp-quick-btn.active {
  background: #ef4444 !important;
  color: #ffffff !important;
  border-color: #dc2626 !important;
}
.bp-quick-btn.active:hover:not(:disabled) {
  background: #dc2626 !important;
  color: #ffffff !important;
  border-color: #b91c1c !important;
}
.bp-clear-btn:hover:not(:disabled) {
  background: var(--hover-accent) !important;
  color: #1d4ed8 !important;
}`,
`/* .btn-mini:hover 是"实心主色"悬停，这里必须显式给出背景 + 文字色，
   否则会出现白底白字（三断点快捷操作栏「在此设备隐藏 / 一键切竖排 / 撑满全宽」） */
.inspector-bp-actions .bp-quick-btn:hover:not(:disabled) {
  background: var(--hover-accent);
  color: var(--accent);
  border-color: var(--accent);
}
.inspector-bp-actions .bp-quick-btn.active {
  background: #ef4444;
  color: #ffffff;
  border-color: #dc2626;
}
.inspector-bp-actions .bp-quick-btn.active:hover:not(:disabled) {
  background: #dc2626;
  color: #ffffff;
  border-color: #b91c1c;
}
.inspector-bp-banner-head .bp-clear-btn:hover:not(:disabled) {
  background: var(--hover-accent);
  color: #1d4ed8;
  border-color: #93c5fd;
}`, 'bp hover');

// 6) 拖拽 / 框选态的光标与选择：排在这些规则之后，靠顺序取胜
rep(`body.bc-marqueeing, body.bc-marqueeing * {
  cursor: crosshair !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}`, `body.bc-marqueeing, body.bc-marqueeing * {
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
}`, 'marquee cursor');
rep(`body.bc-zoom-dragging, body.bc-zoom-dragging * { cursor: none !important; }`,
  `body.bc-zoom-dragging, body.bc-zoom-dragging * { cursor: none; }`, 'zoom cursor');
rep(`body.bc-drag-hide-cursor, body.bc-drag-hide-cursor * { cursor: none !important; }`,
  `body.bc-drag-hide-cursor, body.bc-drag-hide-cursor * { cursor: none; }`, 'drag hide cursor');
rep(`body.bc-resizing-ns, body.bc-resizing-ns * { cursor: ns-resize !important; user-select: none; }`,
  `body.bc-resizing-ns, body.bc-resizing-ns * { cursor: ns-resize; user-select: none; }`, 'resize ns');
rep(`body.bc-resizing-col, body.bc-resizing-col * { cursor: col-resize !important; user-select: none; }`,
  `body.bc-resizing-col, body.bc-resizing-col * { cursor: col-resize; user-select: none; }`, 'resize col');

// 7) 轮廓按钮 active：加 :hover 变体保证悬停时不被 .toolbar button:hover 覆盖
rep(`.toolbar .tb-outline-btn.active { background: var(--accent); border-color: var(--accent); color: #fff !important; font-weight: 600; }`,
  `.toolbar .tb-outline-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }`, 'outline active');
rep(`.toolbar .tb-outline-btn.active:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff !important; }`,
  `.toolbar .tb-outline-btn.active:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff; }`, 'outline active hover');

// 8) 面板拖手禁用态：加 .workspace 前缀压过 .panel-resizer:hover
rep(`.panel-resizer.is-disabled {
  cursor: not-allowed !important;
  pointer-events: none !important;
  opacity: 0 !important;
}`, `.workspace .panel-resizer.is-disabled {
  cursor: not-allowed;
  pointer-events: none;
  opacity: 0;
}`, 'resizer disabled');

// 9) 图层拖入高亮：加 .layer-tree 前缀压过 .layer-row:hover
rep(`.layer-row.drop-inside {
  background: #dbeafe !important;`, `.layer-tree .layer-row.drop-inside {
  background: #dbeafe;`, 'layer drop-inside');

// 10) 画布行内文本输入框：加 .canvas 前缀（0,2,0）即可胜过全局输入框规则
rep(`  background: rgba(255, 255, 255, 0.96) !important;
  border: 2px solid #1e88e5 !important;`, `  background: rgba(255, 255, 255, 0.96);
  border: 2px solid #1e88e5;`, 'inline input bg');
rep(`  outline: none !important;
  padding: 2px 6px !important;`, `  outline: none;
  padding: 2px 6px;`, 'inline input outline');
rep(`  cursor: text !important;`, `  cursor: text;`, 'inline input cursor');

// 11) 透明色块棋盘底：已是 (0,2,0)，无需 !important
rep(`  background: repeating-conic-gradient(#cbd5e1 0% 25%, #ffffff 0% 50%) 50% / 8px 8px !important;`,
  `  background: repeating-conic-gradient(#cbd5e1 0% 25%, #ffffff 0% 50%) 50% / 8px 8px;`, 'swatch transparent');

// 12) 扩展管理按钮
rep(`.extm-btn-primary { background: var(--accent) !important; color: #fff !important; border-color: var(--accent-hover) !important; }`,
  `.extm-btn-primary { background: var(--accent); color: #fff; border-color: var(--accent-hover); }`, 'extm primary');
rep(`.extm-btn-primary:hover:not(:disabled) { background: var(--accent-hover) !important; color: #fff !important; }`,
  `.extm-btn-primary:hover:not(:disabled) { background: var(--accent-hover); color: #fff; }`, 'extm primary hover');
rep(`.extm-btn-danger { color: var(--danger) !important; border-color: var(--danger) !important; }`,
  `.extm-btn-danger { color: var(--danger); border-color: var(--danger); }`, 'extm danger');
rep(`.extm-btn-danger:hover:not(:disabled) { background: var(--danger) !important; color: #fff !important; }`,
  `.extm-btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }`, 'extm danger hover');

// 13) 灾难恢复条「忽略」按钮
rep(`  background: transparent !important;
  color: inherit !important;
  border-color: currentColor !important;`, `  background: transparent;
  color: inherit;
  border-color: currentColor;`, 'recovery ignore');

// 14) 删除确认弹窗
rep(`.dd-modal-footer button {
  margin: 0 !important;`, `.dd-modal-footer button {
  margin: 0;`, 'dd footer margin');
rep(`.dd-modal-footer .btn-danger:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: var(--border) !important;
  border-color: var(--border) !important;
  color: var(--text-muted) !important;
}`, `.dd-modal-footer .btn-danger:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: var(--border);
  border-color: var(--border);
  color: var(--text-muted);
}`, 'dd danger disabled');

// 15) 渐变「移除渐变」按钮：加父级前缀 + 补 hover 配色
rep(`.grad-clear-btn { color: var(--danger) !important; }`,
`.grad-presets-head .grad-clear-btn { color: var(--danger); border-color: #fca5a5; }
.grad-presets-head .grad-clear-btn:hover:not(:disabled) {
  background: #fee2e2;
  color: var(--danger);
  border-color: #fca5a5;
}`, 'grad clear');

// 16) v0.4.1 工具栏按钮语言：作用域选择器已足够，去掉 !important
rep(`.toolbar .tb-btn-primary {
  background: var(--accent) !important;
  border: 1px solid var(--accent-hover) !important;
  color: #fff !important;`,
`.toolbar .tb-btn-primary {
  background: var(--accent);
  border: 1px solid var(--accent-hover);
  color: #fff;`, 'tb-btn-primary');
rep(`.toolbar .tb-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover) !important;`,
`.toolbar .tb-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);`, 'tb-btn-primary hover');

rep(`.tb-device-btn {
  height: 22px !important;
  padding: 0 8px !important;
  border: 1px solid transparent !important;
  border-radius: 4px !important;
  background: transparent !important;
  color: var(--text-muted) !important;
  font-size: 11.5px !important;
  font-weight: 600 !important;
  box-shadow: none !important;
}
.tb-device-btn:hover:not(.active) {
  background: var(--hover) !important;
  color: var(--text) !important;
}
.tb-device-btn.active {
  background: var(--bg-panel) !important;
  border-color: var(--border) !important;
  color: var(--accent) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06) !important;
}`,
`.toolbar .tb-device-btn {
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 600;
  box-shadow: none;
}
.toolbar .tb-device-btn:hover:not(.active) {
  background: var(--hover);
  color: var(--text);
}
.toolbar .tb-device-btn.active {
  background: var(--bg-panel);
  border-color: var(--border);
  color: var(--accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}`, 'tb-device-btn');

rep(`.toolbar .tb-outline-btn.active {
  background: var(--accent) !important;
  border-color: var(--accent) !important;
  color: #fff !important;
  font-weight: 600;
}
.toolbar .tb-outline-btn.active:hover {
  background: var(--accent-hover) !important;
  border-color: var(--accent-hover) !important;
  color: #fff !important;
}`,
`.toolbar .tb-outline-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 600;
}
.toolbar .tb-outline-btn.active:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: #fff;
}`, 'tb-outline-btn active');

writeFileSync(P, s, 'utf8');
const after = (s.match(/!important/g) || []).length;
console.log(`!important: ${before} -> ${after}`);
