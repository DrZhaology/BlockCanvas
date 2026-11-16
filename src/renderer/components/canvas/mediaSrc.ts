// BlockCanvas · 媒体 src → 画布能直接加载的地址（v0.4.5 第 15 批重写）
//
// 用户反馈：「图片现在预览不显示，导出的话因为导出位置可能不是自己想要的位置，导致可能不能显示图片。」
//
// 老实现的问题：相对路径被原样塞进 `bc-img://file/<相对路径>`，
// 主进程只能拿几个"猜测目录"去试（data/projects、data、程序目录…）——
// 工程存在别处、或者相对路径是 `./assets/x.png` 这种，就猜不到 → 404 → 画布空白。
//
// 现在：
//   1. **优先用权威路径 `srcAbs`**（选文件/设路径时记下的绝对路径），这是唯一真相；
//   2. 没有 srcAbs 时，把相对路径按**当前工程目录**解析成绝对路径再交给协议；
//   3. 仍然是相对路径且工程未保存 → 回落给主进程去猜（保持旧行为，不至于直接坏）。
import { getProjectDir } from '@lib/projectDir';

export function toRenderableSrc(raw: string, absHint?: string): string {
  const hint = String(absHint ?? '').trim();
  const t = (hint || String(raw ?? '')).trim();
  if (!t) return '';
  // 网络链接 / Base64 / Blob
  if (/^(https?:|data:|blob:)/i.test(t)) return t;
  // 已经是我们自己的协议
  if (t.startsWith('bc-img://')) return t;
  // 其它协议（file:// 转成我们的协议，其它原样）
  if (/^[a-z0-9+.-]+:\/\//i.test(t)) {
    if (t.startsWith('file://')) {
      const pathPart = decodeURIComponent(t.replace(/^file:\/\/\/?/i, ''));
      return 'bc-img://file/' + encodeURIComponent(pathPart);
    }
    return t;
  }
  // 绝对路径（Windows 盘符 / UNC / POSIX 根）→ 直接交给协议
  if (/^[a-zA-Z]:[\\/]/.test(t) || t.startsWith('\\\\') || t.startsWith('/')) {
    return 'bc-img://file/' + encodeURIComponent(t.replace(/\\/g, '/'));
  }
  // 相对路径：按当前工程目录解析成绝对路径（这样"工程放哪都能找到图"）
  const dir = getProjectDir();
  if (dir) {
    const joined = (dir.replace(/\/+$/, '') + '/' + t.replace(/^\.\//, '')).replace(/\/\.\//g, '/');
    return 'bc-img://file/' + encodeURIComponent(joined);
  }
  // 工程还没保存：交给主进程按候选目录猜（旧行为，兜底）
  return 'bc-img://file/' + encodeURIComponent(t);
}
