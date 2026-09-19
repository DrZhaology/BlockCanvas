import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// BlockCanvas · 画布浮层 + 编辑器技巧库
//
//  · 元素定位脉冲高亮环：类名/ID 总览点「定位」时自动滚动到元素并圈出。
//    用 Portal 挂到 body + 视口坐标 + 滚动/resize/尺寸监听，滚动期间实时跟随，
//    不会出现「页面滑走了框还留在原地」。
//  · 编辑器技巧库（TIPS）：数据与开关状态放在这里统一维护；
//    展示入口已经搬到顶部工具栏（不遮挡画布内容）。
//
// 注：设备/断点切换条也已搬到顶部工具栏，画布上不再有浮动条。

/** 技巧提示总开关（设置页可关；默认开） */
export const TIPS_KEY = 'bc-canvas-tips';

export function tipsEnabled(): boolean {
  try { return localStorage.getItem(TIPS_KEY) !== '0'; } catch { return true; }
}

export function setTipsEnabled(v: boolean) {
  try { localStorage.setItem(TIPS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('bc:canvas-tips-changed')); } catch { /* ignore */ }
}

// 编辑器技巧库（按「基础操作 / 布局 / 样式 / 命名 / 响应式 / 定位 / 输出」覆盖更多角落）
export const TIPS: string[] = [
  // —— 基础操作 ——
  '按住 <b>Shift</b> + 点 <kbd>?</kbd>（或 <kbd>Shift</kbd>+<kbd>/</kbd>）打开全部快捷键',
  '双击画布上的文字，可以直接就地修改文案',
  '<b>Ctrl</b> + 点击元素 = 多选；空白处拖框可批量选中',
  '<b>Alt</b> + 点击元素 = 直接选中它的父级容器',
  '<b>Ctrl</b> + 滚轮 = 缩放画布，比例会实时显示在工具栏',
  '按住工具栏的百分比左右拖动可无极缩放，双击数字能直接手输',
  '选中元素后按方向键微调位置，按住 <b>Shift</b> 一次走 10px',
  '拖动画布左右边缘，可以任意调整页面宽度看适配效果',
  '想复制一个一模一样的元素？按 <b>Ctrl</b>+<b>D</b> 原地生成副本',
  '粘贴会插进当前选中元素的内部，不用再手动挪层级',
  '不小心删错了？<b>Ctrl</b>+<b>Z</b> 撤销，<b>Ctrl</b>+<b>Shift</b>+<b>Z</b> 重做',
  '<b>Esc</b> 一键取消选中，回到「没选任何元素」的干净状态',
  '右侧「图层」页签能看清嵌套结构，拖动行可以调整父子关系',
  '面板之间的切割线都可以拖：画布下缘改元素面板高度，属性面板左缘改宽度',
  '想把元素面板拉高看更多模板？点模板页右上角的「撑开口袋」',
  // —— 布局 ——
  '给元素起一个「类名」，同类元素改一个样式就全部跟着变',
  '布局用「快捷助手」里的弹性 Flex，横排竖排一句话搞定',
  '间距别用空 div 硬撑，用父容器的 gap 一次性给所有子元素留缝',
  '多列卡片最省事的是「网格 Grid + repeat(auto-fill, minmax(220px, 1fr))」，随窗口自动换列',
  '容器里的元素挤不下又不想换行？给父容器打开 flex-wrap: wrap',
  '元素想在父容器里垂直+水平居中：display: flex，再把主轴/交叉轴对齐都选 center',
  '要做「左固定 + 右自适应」：Grid 列模板写 240px 1fr 即可',
  '卡片等高不必手写高度，把父容器设成 flex 后子项默认就会被拉伸对齐',
  '想让某个子元素独占整行：给它加 grid-column: span 2，或填 1 / -1',
  // —— 样式与颜色 ——
  '「快捷助手 → 文字渐变」能让标题穿上渐变色，一秒变高级',
  '背景色点「渐变」就能用渐变，26 款预制配色随便挑',
  '渐变角度盘可以拖动，也能点 45°/90° 这类快捷角度，拖动时画布实时预览',
  '按钮想做悬停变色？去「交互状态」挑一个预制动效，再加 0.3s 过渡',
  '想让卡片浮起来？选中卡片加「盒子阴影」，再在 :hover 里加深一档',
  '圆角想要胶囊形状：四值输入填一个很大的值（如 999px）即可',
  '图片设了固定宽高后，用「图片填充模式」选 cover，不变形铺满',
  '毛玻璃、霓虹描边这类组合效果，去「快捷助手 → 效果预设」一键套用',
  '属性面板每条属性左侧的彩色竖线代表分类，颜色一样就是同一类',
  '数值属性下面有一排「常用值胶囊」，点一下直接套用，不用手敲',
  '四值输入框勾上「四边同步」，改一边其余三边跟着变，做等距留白超快',
  '不确定某个属性干什么？把鼠标停在它旁边的「?」上',
  '不确定属性写了没生效？属性行右边出现「⚠ 不生效」就是条件没满足',
  '宽度填 auto 让内容自己撑开，填 100% 则撑满父容器 —— 两者差别很大',
  '行内元素（a / span）设宽高不生效，先把 display 改成 block 或 inline-block',
  '文字想在超出一行时裁掉并显示省略号：white-space: nowrap 配 overflow: hidden',
  '字间距（letter-spacing）稍微加大一点，标题立刻显精致',
  // —— 命名与类名 / ID ——
  '伪类样式必须有类名才导得出去 —— 没名字时面板会闪烁提醒你',
  '多选元素后可以一次性设置类名、关系选择器，批量操作更省事',
  '类名不要起成 main、content 这种太通用的名字，容易撞车',
  '给同一批卡片起同一个类名，改一次全部同步，后期维护最省心',
  '「关系选择器」（如 .card &gt; h3）不用起名也能定位元素，适合深层结构',
  '顶部「⚠」按钮会汇总所有类名 / ID 问题，点开就能逐个处理',
  '「类名」页签能看到每个名字被几个元素使用，还能一键「以此为准统一」冲突样式',
  'ID 在页面里必须唯一，重复了浏览器和脚本都会出问题，⚠ 面板会点名',
  '想换名字不用逐个改：在「类名」页签点「改名」，所有同类元素一起改',
  // —— 响应式 ——
  '顶部设备条随时可切手机 / 平板，不选中任何元素也能看适配效果',
  '属性面板顶部的断点条和画布设备条是同一个开关，改哪边都一样',
  '平板 / 手机端改过的属性会带上「📱覆盖」徽标，点它可以还原成继承电脑端',
  '手机端想让某块内容不显示：切到手机断点，点「🚫 在此设备隐藏」',
  '手机端卡片建议「↔ 撑满全宽」+「🔄 一键切竖排」，阅读体验立刻变好',
  // —— 定位与检查 ——
  '想看清某个元素在哪？在「类名 · ID 总览」点「定位」，画布会自动滚过去并圈出来',
  '定位高亮框会跟着滚动一起走，边滚边看也不怕丢',
  '顶部「轮廓」按钮打开后，所有 div 的占位范围一目了然',
  '开启「轮廓」后同类元素会用相近颜色描边，一眼看出哪些元素是一组',
  '画布上的虚线框只是编辑辅助，导出的网页里完全不会有',
  // —— 页面与输出 ——
  '页面整页背景色在「属性 → 页面」页签里设置，改的是整站外观',
  '「属性 → 页面」里可以关掉浏览器默认的 8px 白边，让页面真正贴边',
  'h1~h6 之间的大空隙来自浏览器默认外边距，勾选「重置标题间距」一键清零',
  '页面全局 CSS 在「属性 → 页面 → 高级 CSS」里写，优先级最高',
  '高级 CSS 里可以写 .banner { } 这样的类规则，配合元素类名做精细调整',
  '导出代码是干净的类名 + 关系选择器，不会塞一堆行内样式',
  '图片建议用相对路径（./images/x.png），导出后双击也能正常显示',
  '导出前先按 <b>Ctrl</b>+<b>P</b> 在浏览器里预览，最稳妥',
  '<b>Ctrl</b>+<b>S</b> 保存的是项目文件（.bcproj），导出网页是 <b>Ctrl</b>+<b>E</b>',
  '<b>Ctrl</b>+<b>Shift</b>+<b>S</b> 另存为，想留多份版本时很方便',
  '项目会定时自动备份快照，误操作后可在「全部项目」里找回历史版本',
  '右下角属性面板的折叠区状态会记住，下次打开还是你熟悉的样子',
  '设置里可以关掉左上角技巧提示（也可以直接点它右侧的 ×），画布会更干净'
];

export function CanvasOverlays() {
  // —— 元素定位脉冲高亮：跟随滚动 / 缩放 / 尺寸变化实时贴合 ——
  const [reveal, setReveal] = useState<{ x: number; y: number; w: number; h: number; label: string } | null>(null);
  const revealTimer = useRef(0);
  const rafRef = useRef(0);
  const targetRef = useRef<HTMLElement | null>(null);
  const labelRef = useRef('');

  useEffect(() => {
    const stop = () => {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      window.clearTimeout(revealTimer.current);
      targetRef.current = null;
      setReveal(null);
    };

    /** 立刻按当前视口重算一次（滚动 / resize 时同步补帧，不必等 rAF 循环） */
    const sync = () => {
      const el = targetRef.current;
      if (!el) return;
      if (!el.isConnected) { stop(); return; }
      const r = el.getBoundingClientRect();
      setReveal({ x: r.left, y: r.top, w: r.width, h: r.height, label: labelRef.current });
    };

    const onReveal = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      if (!id) return;
      window.clearTimeout(revealTimer.current);
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;

      window.setTimeout(() => {
        const el = document.querySelector(`.canvas [data-bc-id="${cssEscape(id)}"]`) as HTMLElement | null;
        if (!el) { setReveal(null); return; }
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        } catch {
          el.scrollIntoView();
        }
        const tag =
          el.getAttribute('data-bc-cg') ||
          el.getAttribute('id') ||
          '<' + el.tagName.toLowerCase() + '>';
        const label = String(tag).startsWith('<') ? tag : (String(tag).startsWith('.') ? tag : '·' + tag);
        targetRef.current = el;
        labelRef.current = label;

        // rAF 循环：滚动 / 缩放 / 布局变化都能跟上
        const loop = () => {
          if (!targetRef.current || !targetRef.current.isConnected) { stop(); return; }
          sync();
          rafRef.current = window.requestAnimationFrame(loop);
        };
        sync();
        loop();
        revealTimer.current = window.setTimeout(stop, 4600);
      }, 40);
    };

    let scrollRaf = 0;
    const onScrollOrResize = () => {
      if (!targetRef.current || scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(() => { scrollRaf = 0; sync(); });
    };
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(onScrollOrResize)
      : null;

    window.addEventListener('bc:reveal-element', onReveal);
    // capture: true —— .canvas-wrap 自身滚动时冒泡不到 window，捕获阶段才能收到
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('wheel', onScrollOrResize, { passive: true });
    if (ro) {
      const wrap = document.querySelector('.canvas-wrap');
      if (wrap) ro.observe(wrap);
    }

    return () => {
      window.removeEventListener('bc:reveal-element', onReveal);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('wheel', onScrollOrResize);
      if (ro) ro.disconnect();
      window.clearTimeout(revealTimer.current);
      window.cancelAnimationFrame(rafRef.current);
      window.cancelAnimationFrame(scrollRaf);
    };
  }, []);

  return (
    <>
      {/* 元素定位高亮环：Portal 到 body，视口坐标 + 滚动实时跟随 */}
      {reveal && createPortal(
        <div
          className="bc-reveal-ring"
          style={{ left: reveal.x - 5, top: reveal.y - 5, width: reveal.w + 10, height: reveal.h + 10 }}
        >
          <span className="bc-reveal-tag">📍 {reveal.label}</span>
        </div>,
        document.body
      )}
    </>
  );
}

function cssEscape(s: string): string {
  try {
    return (window as unknown as { CSS?: { escape?: (v: string) => string } }).CSS?.escape?.(s) ?? s;
  } catch {
    return s;
  }
}

export default CanvasOverlays;
