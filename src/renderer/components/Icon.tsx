import type { ReactNode } from 'react';

// BlockCanvas · 线性图标集（自绘，Fluent / Windows 11 风格）
// 统一 24×24 网格、1.7px 描边、圆头圆角，颜色继承 currentColor，
// 这样在浅色 / 深色主题下都能自动适配，也方便用主色强调。
//
// 设计规矩（2026-10 设计语言更新）：
//   · 只用 1~2 种颜色（currentColor + 局部 fill 点缀），最多 3 种；
//   · 简单直白：一眼能看出含义，不做装饰性细节；
//   · 全部通过 <Icon name="…" /> 使用，界面里不再出现 Emoji。

export type IconName =
  // —— 原有（设置页等已使用）——
  | 'palette' | 'sliders' | 'database' | 'tool' | 'puzzle' | 'info'
  | 'moon' | 'outline' | 'pageReset' | 'headingReset' | 'layout' | 'ruler'
  | 'bolt' | 'tag' | 'broom' | 'trash' | 'clock' | 'package' | 'globe'
  | 'refresh' | 'folder' | 'plug' | 'importFolder' | 'importZip' | 'plus' | 'external'
  | 'keyboard' | 'sparkle'
  // —— 2026-10 设计语言更新：通用动作 ——
  | 'close' | 'minus' | 'check' | 'warning' | 'block' | 'lightbulb'
  | 'chevronUp' | 'chevronDown' | 'chevronLeft' | 'chevronRight'
  | 'undo' | 'redo' | 'scissors' | 'copy' | 'paste'
  | 'save' | 'bookmark' | 'download' | 'play' | 'gear' | 'pencil'
  | 'calendar' | 'grip' | 'wand' | 'target' | 'search' | 'plusCircle'
  // —— 设备与视口 ——
  | 'laptop' | 'tablet' | 'phone' | 'monitor' | 'responsive'
  // —— 文件与结构 ——
  | 'folderOpen' | 'file' | 'image' | 'video' | 'layers' | 'grid' | 'menu'
  | 'merge' | 'split' | 'star'
  // —— 状态 ——
  | 'eye' | 'eyeOff' | 'lock' | 'lockOpen' | 'activity'
  // —— 方向与变换 ——
  | 'arrowUp' | 'arrowDown' | 'arrowLeft' | 'arrowRight'
  | 'swirl' | 'sun' | 'moonDark' | 'expand' | 'shrink'
  | 'ring' | 'square' | 'diamond' | 'feather' | 'lantern' | 'hole'
  | 'rotate' | 'balloon' | 'bounce'
  // —— 2026-10 第二轮补充：替换界面里剩下的字符图标 ——
  | 'pin' | 'hand' | 'folderTree' | 'radio' | 'link' | 'hash' | 'comment' | 'note'
  | 'timer' | 'hourglass' | 'rocket' | 'contrast' | 'circleDot' | 'circle' | 'health'
  | 'home' | 'history' | 'option' | 'command' | 'tab' | 'enter' | 'highlighter'
  | 'text' | 'rect' | 'fill' | 'rows' | 'columns' | 'collapse' | 'printer' | 'burst'
  | 'swap' | 'book' | 'indent' | 'outdent' | 'zoomIn' | 'gradient' | 'cloud' | 'glasses'
  | 'list' | 'quote' | 'dot' | 'code' | 'heading' | 'bold' | 'italic' | 'camera' | 'cross';

const P: Record<IconName, ReactNode> = {
  palette: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-6.7-9-6.7Z" />
      <circle cx="7.5" cy="11" r="1.1" />
      <circle cx="10.5" cy="7.5" r="1.1" />
      <circle cx="15" cy="8.2" r="1.1" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 7h14M5 12h14M5 17h14" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  tool: (
    <>
      <path d="M14.5 4.5a4.5 4.5 0 0 0 5.6 6L21 19a2 2 0 1 1-2.8 2.8L10.5 13a4.5 4.5 0 0 1-6-5.6l3.2 3.2 2.8-2.8L7.3 4.6a4.5 4.5 0 0 1 7.2-.1Z" />
    </>
  ),
  puzzle: (
    <>
      <path d="M10 4.5a1.8 1.8 0 1 1 3.6 0V6h3.4a1 1 0 0 1 1 1v3.4h1.5a1.8 1.8 0 1 1 0 3.6H18V18a1 1 0 0 1-1 1h-3.4v-1.5a1.8 1.8 0 1 0-3.6 0V19H6.6a1 1 0 0 1-1-1v-3.4H4.1a1.8 1.8 0 1 1 0-3.6h1.5V7a1 1 0 0 1 1-1H10V4.5Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  moon: (
    <>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </>
  ),
  outline: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" strokeDasharray="3.4 2.6" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </>
  ),
  pageReset: (
    <>
      <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
      <path d="M13.8 3.6V8h4.5" />
      <path d="M8.5 15.5h7" />
    </>
  ),
  headingReset: (
    <>
      <path d="M5.5 5.5v13M13 5.5v13M5.5 12h7.5" />
      <path d="M17 9.5c1.6 0 2.5 1 2.5 2.4V18M19.5 13.6c-3 .1-4.6.9-4.6 2.4 0 1.2.9 2 2.2 2 1.3 0 2.4-.9 2.4-2.4" />
    </>
  ),
  layout: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M10 9.5v10" />
    </>
  ),
  ruler: (
    <>
      <rect x="2.5" y="8.5" width="19" height="7" rx="1.5" />
      <path d="M7 8.5v3M11 8.5v3M15 8.5v3M19 8.5v3" />
    </>
  ),
  bolt: (
    <>
      <path d="M13.5 3 6 13.2h4.8L9.8 21 18 10.6h-5L13.5 3Z" />
    </>
  ),
  tag: (
    <>
      <path d="M11.6 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7.4a2 2 0 0 1-.6 1.4l-6.6 6.6a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1 0-2.8l6.7-6.6a2 2 0 0 1 1.4-.5Z" />
      <circle cx="16" cy="8" r="1.4" />
    </>
  ),
  broom: (
    <>
      <path d="M14.5 3.5 20 9M12.4 8.6l3-3 3 3-3 3-3-3Z" />
      <path d="M11.6 10.4 5 17l2 2 6.6-6.6" />
      <path d="M4.5 19.5h6" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" />
      <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
      <path d="M10.3 10v6.6M13.7 10v6.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  package: (
    <>
      <path d="M20.5 8.2v7.6a1.6 1.6 0 0 1-.8 1.4l-6.9 3.9a1.6 1.6 0 0 1-1.6 0l-6.9-3.9a1.6 1.6 0 0 1-.8-1.4V8.2" />
      <path d="m3.9 7.4 7.3-4.1a1.6 1.6 0 0 1 1.6 0l7.3 4.1-8.1 4.6-8.1-4.6Z" />
      <path d="M12 12.4V21" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5Z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M4 12.5A8 8 0 0 0 17.7 17.7L20 15.5" />
      <path d="M20 20v-4.5h-4.5" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h3.3l2 2.2h8.3c1 0 1.7.8 1.7 1.7v8.9c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7V7.2Z" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3.5v5M15 3.5v5" />
      <path d="M6.5 8.5h11v2.2a5.5 5.5 0 0 1-5.5 5.5 5.5 5.5 0 0 1-5.5-5.5V8.5Z" />
      <path d="M12 16.2v4.3" />
    </>
  ),
  importFolder: (
    <>
      <path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h3.3l2 2.2h8.3c1 0 1.7.8 1.7 1.7v8.9c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7V7.2Z" />
      <path d="M12 10.6v5.6M9.6 13.8 12 16.2l2.4-2.4" />
    </>
  ),
  importZip: (
    <>
      <path d="M6.5 3.5h8L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.6V8h4.6" />
      <path d="M11.5 11v5M9.6 14.1l1.9 1.9 1.9-1.9" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5 11 13" />
      <path d="M17.5 14v4.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H10" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M18 13.5h.01M9.5 14h5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z" />
      <path d="M18.5 16.5 19.3 19l2.2.8-2.2.8-.8 2.4" />
    </>
  ),
  // —— 通用动作 ——
  close: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
  minus: (
    <>
      <path d="M5 12h14" />
    </>
  ),
  check: (
    <>
      <path d="M4.5 12.5 10 18 19.5 6.5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 2.8 19.2a1.2 1.2 0 0 0 1 1.8h16.4a1.2 1.2 0 0 0 1-1.8L12 4Z" />
      <path d="M12 10v4.6" />
      <circle cx="12" cy="17.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.5 6.5 17.5 17.5" />
    </>
  ),
  lightbulb: (
    <>
      <path d="M12 3.5a5.5 5.5 0 0 1 3.2 10c-.6.4-.9 1-.9 1.7v.8h-4.6v-.8c0-.7-.3-1.3-.9-1.7a5.5 5.5 0 0 1 3.2-10Z" />
      <path d="M10 19h4M10.8 21.2h2.4" />
    </>
  ),
  chevronUp: (
    <>
      <path d="m5.5 15 6.5-6.5L18.5 15" />
    </>
  ),
  chevronDown: (
    <>
      <path d="m5.5 9 6.5 6.5L18.5 9" />
    </>
  ),
  chevronLeft: (
    <>
      <path d="M15 5.5 8.5 12l6.5 6.5" />
    </>
  ),
  chevronRight: (
    <>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 5.5 4 10l4.5 4.5" />
      <path d="M4 10h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15.5 5.5 20 10l-4.5 4.5" />
      <path d="M20 10H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="M8.7 8.2 20 19M8.7 15.8 20 5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5v8.5A1.5 1.5 0 0 0 5.5 15h.5" />
    </>
  ),
  paste: (
    <>
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <path d="M9 4.5V3.4c0-.5.4-.9.9-.9h4.2c.5 0 .9.4.9.9v1.1" />
      <path d="M8.5 10.5h7M8.5 14h5" />
    </>
  ),
  save: (
    <>
      <path d="M5 3.5h11.5l3 3V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z" />
      <path d="M7.5 3.5V9h8V3.5" />
      <path d="M7.5 20v-5.5h9V20" />
    </>
  ),
  bookmark: (
    <>
      <path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4.5L5.5 21V4.5a1 1 0 0 1 1-1Z" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5V15M7.4 10.6 12 15.2l4.6-4.6" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  play: (
    <>
      <path d="M7 4.8v14.4a.9.9 0 0 0 1.37.77l11.5-7.2a.9.9 0 0 0 0-1.54l-11.5-7.2A.9.9 0 0 0 7 4.8Z" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M14.5 5.5 18.5 9.5 8 20H4v-4L14.5 5.5Z" />
      <path d="m13 7 4 4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17.5" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  wand: (
    <>
      <path d="M4.5 19.5 15.5 8.5" />
      <path d="m16.5 3 .9 2.6L20 6.5l-2.6.9-.9 2.6-.9-2.6L13 6.5l2.6-.9L16.5 3Z" />
      <path d="m6.5 4.5.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7L4.2 6.8l1.7-.6.6-1.7Z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  plusCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  // —— 设备与视口 ——
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="10" rx="1.5" />
      <path d="M3 18.5h18" />
    </>
  ),
  tablet: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.2" />
      <path d="M10 6.2h4" />
      <circle cx="12" cy="17.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  phone: (
    <>
      <rect x="7.8" y="3" width="8.4" height="18" rx="2.2" />
      <path d="M10.6 5.4h2.8" />
      <path d="M10.5 18.4h3" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12.5" rx="1.5" />
      <path d="M9.5 20.5h5M12 17v3.5" />
    </>
  ),
  responsive: (
    <>
      <rect x="3.2" y="6" width="17.6" height="12" rx="2" />
      <path d="M7.4 12h9.2" />
      <path d="m10 9.4-2.6 2.6L10 14.6M14 9.4l2.6 2.6L14 14.6" />
    </>
  ),
  // —— 文件与结构 ——
  folderOpen: (
    <>
      <path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h3.3l2 2.2h6.3c1 0 1.7.8 1.7 1.7v1.1" />
      <path d="M3.5 9.5h17l-1.6 8.6a1.6 1.6 0 0 1-1.6 1.4H5.5a1.6 1.6 0 0 1-1.6-1.4L3.5 9.5Z" />
    </>
  ),
  file: (
    <>
      <path d="M6.5 3.5h8L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.6V8h4.6" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m5.5 17.5 4.5-4.5 3.5 3.5 2.5-2.5 2.5 2.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10.5 5-2.9v8.8l-5-2.9" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.7L12 12.9 3.5 8.2 12 3.5Z" />
      <path d="m4.5 12.2 7.5 4.1 7.5-4.1" />
      <path d="m4.5 16.2 7.5 4.1 7.5-4.1" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" />
    </>
  ),
  menu: (
    <>
      <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
    </>
  ),
  merge: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" />
      <rect x="13" y="13" width="7" height="7" rx="1.2" />
      <path d="M11 11h2v2h-2z" fill="currentColor" stroke="none" />
    </>
  ),
  split: (
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="1.5" />
      <path d="M12 4.5v15" />
    </>
  ),
  star: (
    <>
      <path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.8Z" />
    </>
  ),
  // —— 状态 ——
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4.5 4.5l15 15" />
      <path d="M9.8 6.3A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a16.6 16.6 0 0 1-3 3.6M6.2 8.2A16.8 16.8 0 0 0 2.5 12S6 18 12 18c1.2 0 2.3-.24 3.3-.63" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  lockOpen: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 7.7-1.5" />
    </>
  ),
  activity: (
    <>
      <path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" />
    </>
  ),
  // —— 方向与变换 ——
  arrowUp: (
    <>
      <path d="M12 20V5M6.5 10.5 12 5l5.5 5.5" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 4v15M6.5 13.5 12 19l5.5-5.5" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M20 12H5M10.5 6.5 5 12l5.5 5.5" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5" />
    </>
  ),
  swirl: (
    <>
      <path d="M12 3.5c4.7 0 8.5 3.8 8.5 8.5s-3.8 8.5-8.5 8.5S3.5 16.7 3.5 12c0-3 1.5-5.4 3.8-6.6" />
      <path d="M8.5 8.3a4.6 4.6 0 1 0 5.9-1.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    </>
  ),
  moonDark: (
    <>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor" stroke="none" />
    </>
  ),
  expand: (
    <>
      <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 14.5 9.5M4.5 19.5l5-5" />
    </>
  ),
  shrink: (
    <>
      <path d="M19.5 10H14V4.5M4.5 14H10v5.5M14 10l5.5-5.5M10 14 4.5 19.5" />
    </>
  ),
  ring: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.5" strokeDasharray="2.4 2.2" />
    </>
  ),
  square: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
    </>
  ),
  diamond: (
    <>
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" />
    </>
  ),
  feather: (
    <>
      <path d="M19.5 4.5c-2.5-2.5-6.4-1.8-8.8.6L5 10.8V19h8.2l5.7-5.7c2.4-2.4 3.1-6.3.6-8.8Z" />
      <path d="M4.5 19.5 19 5M11 10.5h6.5" />
    </>
  ),
  lantern: (
    <>
      <path d="M9 4.5h6M12 3v1.5" />
      <path d="M8 4.5h8l-1 2.2H9L8 4.5Z" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="11.5" rx="4.5" ry="5" />
      <path d="M9 16.3l1 2.7h4l1-2.7M12 21.2V19" />
    </>
  ),
  hole: (
    <>
      <ellipse cx="12" cy="12" rx="8" ry="5.5" />
      <ellipse cx="12" cy="12" rx="3.6" ry="2.4" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5" />
      <path d="M20 3.5v5h-5" />
    </>
  ),
  balloon: (
    <>
      <ellipse cx="12" cy="9" rx="6" ry="7" />
      <path d="M12 16v5M9.5 19.5a2.5 2.5 0 0 0 5 0" />
    </>
  ),
  bounce: (
    <>
      <circle cx="12" cy="5.5" r="2.2" />
      <path d="M12 9.2v5.4M8 11l4-1.8 4 1.8" />
      <path d="M7.5 18.5h9" />
      <path d="M10 21h4" />
    </>
  ),
  // —— 第二轮补充 ——
  pin: (
    <>
      <path d="M12 3.5v2.2" />
      <path d="M8.4 5.7h7.2l-.9 4.6 2.5 2.6H6.8l2.5-2.6-.9-4.6Z" />
      <path d="M12 12.9v7.6" />
    </>
  ),
  hand: (
    <>
      <path d="M9 11.5V5.6a1.5 1.5 0 0 1 3 0v4.6" />
      <path d="M12 10.2V4.4a1.5 1.5 0 0 1 3 0v6.4" />
      <path d="M15 10.8V6.4a1.5 1.5 0 0 1 3 0V14" />
      <path d="M9 11.5V9a1.5 1.5 0 0 0-3 0v5.2c0 3.7 2.6 6.3 6.2 6.3 3.5 0 5.8-2.4 5.8-6.1v-1.4" />
    </>
  ),
  folderTree: (
    <>
      <path d="M3.5 6.5h4.6l1.4 2h8.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3.5 17.5v-11Z" />
      <path d="M8 12.5h3.5v4M11.5 12.5v1.5h4" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a3.4 3.4 0 0 0 4.8 0l2.4-2.4a3.4 3.4 0 0 0-4.8-4.8l-1.4 1.4" />
      <path d="M13.8 10.2a3.4 3.4 0 0 0-4.8 0l-2.4 2.4a3.4 3.4 0 0 0 4.8 4.8l1.4-1.4" />
    </>
  ),
  hash: (
    <>
      <path d="M9.5 3.8 7.8 20.2M16.2 3.8l-1.7 16.4M4 8.6h15.5M3.5 15.4h15.5" />
    </>
  ),
  comment: (
    <>
      <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v7.6A1.5 1.5 0 0 1 19 15.6h-8.6L6 19.4v-3.8H5a1.5 1.5 0 0 1-1.5-1.5V6.5A1.5 1.5 0 0 1 5 5Z" />
    </>
  ),
  note: (
    <>
      <path d="M6 4h12a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4Z" />
      <path d="M8.5 8.6h7M8.5 12.1h7M8.5 15.6h4.2" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.6" r="7.4" />
      <path d="M12 9.8v3.9l2.6 1.5" />
      <path d="M9.5 2.8h5M12 2.8v2.6" />
    </>
  ),
  camera: (
    <>
      <path d="M4.2 8.4h2.6l1.4-2.1h7.6l1.4 2.1h2.6A1.4 1.4 0 0 1 21.2 9.8v8.4a1.4 1.4 0 0 1-1.4 1.4H4.2a1.4 1.4 0 0 1-1.4-1.4V9.8a1.4 1.4 0 0 1 1.4-1.4Z" />
      <circle cx="12" cy="13.7" r="3.4" />
    </>
  ),
  cross: (
    <>
      <path d="M9.4 3.4h5.2v6h6v5.2h-6v6H9.4v-6h-6V9.4h6Z" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6.6 3.5h10.8M6.6 20.5h10.8" />
      <path d="M8.2 3.5c0 4.1 3.8 5.6 3.8 8.5s-3.8 4.4-3.8 8.5" />
      <path d="M15.8 3.5c0 4.1-3.8 5.6-3.8 8.5s3.8 4.4 3.8 8.5" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3.6c2.9 1.6 4.6 4.5 4.6 8.1 0 1.9-.9 3.4-.9 3.4H8.3s-.9-1.5-.9-3.4c0-3.6 1.7-6.5 4.6-8.1Z" />
      <circle cx="12" cy="9.2" r="1.6" />
      <path d="M8.6 15.1 6.2 19.7l3.9-1.5M15.4 15.1l2.4 4.6-3.9-1.5M12 15.5v5.1" />
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none" />
    </>
  ),
  circleDot: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  circle: (
    <>
      <circle cx="12" cy="12" r="7.6" />
    </>
  ),
  health: (
    <>
      <path d="M12 20.2S4.6 15.7 4.6 10.9a4.1 4.1 0 0 1 7.4-2.6 4.1 4.1 0 0 1 7.4 2.6c0 4.8-7.4 9.3-7.4 9.3Z" />
      <path d="M7.6 12.1h2.2l1.5-2.5 1.9 4.4 1.4-1.9h1.8" />
    </>
  ),
  home: (
    <>
      <path d="M4 11.2 12 4.2l8 7" />
      <path d="M6.4 9.6V20h11.2V9.6" />
      <path d="M10 20v-4.8h4V20" />
    </>
  ),
  history: (
    <>
      <path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8" />
      <path d="M3.8 4.6v4.6h4.6" />
      <path d="M12 8.2v4.4l3 1.8" />
    </>
  ),
  option: (
    <>
      <path d="M3.8 6.2h4.4l6.2 11.6h5.8" />
      <path d="M14.4 6.2h5.8" />
    </>
  ),
  command: (
    <>
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 9H7.4a2.2 2.2 0 1 1 2.2-2.2V9M15 9h1.6a2.2 2.2 0 1 0-2.2-2.2V9M9 15H7.4a2.2 2.2 0 1 0 2.2 2.2V15M15 15h1.6a2.2 2.2 0 1 1-2.2 2.2V15" />
    </>
  ),
  tab: (
    <>
      <path d="M3.8 12h11.4M11.6 8.2l3.8 3.8-3.8 3.8" />
      <path d="M19.4 4.6v14.8" />
    </>
  ),
  enter: (
    <>
      <path d="M19 5.2v7.2a3 3 0 0 1-3 3H5.6" />
      <path d="m9.2 11.6-3.6 3.8 3.6 3.8" />
    </>
  ),
  highlighter: (
    <>
      <path d="m8.2 14.4 6.6-6.6 3.4 3.4-6.6 6.6H8.2v-3.4Z" />
      <path d="M6 20.4h12" />
    </>
  ),
  text: (
    <>
      <path d="M5 6.4h14M12 6.4v12.2" />
    </>
  ),
  rect: (
    <>
      <rect x="3.6" y="6.6" width="16.8" height="10.8" rx="1.4" />
    </>
  ),
  fill: (
    <>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2" />
      <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  rows: (
    <>
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2" />
      <path d="M3.6 9.5h16.8M3.6 14.5h16.8" />
    </>
  ),
  columns: (
    <>
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2" />
      <path d="M9.5 4.6v14.8M14.5 4.6v14.8" />
    </>
  ),
  collapse: (
    <>
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2" />
      <path d="M15 12H9.4M12.2 9l-3 3 3 3" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8.2V4h10v4.2" />
      <rect x="4" y="8.2" width="16" height="7.8" rx="1.6" />
      <path d="M7 14h10v6.2H7z" />
    </>
  ),
  burst: (
    <>
      <path d="m12 3.2 1.8 4.3 4.3-1.9-1.2 4.5 4.5 1.9-4.2 2.1 1.9 4.3-4.4-1.2-2 4.4-1.9-4.4-4.4 1.2 1.9-4.3-4.2-2.1 4.5-1.9L7.4 5.6l4.3 1.9L12 3.2Z" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h13M13.4 4.2 17.4 8l-4 3.8" />
      <path d="M20 16H7M10.6 12.2 6.6 16l4 3.8" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.6c-2-1.5-4.5-2-7-2v12.8c2.5 0 5 .5 7 2 2-1.5 4.5-2 7-2V4.6c-2.5 0-5 .5-7 2Z" />
      <path d="M12 6.6v12.8" />
    </>
  ),
  indent: (
    <>
      <path d="M4 5.6h16M9.4 12h10.6M9.4 18.4h10.6" />
      <path d="m4 9.8 3 2.2-3 2.2" />
    </>
  ),
  outdent: (
    <>
      <path d="M4 5.6h16M9.4 12h10.6M9.4 18.4h10.6" />
      <path d="m7 9.8-3 2.2 3 2.2" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.6" cy="10.6" r="6.4" />
      <path d="m15.4 15.4 4.8 4.8M10.6 7.8v5.6M7.8 10.6h5.6" />
    </>
  ),
  gradient: (
    <>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2" />
      <path d="M3.6 20.4 20.4 3.6" />
      <path d="M12 3.6 3.6 12M20.4 12l-8.4 8.4" opacity="0.5" />
    </>
  ),
  cloud: (
    <>
      <path d="M7.6 18.4h9a3.8 3.8 0 0 0 .5-7.5 5.6 5.6 0 0 0-10.5-1.3 4.5 4.5 0 0 0 1 8.8Z" />
    </>
  ),
  glasses: (
    <>
      <circle cx="7" cy="13.6" r="3.4" />
      <circle cx="17" cy="13.6" r="3.4" />
      <path d="M10.4 13.6h3.2M3.6 13.6V8.4M20.4 13.6V8.4" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.4h11M9 12h11M9 17.6h11" />
      <circle cx="4.6" cy="6.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="17.6" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  quote: (
    <>
      <path d="M9.6 6.6C6.6 7.7 5 9.8 5 12.8v4.6h5v-4.6H7.6c0-2 .7-3.4 2-4.2" />
      <path d="M18.6 6.6c-3 1.1-4.6 3.2-4.6 6.2v4.6h5v-4.6h-2.4c0-2 .7-3.4 2-4.2" />
    </>
  ),
  dot: (
    <>
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    </>
  ),
  code: (
    <>
      <path d="m8.4 8-4 4 4 4M15.6 8l4 4-4 4" />
    </>
  ),
  heading: (
    <>
      <path d="M6 4.6v14.8M18 4.6v14.8M6 12h12" />
    </>
  ),
  bold: (
    <>
      <path d="M7 4.6h5.6a3.6 3.6 0 0 1 0 7.2H7zM7 11.8h6.4a3.8 3.8 0 0 1 0 7.6H7z" />
    </>
  ),
  italic: (
    <>
      <path d="M10 4.6h7M7 19.4h7M14 4.6l-4 14.8" />
    </>
  )
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={'bc-icon' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name]}
    </svg>
  );
}

const ICON_NAME_SET = new Set<string>(Object.keys(P));

/** 把历史遗留的字符串（旧版 Emoji 图标名 / 任意串）解析成可用的 IconName；认不出返回 undefined */
export function resolveIconName(s?: string | null): IconName | undefined {
  return s && ICON_NAME_SET.has(s) ? (s as IconName) : undefined;
}

export default Icon;
