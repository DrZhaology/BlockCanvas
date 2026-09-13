import type { ReactNode } from 'react';

// BlockCanvas · 线性图标集（自绘，Fluent / Windows 11 风格）
// 统一 24×24 网格、1.7px 描边、圆头圆角，颜色继承 currentColor，
// 这样在浅色 / 深色主题下都能自动适配，也方便用主色强调。

export type IconName =
  | 'palette' | 'sliders' | 'database' | 'tool' | 'puzzle' | 'info'
  | 'moon' | 'outline' | 'pageReset' | 'headingReset' | 'layout' | 'ruler'
  | 'bolt' | 'tag' | 'broom' | 'trash' | 'clock' | 'package' | 'globe'
  | 'refresh' | 'folder' | 'plug' | 'importFolder' | 'importZip' | 'plus' | 'external'
  | 'keyboard' | 'sparkle';

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

export default Icon;
