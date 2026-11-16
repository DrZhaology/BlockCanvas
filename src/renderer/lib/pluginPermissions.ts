// BlockCanvas · 插件能力白名单（R6-22）
//
// 设计前提（v0.4.6 定稿）：
//   **不做真沙箱**。插件仍然用 `new Function('Bc', source)` 在渲染进程同上下文里跑，
//   所以"完全隔离"这件事现在做不到（也不该假装做到了）。能做的、而且成本最低的是
//   **少给参数**：插件在 manifest 里声明要什么能力，宿主只把声明过的那些方法放进 Bc。
//   未声明的方法在 Bc 上根本不存在 —— 越权访问会直接 TypeError，不会静默成功。
//
// 为什么先做这一步（而不是等沙箱）：
//   ① 它挡住的是**误用**（插件顺手改了不该改的东西），这部分风险占绝大多数；
//   ② 它为将来的真沙箱**定下了接口形状**：以后把能力对象整体挪进 iframe 即可，
//      不需要改插件（声明式的能力列表已经在了）。
//
// 三条硬规则：
//   1. manifest 不写 `permissions` → 按 **最小权限** 处理（只给 element + property），
//      老插件不会因为升级突然拿到更多能力；
//   2. 声明了不认识的能力 → 忽略它，并在扫描结果里留一条 warning（不阻断加载）；
//   3. `apiVersion` 缺失按 "1" 处理；比宿主支持的最高版本还高 → 拒绝加载并说明原因
//      （宁可明确报错，也不要"跑一半崩"）。

/** 当前宿主支持的插件 API 版本 */
export const PLUGIN_API_VERSION = '1';

/** 全部可声明能力 */
export const PLUGIN_PERMISSIONS = [
  /** 在元素面板新增元素类型 */
  'element',
  /** 在属性面板新增 CSS 属性 */
  'property',
  /** 导出前后钩子（能改最终 HTML） */
  'export',
  /** 工具栏按钮 / 命令 */
  'command',
  /** 注入自定义 CSS */
  'css',
  /** 只读获取宿主 API（window.bc 的只读子集）—— 高危，默认不给 */
  'hostApi'
] as const;

export type PluginPermission = typeof PLUGIN_PERMISSIONS[number];

/** 未声明 permissions 时给的最小集合（老插件默认落到这里） */
export const MINIMAL_PERMISSIONS: PluginPermission[] = ['element', 'property'];

/** 能力 → Bc 上对应的方法名（用于"未声明就删掉"） */
const CAPABILITY_METHODS: Record<PluginPermission, string[]> = {
  element: ['registerElement'],
  property: ['registerProperty'],
  export: ['registerExportHook'],
  command: ['registerCommand'],
  css: ['registerCss'],
  hostApi: ['api']
};

export type ManifestPermissions = {
  apiVersion: string;
  permissions: PluginPermission[];
  /** 声明了但宿主不认识的能力（用于提示"你这个版本太高/写错了"） */
  ignored: string[];
  /** 版本不兼容时的原因（非空即拒绝加载） */
  rejected: string | null;
};

/**
 * 解析 manifest 里的插件接口声明。
 *
 * 宽容是刻意的：老插件没有这些字段也要能继续跑。
 * 但**版本过高要拒绝** —— 一个按 API 2 写的插件在 API 1 的宿主上跑，
 * 最可能的结果是"点一下就崩"，那种崩溃用户会记成"BlockCanvas 坏了"。
 */
export function parseManifestPermissions(mf: Record<string, unknown> | null | undefined): ManifestPermissions {
  const apiVersion = String(mf?.apiVersion ?? PLUGIN_API_VERSION).trim() || PLUGIN_API_VERSION;
  const ignored: string[] = [];

  // 只支持整数主版本，避免 "1.2" / "v1" 这类写法造成歧义
  const major = Number(apiVersion);
  if (!Number.isFinite(major) || String(major) !== apiVersion) {
    return {
      apiVersion,
      permissions: [],
      ignored,
      rejected: `apiVersion "${apiVersion}" 无法识别（应写数字，如 "1"）`
    };
  }
  if (major > Number(PLUGIN_API_VERSION)) {
    return {
      apiVersion,
      permissions: [],
      ignored,
      rejected: `这个插件要求 API ${apiVersion}，当前程序只支持到 ${PLUGIN_API_VERSION}。请更新程序或换用旧版插件`
    };
  }

  let permissions: PluginPermission[];
  if (mf?.permissions === undefined) {
    // 最小权限：老插件没写就只给"加元素 / 加属性"这两件最无害的事
    permissions = [...MINIMAL_PERMISSIONS];
  } else if (!Array.isArray(mf.permissions)) {
    return { apiVersion, permissions: [], ignored, rejected: 'permissions 必须是字符串数组' };
  } else {
    const set = new Set<PluginPermission>();
    for (const raw of mf.permissions) {
      const p = String(raw).trim();
      if (!p) continue;
      if ((PLUGIN_PERMISSIONS as readonly string[]).includes(p)) set.add(p as PluginPermission);
      else ignored.push(p);
    }
    permissions = [...set];
  }

  return { apiVersion, permissions, ignored, rejected: null };
}

/**
 * 按声明裁剪 Bc：未声明的方法**直接删掉**。
 *
 * 为什么不"给个抛错的空函数"：空函数会让插件以为注册成功了（`registerCss` 没报错但没生效），
 * 排查起来比 `TypeError: Bc.registerCss is not a function` 难十倍。
 */
export function applyPermissionGate<T extends Record<string, unknown>>(bc: T, permissions: PluginPermission[]): { bc: T; removed: string[] } {
  const granted = new Set(permissions);
  const out = { ...bc } as Record<string, unknown>;
  const removed: string[] = [];
  for (const cap of PLUGIN_PERMISSIONS) {
    if (granted.has(cap)) continue;
    for (const method of CAPABILITY_METHODS[cap]) {
      if (method in out) {
        delete out[method];
        removed.push(method);
      }
    }
  }
  return { bc: out as T, removed };
}

/** 给用户看的能力清单文案（设置页 / 插件管理器用） */
export const PERMISSION_LABELS: Record<PluginPermission, string> = {
  element: '新增元素（在元素面板加一个可插入的类型）',
  property: '新增属性（在属性面板加一个 CSS 属性）',
  export: '修改导出结果（导出前后改写 HTML）',
  command: '添加按钮（工具栏「⋯更多」里出现命令）',
  css: '注入样式（向页面写入自定义 CSS）',
  hostApi: '访问程序接口（读工程 / 预览 / 模板等，高危）'
};

/**
 * 把"宿主支持的接口形状"挂到 window，供探针与插件作者自查。
 *
 * 这份信息本来就是公开接口（插件作者必须知道能声明什么），挂出去没有安全影响；
 * 有了它，探针可以断言"能力清单与文档一致"，而不是靠读源码猜。
 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__bcPermissionMeta = {
    apiVersion: PLUGIN_API_VERSION,
    permissions: [...PLUGIN_PERMISSIONS],
    labels: PERMISSION_LABELS,
    minimal: [...MINIMAL_PERMISSIONS]
  };
}
