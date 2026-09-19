// BlockCanvas · 字体目录（fontCatalog）
//
// 字体选择库的数据源分三层：
//  1. 本机字体 —— window.queryLocalFonts()（主进程已放行 'local-fonts' 权限），
//     列出用户电脑上真实安装的全部字体；能匹配到目录的沿用目录的商用标注，
//     匹配不到的标「未收录」。
//  2. 目录字体 —— 下面这份内置清单：Windows / macOS / Linux 常见设备字体 +
//     知名免费商用字体。**字体文件本身不携带版权信息，也无法联网核实**，
//     所以这里按公开资料预先标注，供用户选择时参考：
//       · free       ✓ 可商用 —— 开源授权（OFL / Apache / MIT 等）或作者明确免费商用
//       · restricted ⚠ 商用需注意 —— 随操作系统/Office 附带，网页内指定一般无碍，
//                      但做商标/嵌入分发/印刷物料前建议确认授权
//       · generic    ℹ 通用族 —— 浏览器按类别匹配，无版权问题
//       · unknown    ？未收录 —— 本机有、目录里没有，商用前请自行确认
//  3. 自定义字体 —— 用户手动登记的字体名（如通过 @font-face 引入的网络字体/
//     本地字体文件），存 localStorage，标「自定义」。
//
// ⚠ 免责：标注仅供快速参考，不构成法律意见；重要商用场景请核对字体官方授权页。

export type FontLicense = 'free' | 'restricted' | 'generic' | 'unknown';

export interface FontEntry {
  /** CSS font-family 名（应用层负责按需加引号） */
  name: string;
  /** 中文别名 / 一句话说明 */
  zh?: string;
  license: FontLicense;
  /** 授权备注（悬停提示） */
  note?: string;
  /** 常见于哪些平台 */
  platforms?: Array<'win' | 'mac' | 'linux'>;
  /** 类别（用于分组排序） */
  category?: 'sans' | 'serif' | 'mono' | 'hand' | 'display';
}

export const LICENSE_LABEL: Record<FontLicense, string> = {
  free: '可商用',
  restricted: '商用需注意',
  generic: '通用族',
  unknown: '未收录'
};

export const LICENSE_TIP: Record<FontLicense, string> = {
  free: '开源或明确免费商用（OFL / Apache / MIT 等）',
  restricted: '随系统 / Office 附带：网页内指定一般无碍，做商标、嵌入分发或印刷物料前请确认授权',
  generic: '通用字体族：浏览器按类别匹配访客设备上的字体，无版权问题',
  unknown: '本机已安装，但不在预置目录里：版权信息未收录，商用前请自行确认'
};

/** 平台检测（用于「常见于」徽标排序提示） */
export function detectPlatform(): 'win' | 'mac' | 'linux' {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'win';
  if (ua.includes('mac')) return 'mac';
  return 'linux';
}

/** 内置目录：中文常见字体 */
const CN_FONTS: FontEntry[] = [
  // —— 可商用（开源 / 明确免费商用）——
  // 收录原则：只收「官方授权声明 / 开源许可证（OFL、Apache、GPL 字体例外）」公开可查的字体；
  // 拿不准的一律不收，宁可少不可错。
  { name: 'Noto Sans SC', zh: '思源黑体（Google 版）', license: 'free', category: 'sans', platforms: ['win', 'mac', 'linux'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'Source Han Sans SC', zh: '思源黑体（Adobe 版）', license: 'free', category: 'sans', platforms: ['win', 'mac', 'linux'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'Noto Serif SC', zh: '思源宋体', license: 'free', category: 'serif', platforms: ['win', 'mac', 'linux'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'Source Han Serif SC', zh: '思源宋体（Adobe 版）', license: 'free', category: 'serif', platforms: ['win', 'mac', 'linux'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'Alibaba PuHuiTi', zh: '阿里巴巴普惠体', license: 'free', category: 'sans', platforms: ['win'], note: '官方声明免费商用' },
  { name: 'Alibaba PuHuiTi 3.0', zh: '阿里巴巴普惠体 3.0', license: 'free', category: 'sans', platforms: ['win'], note: '官方声明免费商用' },
  { name: 'Alimama FangYuanTi', zh: '阿里妈妈方圆体', license: 'free', category: 'sans', platforms: ['win'], note: '阿里妈妈官方声明免费商用' },
  { name: 'Alimama ShuHeiTi', zh: '阿里妈妈数黑体', license: 'free', category: 'display', platforms: ['win'], note: '阿里妈妈官方声明免费商用' },
  { name: 'Douyin Sans', zh: '抖音美好体', license: 'free', category: 'sans', platforms: ['win'], note: '字节跳动官方声明免费商用（含商用）' },
  { name: 'OPPO Sans', zh: 'OPPO Sans', license: 'free', category: 'sans', platforms: ['win'], note: '官方声明免费商用（遵守 OPPO 字体协议）' },
  { name: 'HarmonyOS Sans SC', zh: '鸿蒙黑体', license: 'free', category: 'sans', platforms: ['win'], note: '华为开源字体，可商用' },
  { name: 'MiSans', zh: '小米 MiSans', license: 'free', category: 'sans', platforms: ['win'], note: '官方声明免费商用' },
  { name: 'LXGW WenKai', zh: '霞鹜文楷', license: 'free', category: 'hand', platforms: ['win', 'mac', 'linux'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'LXGW WenKai Lite', zh: '霞鹜文楷（轻量版）', license: 'free', category: 'hand', platforms: ['win', 'mac', 'linux'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'Smiley Sans', zh: '得意黑', license: 'free', category: 'display', platforms: ['win'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'Glow Sans', zh: '未来荧黑', license: 'free', category: 'sans', platforms: ['win', 'mac'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'WenQuanYi Micro Hei', zh: '文泉驿微米黑', license: 'free', category: 'sans', platforms: ['linux'], note: 'GPL/Apache 双授权；导出网页仅引用字体名、不打包字体文件，无授权传染问题' },
  { name: 'Huiwen-mincho', zh: '汇文明朝体', license: 'free', category: 'serif', platforms: ['win'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'ZCOOL KuaiLe', zh: '站酷快乐体', license: 'free', category: 'display', platforms: ['win'], note: '免费商用（站酷字体系列）' },
  { name: 'ZCOOL QingKe HuangYou', zh: '站酷庆科黄油体', license: 'free', category: 'display', platforms: ['win'], note: '免费商用（站酷字体系列）' },
  { name: 'ZCOOL GaoDuanHei', zh: '站酷高端黑', license: 'free', category: 'display', platforms: ['win'], note: '免费商用（站酷字体系列）' },
  { name: 'ZCOOL XiaoWei', zh: '站酷小薇LOGO体', license: 'free', category: 'display', platforms: ['win'], note: '免费商用（站酷字体系列）' },
  { name: 'ZCOOL WenYiTi', zh: '站酷文艺体', license: 'free', category: 'display', platforms: ['win'], note: '免费商用（站酷字体系列）' },
  { name: 'PangMenZhengDao', zh: '庞门正道标题体', license: 'free', category: 'display', platforms: ['win'], note: '庞门正道官方声明免费商用' },
  { name: 'LianMeng QiYi LuShuai', zh: '联盟起艺卢帅正锐黑体', license: 'free', category: 'display', platforms: ['win'], note: '官方声明免费商用' },
  { name: 'YouSheBiaoTiHei', zh: '优设标题黑', license: 'free', category: 'display', platforms: ['win'], note: '优设官方声明免费商用' },
  { name: 'JingNan MaiYuan', zh: '荆南麦圆体', license: 'free', category: 'sans', platforms: ['win'], note: 'SIL OFL 开源，可自由商用' },
  { name: 'ChillKai', zh: '寒蝉正楷体', license: 'free', category: 'hand', platforms: ['win'], note: 'SIL OFL 开源，可自由商用' },
  // —— 随系统附带，商用需注意 ——
  { name: 'Microsoft YaHei', zh: '微软雅黑', license: 'restricted', category: 'sans', platforms: ['win'], note: '随 Windows 附带：网页指定一般无碍；嵌入分发 / 印刷物料需微软授权' },
  { name: '微软雅黑', license: 'restricted', category: 'sans', platforms: ['win'], note: '同 Microsoft YaHei（中文名）' },
  { name: 'SimSun', zh: '中易宋体', license: 'restricted', category: 'serif', platforms: ['win'], note: '随 Windows 附带，商用需注意' },
  { name: 'SimHei', zh: '中易黑体', license: 'restricted', category: 'sans', platforms: ['win'], note: '随 Windows 附带，商用需注意' },
  { name: 'KaiTi', zh: '楷体', license: 'restricted', category: 'hand', platforms: ['win'], note: '随 Windows 附带，商用需注意' },
  { name: 'FangSong', zh: '仿宋', license: 'restricted', category: 'serif', platforms: ['win'], note: '随 Windows 附带，商用需注意' },
  { name: 'Microsoft JhengHei', zh: '微软正黑体（繁）', license: 'restricted', category: 'sans', platforms: ['win'], note: '随 Windows 附带，商用需注意' },
  { name: 'STKaiti', zh: '华文楷体', license: 'restricted', category: 'hand', platforms: ['mac'], note: '随 macOS / Office 附带，商用需注意' },
  { name: 'STSong', zh: '华文宋体', license: 'restricted', category: 'serif', platforms: ['mac'], note: '随 macOS / Office 附带，商用需注意' },
  { name: 'PingFang SC', zh: '苹方-简', license: 'restricted', category: 'sans', platforms: ['mac'], note: '随 Apple 设备附带：在苹果设备上显示无需额外授权，跨平台嵌入分发需 Apple 授权' },
  { name: 'Hiragino Sans GB', zh: '冬青黑体简体中文', license: 'restricted', category: 'sans', platforms: ['mac'], note: '随 macOS 附带，商用需注意' },
  { name: 'Songti SC', zh: '宋体-简（mac）', license: 'restricted', category: 'serif', platforms: ['mac'], note: '随 macOS 附带，商用需注意' }
];

/** 内置目录：西文常见字体 */
const LATIN_FONTS: FontEntry[] = [
  // —— 可商用 ——
  { name: 'Roboto', license: 'free', category: 'sans', platforms: ['linux'], note: 'Apache 2.0 开源' },
  { name: 'Roboto Flex', license: 'free', category: 'sans', note: 'SIL OFL 开源（Google）' },
  { name: 'Open Sans', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Lato', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Montserrat', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Inter', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Poppins', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Nunito', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Playfair Display', license: 'free', category: 'serif', note: 'SIL OFL 开源' },
  { name: 'Merriweather', license: 'free', category: 'serif', note: 'SIL OFL 开源' },
  { name: 'Libre Baskerville', license: 'free', category: 'serif', note: 'SIL OFL 开源' },
  { name: 'DM Sans', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Manrope', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Space Grotesk', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Barlow', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'Work Sans', license: 'free', category: 'sans', note: 'SIL OFL 开源' },
  { name: 'IBM Plex Sans', license: 'free', category: 'sans', note: 'SIL OFL 开源（IBM）' },
  { name: 'Source Code Pro', license: 'free', category: 'mono', note: 'SIL OFL 开源（Adobe）' },
  { name: 'JetBrains Mono', license: 'free', category: 'mono', note: 'SIL OFL 开源' },
  { name: 'Fira Code', license: 'free', category: 'mono', note: 'SIL OFL 开源' },
  { name: 'IBM Plex Mono', license: 'free', category: 'mono', note: 'SIL OFL 开源（IBM）' },
  { name: 'Cascadia Code', license: 'free', category: 'mono', platforms: ['win'], note: '微软开源（SIL OFL）' },
  { name: 'DejaVu Sans', license: 'free', category: 'sans', platforms: ['linux'], note: '自由字体，可商用' },
  { name: 'Liberation Sans', license: 'free', category: 'sans', platforms: ['linux'], note: 'SIL OFL 开源（Linux 生态）' },
  { name: 'Ubuntu', license: 'free', category: 'sans', platforms: ['linux'], note: 'Ubuntu Font Licence，可商用' },
  // —— 随系统附带 ——
  { name: 'Arial', license: 'restricted', category: 'sans', platforms: ['win', 'mac'], note: '随系统附带：网页指定一般无碍；嵌入分发需授权' },
  { name: 'Helvetica', license: 'restricted', category: 'sans', platforms: ['mac'], note: 'macOS 附带；Helvetica 原版为商业字体，嵌入分发需授权' },
  { name: 'Helvetica Neue', license: 'restricted', category: 'sans', platforms: ['mac'], note: 'macOS 附带，商用需注意' },
  { name: 'Times New Roman', license: 'restricted', category: 'serif', platforms: ['win', 'mac'], note: '随系统附带，商用需注意' },
  { name: 'Georgia', license: 'restricted', category: 'serif', platforms: ['win', 'mac'], note: '随系统附带，商用需注意' },
  { name: 'Verdana', license: 'restricted', category: 'sans', platforms: ['win', 'mac'], note: '随系统附带，商用需注意' },
  { name: 'Tahoma', license: 'restricted', category: 'sans', platforms: ['win'], note: '随 Windows 附带，商用需注意' },
  { name: 'Trebuchet MS', license: 'restricted', category: 'sans', platforms: ['win', 'mac'], note: '随系统附带，商用需注意' },
  { name: 'Courier New', license: 'restricted', category: 'mono', platforms: ['win', 'mac'], note: '随系统附带，商用需注意' },
  { name: 'Consolas', license: 'restricted', category: 'mono', platforms: ['win'], note: '随 Windows / Office 附带，商用需注意' },
  { name: 'Segoe UI', license: 'restricted', category: 'sans', platforms: ['win'], note: 'Windows 系统 UI 字体，绑定 Windows 授权' },
  { name: 'Calibri', license: 'restricted', category: 'sans', platforms: ['win'], note: '随 Office 附带，商用需注意' },
  { name: 'Cambria', license: 'restricted', category: 'serif', platforms: ['win'], note: '随 Office 附带，商用需注意' },
  { name: 'Impact', license: 'restricted', category: 'display', platforms: ['win'], note: '随 Windows 附带，商用需注意' },
  { name: 'Menlo', license: 'restricted', category: 'mono', platforms: ['mac'], note: '随 macOS 附带' },
  { name: 'Monaco', license: 'restricted', category: 'mono', platforms: ['mac'], note: '随 macOS 附带' },
  { name: 'SF Pro Text', license: 'restricted', category: 'sans', platforms: ['mac'], note: 'Apple 系统字体，绑定 Apple 平台授权' }
];

/** 通用字体族（无版权问题，浏览器按类别匹配） */
export const GENERIC_FAMILIES: FontEntry[] = [
  { name: 'system-ui', zh: '系统原生界面字体', license: 'generic', category: 'sans' },
  { name: 'sans-serif', zh: '无衬线（黑体类）', license: 'generic', category: 'sans' },
  { name: 'serif', zh: '衬线（宋体类）', license: 'generic', category: 'serif' },
  { name: 'monospace', zh: '等宽（代码类）', license: 'generic', category: 'mono' },
  { name: 'cursive', zh: '手写（草书类）', license: 'generic', category: 'hand' },
  { name: 'fantasy', zh: '装饰（艺术类）', license: 'generic', category: 'display' }
];

/** 全部目录字体（中文在前） */
export const CATALOG_FONTS: FontEntry[] = [...CN_FONTS, ...LATIN_FONTS];

/** family 名 → 目录条目（大小写不敏感查找） */
const CATALOG_LOOKUP = new Map<string, FontEntry>();
for (const f of CATALOG_FONTS) CATALOG_LOOKUP.set(f.name.toLowerCase(), f);

/** 查一个 family 的商用标注：目录里没有 → unknown */
export function licenseOf(family: string): FontLicense {
  return CATALOG_LOOKUP.get(family.trim().toLowerCase())?.license ?? 'unknown';
}

// ============ 自定义字体（用户手动登记，如 @font-face 引入的字体） ============
const CUSTOM_KEY = 'bc-fonts-custom';

export interface CustomFont {
  name: string;
  zh?: string;
  license: FontLicense;
}

export function loadCustomFonts(): CustomFont[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as CustomFont[]) : [];
  } catch { return []; }
}

export function saveCustomFonts(list: CustomFont[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/**
 * 枚举本机全部字体（Local Font Access API）。
 * - 成功：返回去重后的 family 名数组；
 * - 失败（无权限 / 宿主不支持 / 用户拒绝）：返回 null，调用方降级为目录 + 通用族。
 */
export async function enumerateLocalFonts(): Promise<string[] | null> {
  try {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts;
    if (typeof q !== 'function') return null;
    const list = await q.call(window);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of list) {
      const k = f.family.trim();
      if (!k || seen.has(k.toLowerCase())) continue;
      seen.add(k.toLowerCase());
      out.push(k);
    }
    return out.sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}

/** CSS font-family 值：给含空格/非 ASCII 的名字加引号 */
export function quoteFamily(name: string): string {
  const t = name.trim();
  if (!t) return t;
  if (/^["'].*["']$/.test(t)) return t;           // 已带引号
  if (/^[a-zA-Z][a-zA-Z0-9\-]*$/.test(t)) return t; // 合法无引号标识符
  return `"${t.replace(/"/g, '\\"')}"`;
}

/** 把字体链合成 font-family 值 */
export function buildFamilyValue(chain: string[], fallbackGeneric?: string): string {
  const parts = chain.map(quoteFamily).filter(Boolean);
  if (fallbackGeneric && !parts.includes(fallbackGeneric)) parts.push(fallbackGeneric);
  return parts.join(', ');
}
