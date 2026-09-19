# BlockCanvas · 积木画布

<p align="center">
  <img src="docs/screenshots/logo.png" alt="BlockCanvas Logo" width="96" height="96" />
</p>

<h1 align="center">BlockCanvas · 积木画布</h1>

<p align="center">
  <strong>让完全不懂代码的人，也能做出专业网页的桌面可视化编辑器</strong><br/>
  拖拖拽拽画界面 · 内置模板 · 后期接入 Scratch 式积木编程<br/>
  最终导出干净、可读、手写级的 HTML / CSS / JS
</p>

<p align="center">
  <a href="#"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-33-47848F" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB" />
</p>

---

## 📖 项目简介

BlockCanvas（积木画布）是一个**可视化静态网页构建工具（WYSIWYG）**。核心目标是：**给零基础用户一个「可视化网页工厂」**，让你像用画图软件一样拖出界面，产物必须是手写级的干净代码，而不是一堆 `<div>` 山。

- 🖱️ 用鼠标拖拖拽拽就能搭出网页界面
- 🧩 内置大量模板资源包，一键插入
- 🧱 后期用 Scratch 式积木编程添加交互
- 📤 导出纯净、语义化、可读的 HTML + CSS（后续 +JS）
- 💾 **纯便携设计**：所有工程、快照、配置均存储在 `data/` 目录，不写系统 AppData 和注册表
- 🔄 **自动更新系统**：启动时静默检测 GitHub Releases 最新版本，有更新弹窗提示，设置页可手动检测；更新时只替换程序本体，永久保留 `data/` 下的所有用户数据

> 说人话：不懂代码，也能做出专业网页。

## ✨ 功能特性

- **所见即所得画布**：流式布局为主，元素可切换 `position`（static/relative/absolute/fixed/sticky），贴合真实网页行为
- **语义化元素系统**：`div / header / nav / section / main / article / aside / footer / 标题 / 段落 / 按钮 / 输入框 / 图片…`，导出不堆 `div`
- **属性面板**：盒模型（4 值分开填写）/ 定位 / 颜色与渐变 / 字体 / 边框 / 阴影 / 快捷助手（Flex · Grid · 文字渐变）实时预览
- **滚轮调值**：任意数值框点一下进入输入状态，滚动滚轮即增减（上滚增大 / 下滚减小），按住 `Shift` 一次调 10；停手自动提交，一次聚焦 = 一条撤销
- **设计变量（Token）**：把主色 / 圆角 / 间距 / 字号 / 阴影定义成 `--bc-*` 变量，元素里引用 `var(--bc-primary)`，**改一处全站跟着变**；导出时写入 `:root`，脱离本软件同样生效
- **导出前体检**：导出 / 预览前自动扫描并拦截严重问题（写了 `:hover` 却没类名、ID 重复、同名样式不统一…），按严重度列出并支持一键修复
- **渐变体系**：PowerPoint 风格可视化渐变编辑器（角度方向盘 + 色标 + 26 款预制配色），支持无损导入模板里手写的 `linear-gradient(...)`
- **快捷助手**：把「多条 CSS 属性配合才能做出的效果」打包成一句话 —— Flex / Grid 布局、文字渐变；生成的属性可一键从下方 CSS 列表隐藏（全局统一开关，见「设置 → 编辑器与画布」）
- **图层管理器**：树状 DOM，拖拽改层级 / 重命名 / 显隐 / 锁定
- **样式系统**：样式自动抽类（`.bc-s-*`）复用，同名冲突统一，导出干净 CSS
- **模板资源库**：内置 14 个完整网页模板（品牌首页 / 营销转化 / 信息内容 / 基础组件），按分类展示，一键插入
- **扩展系统**：插件 + 资源包，统一放在程序目录 `extensions/`，支持导入 / 导出 / 启停
- **Undo / Redo**：全局可序列化单一数据源，所有操作可撤销/恢复
- **伪类交互编辑**：支持 `:hover` / `:active` / `:focus` / `:link` 状态，每个伪类内置多款预制动效（上浮 / 放大 / 发光 / 下沉 / 外圈光晕…），套用后可用滑块微调位移、缩放、旋转、阴影与过渡时长
- **工具栏自由池**：一条工具栏 = 主区（可滚动流水线）+ 右端固定区 + 「⋯更多」收纳；每个按钮的停靠区与顺序都可在「设置 → 工具栏管理」拖拽调整，插件按钮同样参与
- **整页自动适配**：在平板 / 手机断点下一键扫描全页并给出调整建议（固定宽度 → 100%、多列 → 单列…），确认后一次性写入，一条 `Ctrl+Z` 整体撤销
- **设备三断点**：电脑 / 平板 / 手机 = 画布宽度 = 编辑断点，工具栏右端随时切换（未选中元素也可切换）
- **字体库**：全屏面板枚举电脑全部字体 + 常见字体目录（按公开资料预标注「可商用 / 商用需注意」），左侧实时预览，支持多字体回退链拖拽排序，可登记 @font-face 自定义字体
- **编辑器技巧**：项目标签栏右侧常驻轮播，每 15 秒换一条，双击文字立刻换（含 `Shift + /` 呼出全部快捷键）
- **全量可视化属性**：transform / box-shadow / text-shadow / transition / opacity / line-height 全部带滑块与预设
- **可视化边框 / 阴影编辑器**：四边粗细、线型、颜色分别可调并实时预览；盒子阴影支持多层与内阴影
- **双击文案内联编辑**：画布文本元素支持双击直接编辑文字
- **工程文件保存/打开**（`.bcproj` 自定义格式）
- **多标签工程**：像浏览器一样同时开多个页面，会话自动恢复
- **布局双模式**：左侧栏布局 / 底部栏布局（默认，画布最大）
- **设置中心**：个性化 / 外观 / 存储与缓存管理 / 工具栏 / 扩展管理 / 关于
- **启动自动清洁**：可选择启动时自动清除临时缓存和孤立快照，保持轻量
- **状态记忆**：所有开关 / 折叠 / 面板宽度都会记住，下次打开还是你上次的样子

## 🖼️ 截图

| 编辑器界面 | 底部布局 · 模板页 |
| --- | --- |
| ![编辑器](docs/screenshots/editor-初始界面.png) | ![模板页](docs/screenshots/layout-底部模板页.png) |

## 🛠️ 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron |
| 语言 | TypeScript |
| 前端框架 | React |
| 状态管理 | zustand |
| 包管理 | pnpm |
| 构建 | electron-vite (Vite) |
| 打包 | electron-builder |
| 积木编程（后期） | Google Blockly |
| 编辑器（后期） | Monaco Editor |

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（推荐 20+）
- pnpm ≥ 9
- Git

### 开发模式

```bash
pnpm install
pnpm dev
```

> 说明：桌面壳是 Electron，`pnpm dev` 会拉起一个本地窗口。

### 构建 / 类型检查 / 测试

```bash
pnpm typecheck      # TypeScript 类型检查
pnpm build          # 构建产物到 out/
pnpm test:e2e       # 构建 + 跑 Playwright 端到端测试
```

### 打包成便携版（Windows）

```bash
powershell -ExecutionPolicy Bypass -File build-exe.ps1
```

产物为 `dist\win-unpacked\`（绿色便携文件夹）+ `dist\BlockCanvas-0.4.0-win64.zip`。
绿色便携：**免安装、不写 AppData**；`data/extensions/` 内置插件/资源包随 zip 分发，开箱即用。

> 版本号规则：`0.X.X` = 阶段测试版，`X.X` = 正式版（如 1.0、2.3）。当前 `0.4.0`。

## 📁 目录结构

```
BlockCanvas/
├─ src/
│  ├─ main/            # Electron 主进程（窗口、菜单、IPC、权限、扩展/导出/预览/便携存储）
│  ├─ preload/         # 预加载脚本（window.bc 桥）
│  └─ renderer/        # React 界面（画布/元素面板/属性/图层/扩展管理/设置…）
│     ├─ components/   # 各界面组件
│     ├─ lib/          # 纯逻辑：导出器、样式类、插件宿主、字体目录、设计变量、类型、schema
│     ├─ store/        # zustand 状态（scene / toolbar / tab）
│     ├─ styles/       # 全局样式（01..14 语义分片，import 顺序 = 级联顺序）
│     └─ animations.css# 统一动画体系（token + 全部 @keyframes，唯一动画定义处）
├─ extensions/         # 内置扩展源码（git仓库收录，供构建时打包进 zip）
├─ data/               # 所有运行时数据（纯便携，不写系统目录）
│  ├─ projects/        # 项目工程文件（.bcproj）
│  ├─ backups/         # 自动备份历史快照
│  ├─ config.json      # 用户配置（主题/布局/缓存清洁开关/更新记录等）
│  ├─ user-data/       # Chromium 隔离区（Cache / Session Storage / Dictionaries…）
│  └─ extensions/      # 运行时扩展副本（内置种子同步 + 用户第三方扩展）
├─ docs/               # 文档与截图
├─ tests/e2e/          # Playwright 端到端测试
├─ tools/              # 辅助脚本（Logo 渲染、发布等）
├─ electron-builder.yml  # 打包配置
├─ build-exe.ps1         # 一键打包脚本（生成绿色便携 zip，含 extensions/ 源码）
└─ package.json
```

## 🤖 AI 协作导航（AI 助手请先读这一节）

> 本节为 AI 助手（以及新加入的人类协作者）准备：**接到任务先来这里查"改哪、按什么规矩改"**。

### ① 文档阅读顺序（按需取用，不必全读）

| 场景 | 读什么 |
|---|---|
| 第一次接触本项目 | 本 README 的「项目简介 / 技术栈 / 目录结构」 |
| 理解某个功能"为什么这样做" | [功能规划](docs/功能规划.md)（目标与设计原则） |
| 了解最近的迭代与决策 | [开发历程](docs/开发历程.md)（**按时间倒序**，最新一轮在最上面，含每轮的问题→根因→方案） |
| 本阶段的验收清单与下一步 | [v0.4.0 收尾与下一阶段规划](docs/v0.4.0-收尾与下一阶段规划.md)（末尾有各轮"迭代补记"，注意其中被划掉/取代的旧方案） |
| 写插件 / 资源包 | [扩展规范](docs/扩展规范.md) |
| 改 Logo / 宣传图 | [图标设计](docs/图标设计.md) |

### ② 硬性约定（违反会返工，改代码前必读）

1. **代码中不允许出现 `!important`** —— 需要覆盖时提高选择器特异性（如 `html[data-bc-dark] .canvas-wrap`）。
2. **动画只在 `src/renderer/animations.css` 定义**（token `--dur-*/--ease-*` + 全部 @keyframes）；
   组件样式里只写 `animation: bcXxx var(--dur-*) var(--ease-*)` 引用；**禁止无限闪烁动画**；
   reduced-motion 靠把 :root 的 token 归零实现（零 !important）。
3. **CSS 样式在 `src/renderer/styles/01..14` 语义分片**：新增样式写进语义对应分片末尾，
   跨轮追加统一进 `14-v04x-append.css`；**main.tsx 的 import 顺序 = 级联顺序，勿调序**。
4. **全屏弹窗一律 `createPortal` 到 `document.body`** —— 属性面板折叠动画的祖先 transform 会劫持
   `position: fixed` 的包含块（调色盘和字体库都踩过这个坑）。
5. **画布渲染与 HTML 导出共用 `lib/styleClass.ts` 同一套逻辑**，改样式生成规则时两边一起考虑。
6. **设计变量（用户网页用）一律 `--bc-*` 前缀**，与软件自身 UI 变量（`--accent` 等）严格分开。
7. **用户可开/关、折叠/展开的状态必须持久化**，统一走 `lib/usePersisted.ts`（`bc-flag:` 前缀）。
8. **插件改动要同步三处副本**：`extensions/`、`data/extensions/`、`dist/win-unpacked/data/extensions/`。
9. **导出代码要干净**：类名/关系选择器优先，无名元素走行内样式并提示起名；
   伪类样式必须有类名/ID/关系选择器才能在导出后生效（面板要主动提醒）。
10. **块级容器默认 padding 必须写 4 个 longhand**（不能写 `padding: '8px'` 简写）——
    四值输入读 longhand，简写会导致显示 0 且编辑值被残留简写覆盖。
11. **状态选择器不要返回新数组/新对象**（zustand + useSyncExternalStore 会误判变化）；
    给动态 `<Tag>` 传 ref 会 TS2590，量 DOM 用 `data-bc-id` 查询。
12. **`.canvas` 必须保持 `position: relative`**（画布内绝对定位元素的锚点）。

### ③ "改 X 去哪" 文件地图

| 要改的东西 | 去哪 |
|---|---|
| 工具栏按钮/停靠区 | `components/Toolbar.tsx` + `store/toolbarStore.ts`（dock 模型）+ 设置页 `ToolbarManagerSection` |
| 画布 / 选中框 / 拖框 | `components/Canvas.tsx`（行内选中合并外框也在这） |
| 属性面板 | `components/Inspector.tsx`（分节折叠状态按"选择器→元素id"分级持久化，起名自动迁移） |
| 导出的 HTML/CSS | `lib/exporter.ts` + `lib/styleClass.ts` |
| 样式类 / 选择器规则 | `lib/styleClass.ts`（画布=导出同一套） |
| 渐变 | `lib/gradient.ts` + `components/GradientEditor.tsx` |
| 字体库 | `lib/fontCatalog.ts`（商用预标注）+ `components/FontPickerModal.tsx` + 入口 `FontFamilyInput.tsx` |
| 设计变量 | `lib/designTokens.ts` + `components/TokenPanel.tsx` + 调色盘变量区（`ColorPicker.tsx`） |
| 伪类动效 | `components/PseudoFx.tsx` + `lib/fx.ts`（套用预制自动补 0.3s 过渡） |
| 数值滚轮调值 | `lib/wheelAdjust.ts`（滚一下=±1，Shift=±10） |
| 主进程 / IPC / 权限 | `src/main/main.ts`（字体库的 local-fonts 权限也在这放行） |
| 插件宿主 / 按钮注册 | `lib/pluginHost.ts`（插件按钮要显示状态：变化后重新 `Bc.registerCommand`） |
| 多标签 / 小技巧条 | `components/ProjectTabBar.tsx` + `TipsTicker.tsx` |

### ④ 分支与发布节奏（v0.4.1 起生效，长期遵循）

- **`alpha` = 开发分支**：每改完一轮就本地 commit（说明文字同步《开发历程》条目）；
  **每 3～5 轮 push 一次到 GitHub**；
- **`main` = 稳定分支**：一个小版本完成并验证后，把 alpha 合并回 main（通常为快进合并），
  打 tag 作为里程碑，再推送；
- `main` 上不做直接开发（小修除外），保证 main 的每个存档都可信；
- 版本号规则不变：`0.X.X` = 阶段测试版（当前 **0.4.1**），`X.X` = 正式版。

### ⑤ 会话工作流建议

1. 动手前：读本节 + 「开发历程」最新 1～2 轮（了解刚发生什么、哪些方案被否过）。
2. 动手中：遵守上面 12 条硬性约定；UI 弹窗记得 Portal；动画写引用不写 keyframes。
3. 收尾：`node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` + `node ./node_modules/electron-vite/bin/electron-vite.js build` 双验证；
   在「开发历程」顶部追加本轮条目（问题 → 根因 → 方案，按现有格式）。

## 📚 文档

- [功能规划](docs/功能规划.md) —— 目标、设计原则、技术决策、路线图
- [开发历程](docs/开发历程.md) —— 按时间倒序的迭代记录
- [v0.4.0 收尾与下一阶段规划](docs/v0.4.0-收尾与下一阶段规划.md) —— 本阶段改动清单、验收清单、下一步方向
- [扩展规范](docs/扩展规范.md) —— 插件 / 资源包开发规范
- [图标设计](docs/图标设计.md) —— Logo 设计说明与重新生成方法

## 🧩 扩展系统

扩展统一放在程序目录 `extensions/` 下：

```
extensions/
├─ plugins/<id>/        # 插件（manifest.json + 执行代码）
└─ resources/<id>/      # 资源包（manifest.json + templates/*.json）
```

详细规范见 [扩展规范](docs/扩展规范.md)。在菜单「设置 → 插件与资源包」可导入 / 导出 / 启停扩展。

## 🗺️ 路线图

当前处于 **阶段 4（响应式与打磨）**，已完成阶段 0～3 全部功能。完整规划见 [功能规划](docs/功能规划.md)。

- [x] 阶段 0：最小链路（拖元素 → 改样式 → 导出）
- [x] 阶段 1：HTML 结构系统
- [x] 阶段 2：Flex 封装 / 样式类系统
- [x] 阶段 3：CSS 类名化 + 模板资源包 + 扩展管理 + 插件系统
- [x] 阶段 4：伪类交互编辑 / 工程文件保存/打开 / 全量可视化属性 / 双击文案内联编辑 / 设置中心 / 便携存储 / 自动更新系统
- [x] 三断点响应式（桌面 / 平板 / 手机）+ 真机视口预览 + 整页自动适配
- [x] 快捷键体系（复制/粘贴/删除/撤销/保存/导出…，`Shift + /` 查看全部）
- [x] 导出前体检 + 设计变量（Token）体系
- [ ] 多页项目与公共区块（一个工程多个页面，页头页脚改一处全站变）
- [ ] 对齐吸附 + 参考线 + 标尺
- [ ] 拖拽布局增强（从元素面板/图层树直接拖到画布指定位置）
- [ ] 撤销历史面板（可视化列表，可跳回任意一步）
- [ ] 阶段 5：Scratch 式积木编程
- [ ] 阶段 6：正式发版（安装包签名、自动更新完整流程）

## 📄 许可证

[MIT](LICENSE) —— 自由使用、修改、再分发、商用。

---
 **此项目正在参加[江苏省OPC创新创业大赛](https://www.opcjs.com/)青少年AI黑客松专项活动** 

---
## 🔩 项目声明
此段文本始终放在 **README.md** 最后

### 项目定位
BlockCanvas 是一个由 **个人开发者发起** 并 **长期维护** 的 **开源** 项目。  
目前项目 **不以商业化为目标** ，主要用于学习、实验和个人工具探索。  
欢迎学习、交流与反馈，但请注意：本项目采用 MIT 许可证，任何人都可以自由使用、修改、分发，包括用于商业目的。

### 许可证
本项目采用 [MIT 许可证](LICENSE)。

这意味着你可以自由使用、复制、修改、合并、发布、分发，甚至用于商业目的，  
唯一的要求是 **保留原始版权声明和 MIT 许可证文本** 。

项目目前由个人开发者维护，不以商业化为目标，  
但这不影响 MIT 许可证赋予任何人的商业使用权利。

### 维护与更新
本项目是一个 **长期项目** ，我会 **持续迭代** 和 **改进** 。

### 贡献与反馈
欢迎提交 Issue 或 Pull Request。  
如果你是学习者，也欢迎直接 Fork 本项目进行自己的实验。  
我们开设了[PFFD平台](https://pffd.html-5.me)，欢迎各位前来提交使用反馈。

### 免责声明
本项目为个人开源项目，按“原样”提供，不提供任何明示或暗示的担保。  
使用本项目产生的任何后果由使用者自行承担。

### AI 使用说明
在开发过程中，我使用了 AI Agent 工具进行了基本全部代码编写，文档更新，调试。
所有核心功能、架构决策和最终代码均由我本人审核和整合。