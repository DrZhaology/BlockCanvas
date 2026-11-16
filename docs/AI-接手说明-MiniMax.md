# BlockCanvas · AI 接手说明（写给 MiniMax M3.1 Flash）

> 这份文档是**交接件**：给新接手的 AI（本文指 MiniMax M3.1 Flash）快速建立全局认知。
> 它不替代 `README.md` / `docs/开发历程.md`，而是把"上手前必须先知道的规矩"集中在一处。
>
> 建立时间：2026-11-15　|　项目版本：**v0.4.6**（阶段 6 · 架构重构与 Web 版上线）
> 当前分支：`alpha`（开发线，领先 `main` **148** 个提交；`main` 另有 8 个发布提交不在 alpha 上）
> 最后一笔功能提交：`e3abc6d v0.4.6 第四十二批：会话缩略图真的画出来了`

---

## 0. 先记住这四句话（用户原话级别）

1. **程序架构是 Electron + React + TypeScript，UI 全部用 CSS 写。**
2. **不要随便改版本号**，当前是 **v0.4.6**。
3. **提交规律**：所有小版本测试开发中的 commit 全部落在 `alpha` 分支；
   只有当用户说"准备发布 / 我说发布"时，才把这一版 commit 到 `main`。
4. **不要随便乱作界面**，UI 始终保持人性化、美观、统一。

---

## 1. 项目是什么

**BlockCanvas 积木画布** = 可视化静态网页构建工具（Electron 桌面版 + 网页版）。

- 用户在画布上摆元素、改样式，导出成 HTML / HTML+工程 / 整站文件夹。
- 工程文件是 `.bcproj`（ZIP 容器，`SCHEMA_VERSION = 2`）。
- 纯便携：所有运行时数据写 `data/`，不写系统目录。
- 作者：Dr.Zhaology，MIT 许可，参与江苏省 OPC 创新创业大赛。
- **本项目几乎全部代码由 AI 写成**，作者本人审核整合 —— 所以"AI 改代码"是常态流程，不是例外。

---

## 2. 架构地图

### 2.1 三进程（electron-vite 构建）

```
src/main/        Electron 主进程
  main.ts        只剩编排（建窗/菜单/协议/生命周期/注册调用），394 行
  ipc/           按域拆分的 IPC：extensions/export/project/system/update/data/context
  projectFile.ts .bcproj 容器读写（27kb，核心）
  storage.ts     便携存储与缓存治理
  updater.ts     自动更新（34kb，最大的一块）
  codecProbe.ts  视频编码容器头探测（挂 <video> 之前判能不能解）
src/preload/     window.bc 桥（preload.ts，12.9kb）
src/renderer/    React 渲染层（**零 node:* / 零 electron import**）
src/adapter/     宿主适配器：Electron 用 preload 的 window.bc；浏览器用 IndexedDB 实现
```

**关键设计**：渲染层不依赖 Electron，所以同一份渲染层能跑在两种宿主里。

| 能力 | 桌面版 | 网页版 |
|---|---|---|
| 工程存取 | 磁盘 `.bcproj` | IndexedDB |
| 导出 | 写磁盘 / 目录 | 触发下载 |
| 插件 | 加载本地插件目录 | 不加载（明确返回"网页版不可用"） |
| 自动更新 | 有 | 无（刷新即最新） |

宿主检测：`src/adapter/index.ts` 的 `detectHost()` → 有 `window.bc` 就是 Electron，否则注入浏览器实现。
必须在 `render()` 之前调用（App 一挂载就调 `window.bc.getSession()`）。

### 2.2 渲染层内部

```
renderer/
  App.tsx            1245 行   外壳组装（页签栏/工具栏/工作区/全屏页路由）
  components/        各界面组件（~110 个）
    canvas/          画布域（CanvasNode / useAltDrag / altDragMove / walls / useMarquee / geometry）
    inspector/       属性面板域（ElementPropsBody / PageCssBody / sections/ / rows/）
    portrait/        竖屏域（PortraitBars / PortraitLayers / SessionsView）
  lib/               纯逻辑（exporter / styleClass / tableOps / propertySchema / designTokens / pluginHost …）
  store/             zustand：sceneStore / tabStore / toolbarStore / taskStore / updateStore
                     store/scene/ 下是可单测的纯逻辑（factory/tree/style/childStyles/sync/structure/history）
  styles/            37 个 CSS 分片 + domains.ts（域索引）+ animations.css（唯一动画定义处）
  assets/icons/     140 个 svg，一个图标一个文件（`pnpm icons:gen` 生成 Icon.tsx）
```

### 2.3 关键设计决策（改代码前要知道，否则会破坏）

- **画布渲染与 HTML 导出共用 `lib/styleClass.ts` 同一套逻辑** —— 改样式生成规则时两边一起考虑。
- **CSS 分片顺序 = `main.tsx` 的 import 顺序 = 级联顺序，不许调序。**
  `00-theme-tokens.css` 必须**最后**加载（它要覆盖 foundation 里同名的旧变量）。
- **动画只在 `animations.css` 定义**（token `--dur-*` / `--ease-*` + 全部 `@keyframes`），
  分片里只写 `animation: bcXxx var(--dur-*) var(--ease-*)` 引用。
- **外壳轴 / 输入轴已拆开**（v0.4.6 架构评审的结论）：
  - `data-shell="split|stack"` —— 只看窗口宽度（900px 断点），管布局。
  - `data-input="pointer|touch"` —— 只看设备能力（`hover/pointer` 媒体查询），管触摸目标。
  - 组件里**不许**再出现 `if (narrow) 用触摸实现`。
- **CSS 域索引 `styles/domains.ts`**：每个分片登记主域，探针会查"选择器跑错域"和"跨域重复不超基线"。

---

## 3. 当前进度（截至 2026-11-15）

### 3.1 版本状态

| 项 | 值 |
|---|---|
| 版本号 | **0.4.6**（唯一真源：根目录 `version.json`） |
| 阶段 | 阶段 6 · 架构重构与 Web 版上线（正式版） |
| 分支 | `alpha`（开发），`main`（发布台账，一版一提交） |
| alpha 领先 main | 148 个提交（`main` 另有 8 个发布提交） |
| 提交批次 | 已到 **第四十二批**（`v0.4.6 第N批：xxx`） |
| 工作区 | 干净，仅 1 个未跟踪的探针残留 `tests/e2e/thumb-probe.txt`（运行产物，可删） |
| 类型检查 | `tsc --noEmit` **0 错**（本次接手实测） |

### 3.2 v0.4.6 已完成的大项

| 编号 | 内容 | 状态 |
|---|---|---|
| R6-1 | `Canvas.tsx` 2431 → 351 行（拆成 `canvas/*` 8 个模块） | ✅ |
| R6-2 | `Inspector.tsx` 2467 → 174 行（拆成 `inspector/*`） | ✅ |
| R6-3 | CSS 域约束（`domains.ts` + `probe-css-domains`），停在"可校验" | ✅ |
| R6-4 | `main.ts` 1722 → 479 行（拆成 `ipc/*` 8 个域） | ✅ |
| R6-5 | `sceneStore.ts` 1636 → 1135 行（纯逻辑进 `store/scene/`，可单测） | ✅ |
| R6-6 | 图标系统：140 个 svg 一图标一文件 + 生成器校验 | ✅ |
| R6-11/13/14 | 网页版上线（`pnpm build:web` → 单文件 `dist-web/index.html` ~2MB） | ✅ |
| R6-16 | fixed "空气墙"根治（基准视口高度 + 首屏线） | ✅ |
| R6-17 | sticky 可视化（armed/idle 角标 + 警示色） | ✅ |
| R6-18 | 视频编码判定改为"以本机能力为准"（挂 `<video>` 之前读容器头） | ✅ |
| 第 25～42 批 | 竖屏外壳重做、两条底部操作栏、图层下移、设置页两级导航、会话页重做、缩略图保真、程序内预览 … | ✅ |

### 3.3 仍然偏大的文件（下一步的候选靶子）

| 文件 | 行数 | 说明 |
|---|---|---|
| `components/Settings.tsx` | 1708 | 设置页，两级导航刚重做过 |
| `components/TableEditor.tsx` | 1688 | 表格编辑器 |
| `renderer/App.tsx` | 1245 | 外壳组装（天然长） |
| `store/sceneStore.ts` | 1139 | 纯逻辑已抽完，再拆要重构每个 action 体 |
| `lib/propertySchema.ts` | 922 | 属性表定义 |
| `components/QuickHelper.tsx` | 912 | 快捷助手 |
| `components/EmptyHome.tsx` | 910 | 空首页 |
| `components/ProjectsCenter.tsx` | 862 | 项目中心 |
| `components/ElementPanel.tsx` | 839 | 元素面板 |
| `styles/36-v046-portrait.css` | 1323 | 竖屏样式 |

### 3.4 已知未完成（权威清单在各文档，这里只列入口）

- `docs/待办与已知问题.md` —— 素材库打包进 `.bcproj`、图库面板、音频元素、外部工程登记、
  损坏工程三出口、多页工程、路径基准、更新器单实例/日志/未保存拦截、深色模式插件化、打包分发。
- `docs/设计规范-界面基线.md` §10 —— 全站色板收敛（594 处裸 `border-radius`）、217 条跨域重复选择器合并、
  全局动效体系重做、sticky 真实滚动预览。
- `docs/架构-横竖屏与输入模式.md` §8"还没做的" —— CSS 方向翻转的其余层次、输入适配器（长按/双指/手势冲突）、
  竖屏逐屏打磨、画布 fit-width。
- `docs/v0.4.6-竖屏重做-体验清单.md` 末尾 —— 两条待用户拍板（更多菜单项配置形式、第一条栏按页面细化）、
  两条"还能更好"（双指缩放无惯性、程序内预览）。

### 3.5 竖屏重做（第五轮反馈）的未决项

- 「把哪些更多菜单项放到栏上」：勾选清单（顺序固定）还是拖拽排序 —— **等用户拍板，别自作主张**。
- 「第一条栏按页面细化」：设置页/手册/项目中心/预览页各自该给哪几个按钮 —— **等用户拍板**。

---

## 4. 铁律（违反会返工 / 出事故）

### 4.1 版本号

- **唯一真源是根目录 `version.json`**（`version` + `stage` 两个字段）。
  `package.json` 的 `version` 由 `tools/sync-version.mjs` 同步（`prebuild` 自动跑，`pnpm version:check` 校验）。
- **不要随便改版本号。** 当前是 `0.4.6`。用户没说"升版本"就不要动 `version.json`。
- 版本号规则：`0.X.X` = 阶段测试版，`X.X` = 正式版。

### 4.2 Git 节奏

| 分支 | 角色 | 谁能动 |
|---|---|---|
| `alpha` | 开发线，**所有日常 commit 都落这里** | AI 日常提交 |
| `main` | 发布台账，**一个小版本一条提交** | **只有用户说"准备发布"时才动** |
| `backup-*` / `rescue-wip` / `backup-v042` | 历史快照，只读 | 不动 |

- 开发线的 commit 一律在 `alpha` 上；**绝不擅自 merge 到 main、绝不 push、绝不打 tag**
  （push/tag/Release 由用户主导）。
- 发布那天的动作（用户明确说发布后才做）：
  ```bash
  git branch backup-main-$(Get-Date -Format yyyyMMdd) main
  git switch main
  git read-tree -u --reset alpha
  git commit -m "v0.4.6: <一句话总结这一版>"
  ```
- **每轮收尾必 commit**（哪怕只是小修）—— 工作树上悬着的改动就是风险敞口
  （v0.4.1 曾发生 39 个组件文件被整批误删，靠 git 存档零损失恢复）。
- 高风险操作（批量删/移/改名文件、`git checkout/reset/clean` 丢改动、大规模重构、
  脚本批量改写源文件）**执行前必须先 commit 或 stash**。
- 提交信息格式（沿用现有规律）：
  `v0.4.6 第N批：<一句话说清做了什么>（<可选：附带修好的 bug>）`
- 切分支前先 `git status`；`pnpm git:doctor` 是本仓库的忽略规则体检（切分支自动跑）。
- 详见 `docs/Git分支使用说明.md`。

### 4.3 代码硬性约定（README ② 的 12 条，摘关键）

1. **代码里不许出现 `!important`** —— 要覆盖就提高选择器特异性。
2. **动画只在 `animations.css` 定义**，分片只写引用；禁止无限闪烁；
   reduced-motion 靠 `:root` 的 token 归零实现（零 `!important`）。
3. 新增样式写进**语义对应**分片末尾；跨轮追加统一进 `14-v04x-append.css`；**import 顺序不许调**。
4. **全屏弹窗一律 `createPortal` 到 `document.body`**（祖先 transform 会劫持 `position: fixed`）。
5. 画布渲染与导出共用 `lib/styleClass.ts`。
6. 用户网页的设计变量一律 `--bc-*` 前缀，与软件自身 UI 变量（`--accent` 等）严格分开。
7. 用户可开关/折叠的状态必须持久化，统一走 `lib/usePersisted.ts`（`bc-flag:` 前缀）。
8. 插件改动要同步三处副本：`builtin-extensions/`、`data/extensions/`、`dist/win-unpacked/data/extensions/`。
9. 导出代码要干净：类名/关系选择器优先；伪类样式必须有类名/ID/关系选择器才能在导出后生效。
10. `build-exe.ps1` 等 PowerShell 脚本必须存成 **UTF-8 带 BOM**（否则 WinPS 5.1 按 GBK 解码中文注释 → 语法错误）。
11. 块级容器默认 padding 必须写 **4 个 longhand**（四值输入读 longhand）。
12. 状态选择器不要返回新数组/新对象（zustand + useSyncExternalStore 会误判变化）；
    给动态 `<Tag>` 传 ref 会 TS2590，量 DOM 用 `data-bc-id` 查询。
    另：`.canvas` 必须保持 `position: relative`。

### 4.4 结构防回退（`probe-arch` 盯着，改名/搬文件要留意）

- `canvas/` 每文件 ≤600 行、组装层 ≤400 行、纯计算层不许 import React；
- `inspector/` 每文件 ≤600 行、外壳 ≤400 行、行组件不反向依赖区块组件；
- `store/scene/` 每文件 ≤400 行、不反向依赖 `sceneStore.ts`；
- `main/ipc/` 每文件 ≤400 行、每域都导出 `register*Ipc()`、`main.ts` ≤620 行；
- `styles/domains.ts` 必须存在，新增 CSS 分片必须登记主域。

---

## 5. UI 原则（用户第 4 条铁律的展开）

权威文件：`docs/设计规范-界面基线.md`（设计规范 v1）。要点：

0. **这是一个产品，不是管理后台。** 答不上"用户此刻在做什么"的元素，删掉。
1. **连续曲率圆角**：Electron 38 内核原生支持 `corner-shape: squircle`，全局已开；
   画布里的用户页面强制 `corner-shape: round`（编辑器不许偷偷改用户的稿子）；
   必须是正圆的少数元素挂 `.bc-round`；新代码**只写圆角变量**（`--r-1`…`--r-5`、`--r-pill`）。
2. **不许"盒子套盒子"**：一个视觉区域内只允许一层"框"，其余用留白/底色/分隔线表达。
3. **颜色纪律**：一屏之内主色只给"这一屏最该点的那个东西"；状态色只用于状态不用于装饰；
   组件只写语义变量，不写 `html[data-bc-dark]` 分支。
4. **按钮与信息层级**：一个区域一个主动作；动词在前名词在后；按钮不许孤零零漂在空白里；
   同一屏按钮高度一致（28/32/36 三档）；图标按钮必须有 tooltip。
5. **交互反馈**：可点的东西必须有 hover + active；拖动要按下即给"正在拖"的视觉态；
   数值输入框滚轮调值（Shift ×10）、失焦一次提交 = 一条撤销；长任务走进度；做不到的事**明确说不可用**。
6. **自绘滚动条**：`.app` 内原生滚动条彻底隐藏，自绘滑块 `position: fixed` 脱离文档流；
   **例外**：`.canvas` 里的用户页面保留原生滚动条。
7. **竖屏**：触摸目标 ≥44×44、抽屉而非挤压、手势可打断动画、防误触（宁可晚 60ms 也不吃滚动）；
   工具栏可放两行，不要横向挤压；设置页按 横屏/竖屏/公共 三块分区。
8. **窗口**：无系统标题栏（自绘 36px 高），主题色只做 1px 描边不铺满；
   全屏页面必须从标题栏下方开始（不许 `position:absolute; inset:0` / `height:100vh`）。

---

## 6. 模型分工（用户第 1 条：主模型不擅长就开子 Agent）

主模型是 **MiniMax M3.1 Flash**。子 Agent 统一用：

```
agent:  general
model:  opencode/deepseek-v4.1-flash-free      ← DeepSeek V4.1 Flash Free
```

（该模型擅长 Electron + React + TypeScript + CSS 这套栈。）

### 6.1 我自己能做好的（不必开子 Agent）

- 读代码 / 定位问题 / 读日志与探针输出 / 分析架构与数据流；
- 写文档（开发历程、体验清单、发行说明、接手说明）；
- 一行到十几行的小改动（改文案、调常量、加一条断言、补一个 CSS 变量）；
- 跑探针、跑 typecheck、跑 build、读截图目录、汇总结果；
- 拆任务清单、设计验收断言、把大任务切成互不重叠的小任务；
- 翻译/摘要长文档。

### 6.2 应该扔给 DeepSeek 子 Agent 的（拆成小任务）

- **多文件 React 组件的重构/新增**（尤其 >200 行的新组件、要跟现有 110 个组件保持风格一致）；
- **大段 CSS 改动**（分片搬迁、竖屏适配、动画补齐、"基础 + 宽屏加成"翻转）；
- **复杂 TS 逻辑**（几何计算、手势状态机、导出器、插件宿主）；
- **Electron 主进程 / preload 深层改动**（IPC 通道、协议、窗口行为、更新器）；
- **表格引擎、样式类系统**这类"算法 + 表现"耦合的地方。

### 6.3 拆分原则（拆不好子 Agent 也会翻车）

1. **一个子 Agent = 一个自包含的小问题**，不与其他任务共享未定义的状态；
2. **子 Agent 必须知道**：要改哪些文件、不能碰哪些文件、遵守哪几条铁律、改完怎么验收；
3. **验收要能自动化**：尽量让它顺手写/改一条探针断言，或明确给出人工验收步骤；
4. **不要让两个子 Agent 同时改同一个文件**；
5. 子 Agent 的产出要由我**复核**（读 diff、跑探针、跑 typecheck）后才能提交；
6. 复杂改动拆成**可独立回滚**的批次，仿照现有"第 N 批"节奏。

---

## 7. 每轮工作流

```
① 读      → README「AI 协作导航」+ docs/开发历程.md 最新 1~2 轮 + 相关 docs
② 拆      → 把用户的需求切成互不重叠的小任务，标出哪些我自己做、哪些派子 Agent
③ 做      → 遵守第 4 节铁律；遵守第 5 节 UI 原则；先 commit 再做高风险操作
④ 验      → tsc --noEmit  +  electron-vite build  +  相关探针  +  截图脚本（UI 改动必跑）
⑤ 记      → docs/开发历程.md 顶部追加本轮条目（问题 → 根因 → 方案，按现有格式）
⑥ 交      → alpha 分支 commit（信息格式见 4.2），清理临时脚本（按文件名精确删，别用通配符）
```

**收尾双验证（README ⑥）**：
```bash
node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ./node_modules/electron-vite/bin/electron-vite.js build
```

---

## 8. 测试与验收命令

```bash
pnpm typecheck                  # tsc --noEmit
pnpm build                      # electron-vite build（prebuild 会自动同步版本号 + 生成图标）
pnpm build:web                  # 网页版单文件 → dist-web/index.html
pnpm test:unit                  # 毫秒级单测：table-ops / scene-logic / codec-probe
pnpm test:probe                 # 全量 67 个探针（约十分钟，失败自动重试一次）
pnpm test:probe:once            # 不重试（排查真问题）
node tests/e2e/probe-arch.mjs   # 只跑某个探针
node tests/e2e/shots-ui-full.mjs     # 17 屏全量 UI 截图 + 横向溢出条数
node tests/e2e/shots-portrait-menus.mjs
pnpm git:doctor                 # 忽略规则体检
```

**探针体系是这个项目的命脉**：60+ 个行为探针 + 若干结构探针（`probe-arch` / `probe-css-domains`）
+ 3 个单测。改结构时优先"加断言"而不是"加注释"。

**已知的既有波动（不是回归，别误判）**：
- `probe-alt-interact` 的「relative 拖到中线 → margin auto」单条在相同代码下 29–33 之间浮动（合成拖动差几像素）。
- `probe-table` 偶发启动即失败（上一条 Electron 刚退出、临时目录被锁），单跑必过。

---

## 9. 已知坑（踩过一次的，别再踩）

| 坑 | 说明 |
|---|---|
| `ELECTRON_RUN_AS_NODE=1` | 在 Electron 系终端里很常见，会让 Electron 退化成纯 Node，Playwright 报 `Process failed to launch!`。探针脚本自带剔除逻辑 |
| 清理脚本别用通配符 | v0.4.6 里执行 `Remove-Item tools\*.mjs` 把 13 个常用脚本全删了（含构建必需的 `gen-icons.mjs`）。**按文件名精确删** |
| 切分支后要重新构建 | `out/`、`node_modules/` 是被忽略的，切分支不会同步 → 旧代码 + 新产物的错觉 |
| `.gitignore` 跟着分支走 | `main` 上会突然冒出未跟踪的截图目录。`.git/info/exclude` 里有分支无关的兜底，别删 |
| CSS 分片 import 顺序 | `main.tsx` 里顺序 = 级联顺序；`00-theme-tokens.css` 必须最后（覆盖 foundation 的同名旧变量） |
| 探针断言绑定文件位置会误报 | v0.4.6 拆分后踩过两次。**断言"行为还在"，不绑定"文件在哪"** → 改成读目录 |
| 脚本批量改写源文件 | 历史教训：脚本切错区间会破坏相邻代码。高风险操作前先 commit |
| Windows 中文文件名截图 | `tests/e2e/shots*/` 下的中文名在某些终端显示为乱码，属显示问题不影响功能 |

---

## 10. 快速上手清单

- [ ] 读 `README.md` 的「AI 协作导航」一节（①~⑥）
- [ ] 读 `docs/开发历程.md` 最新 1~2 轮（了解刚发生了什么、哪些方案被否过）
- [ ] 读 `docs/设计规范-界面基线.md`（改 UI 前必读）
- [ ] 读 `docs/架构-横竖屏与输入模式.md`（碰外壳/竖屏/手势前必读）
- [ ] 读 `docs/v0.4.6-竖屏重做-体验清单.md`（了解用户最近在盯什么）
- [ ] 确认 `git status` 干净、在 `alpha` 分支
- [ ] 跑一次 `pnpm typecheck` 确认基线绿

---

*本文档由接手方维护；与项目事实冲突时，以代码与 `docs/开发历程.md` 为准，并回来修正本文档。*
