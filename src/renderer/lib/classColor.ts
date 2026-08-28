// BlockCanvas · 类名配色（同类同色）
// 同一类名的所有元素在「轮廓」模式下用同一个专属颜色描边，颜色即分组：
//  - 色板 12 色（区分度高、深浅适中），按类名哈希稳定取色 → 重启/重排不变色
//  - 暗蓝 #2b5797 保留给"无类名"元素（见 styles.css 的轮廓分级规则）
//  - Inspector 类名 chips、类名总览卡的色点也用同一函数 → 全局一致的颜色语言

const CLASS_PALETTE = [
  '#7c4dff', // 紫
  '#00897b', // 青绿
  '#e53935', // 红
  '#1e88e5', // 蓝
  '#f4511e', // 橙红
  '#3949ab', // 靛蓝
  '#43a047', // 绿
  '#d81b60', // 玫红
  '#00acc1', // 青
  '#8e24aa', // 深紫
  '#c0ca33', // 黄绿
  '#6d4c41'  // 棕
];

/** 类名 → 稳定颜色（同一输入永远同一输出） */
export function classColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CLASS_PALETTE[h % CLASS_PALETTE.length];
}

/** CSS 类名 token 合法性：字母/数字/横线/下划线（写入 chips 与快速起名共用） */
export function isValidClassToken(t: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(t);
}
