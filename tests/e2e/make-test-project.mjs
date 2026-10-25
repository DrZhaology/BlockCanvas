// 生成一个「测试指引」工程：画布内容本身就是操作说明，用户打开后照着点即可。
// 用法：node tests/e2e/make-test-project.mjs [输出路径]
// 默认输出到仓库根目录：BlockCanvas-测试指引.bcproj
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, copyFileSync, mkdirSync as mk } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OUT = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'BlockCanvas-测试指引.bcproj');

// 每个板块：标题 + 若干条检查项
const SECTIONS = [
  ['一、变量系统', [
    '右侧「变量」页签 → 模板 → 主色：应建好一个变量并自动进入改名',
    '把变量名改成 Brand_2（大小写+下划线）：应能接受',
    '看变量行显示的 CSS 名：应为 --Brand_2，不再强制加 bc- 前缀',
    '给任意元素写 var(--Brand_2)：画布应生效',
    '重命名一个被引用的变量：已写进样式的引用应自动跟着改',
  ]],
  ['二、定位与画布', [
    '按住 Alt 悬停本元素：应出现盒模型浮层（不用拖动）',
    '给它设 position: fixed + top/left，再 Alt 悬停：应出现四个红色边距标签',
    '设 position: relative + left/top：应出现「原文档流位置」虚线幽灵框',
    '设 margin-left: auto 后 Alt 悬停：margin 标注应显示 auto',
    '按住左键拖元素、中途再按 Alt：元素不应闪到别处再弹回',
  ]],
  ['三、多媒体', [
    '插入视频/音频后不选中它：它必须仍然可见（不能变成空白或零高度）',
    '点一下未选中的视频：应选中这个元素，而不是触发播放',
    '选中后控制条出现，可直接试播预览',
    '媒体卡勾「自动播放」：应自动带上静音（浏览器规则）',
    '勾「背景模式」：导出后不显示播放条',
    '图片/视频按住 Alt 拖动边角：应按比例缩放，不能拉伸变形',
  ]],
  ['四、属性卡片', [
    '加「外轮廓」把粗细拉到 12px：预览线必须留在卡片里，不能糊到外面',
    '外轮廓颜色行：输入框和色块应在同一行；线型按钮文字不应拆行',
    '加「背景颜色」：应有 纯色/渐变/图片 三个页签；图片模式可选本地文件',
    '任意颜色字段右侧应有 var 按钮；新项目没变量时点开也要有新建指引',
    '媒体卡四个开关不应把文字挤成竖排；卡片内容不应贴着左边框',
    '添加属性：新卡片从右侧滑入；删除时向右滑出后收起高度',
  ]],
  ['五、标签与快捷键', [
    'Ctrl+Z / Ctrl+Y 应能撤销与重做（含从项目中心打开工程后）',
    'Ctrl+S 保存；把所有标签关掉会回到首页',
    '选中两个以上元素：橙色边框不应闪烁',
  ]],
  ['六、素材与工程', [
    '左侧「素材」页签：应铺满面板宽度，不缩成一条窄列',
    '插一张本地图片并保存工程：图片应被打包进 .bcproj',
    '把 .bcproj 换到别的目录再打开：图片应正常显示',
    '导出 HTML：图片应内联为 data URL，发给别人也能看',
  ]],
  ['七、项目中心与更新', [
    '从别处导入一个工程：列表里应出现它并带「外部」徽标',
    '把那个文件删掉再进项目中心：应显示「文件已丢失」并可「移除记录」',
    '故意弄坏一个 .bcproj 再打开：应提示失败原因并提供「尝试修复」',
    '更新中心：页面可上下滚动；「查看更多历史版本」是窄胶囊按钮',
  ]],
  ['八、首页与设置', [
    '窗口拉大拉小：首页内容始终垂直居中',
    '首页齿轮 → 渐变：色标应是有边框的小卡片；调色盘选色时面板不应关闭',
    '拖「模糊」滑块：右侧不应出现滚动条、整页不抖',
    '设置页：正文左右留白应对称',
    '帮助中心搜索：点结果应滚到屏幕正中并有荧光笔高亮',
  ]],
];

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-make-testproj');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 用 store 直接搭内容：标题 + 说明段落 + 一个"用来试动作"的方块
  const built = await win.evaluate((sections) => {
    const st = window.__sceneStore.getState();
    const api = () => window.__sceneStore.getState();
    const ids = () => new Set((api().scene.root.children || []).map((c) => c.id));
    const add = (type) => {
      const before = ids();
      api().addElement(type);
      const kids = api().scene.root.children || [];
      return kids.find((c) => !before.has(c.id));
    };

    // 顶部大标题
    const h = add('h1');
    if (h) {
      api().setText(h.id, 'BlockCanvas 测试指引（照这里逐条点）');
      api().updateStyle(h.id, { fontSize: '30px', marginBottom: '6px' });
    }

    for (const [title, items] of sections) {
      const t = add('h2');
      if (t) {
        api().setText(t.id, title);
        api().updateStyle(t.id, { fontSize: '21px', marginTop: '22px', marginBottom: '6px', color: '#1e40af' });
      }
      for (let i = 0; i < items.length; i++) {
        const p = add('p');
        if (p) {
          api().setText(p.id, `${i + 1}. ${items[i]}`);
          api().updateStyle(p.id, { margin: '3px 0', paddingLeft: '10px', fontSize: '15px' });
        }
      }
    }

    // 一个"拿来试操作"的元素：定位 / Alt 拖动 / 外轮廓 都用它
    const box = add('div');
    if (box) {
      api().setText(box.id, '拿我试操作：Alt 悬停、拖动、改定位、加外轮廓');
      api().updateStyle(box.id, {
        width: '320px', height: '120px', marginTop: '26px',
        paddingTop: '14px', paddingLeft: '14px',
        backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
        fontSize: '14px', color: '#1e3a8a'
      });
    }
    return { count: (api().scene.root.children || []).length };
  }, SECTIONS);
  console.log('生成节点数:', JSON.stringify(built));
  await sleep(300);

  const saved = await win.evaluate(async (target) => {
    const st = window.__sceneStore.getState();
    const res = await window.bc.saveProject({ name: 'BlockCanvas-测试指引', scene: st.scene }, false, target);
    return { ok: res.ok, error: res.error, path: res.path };
  }, OUT);
  console.log('保存结果:', JSON.stringify(saved));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  if (!saved.ok) { console.error('生成失败'); process.exit(1); }
  console.log('已生成测试工程 →', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });