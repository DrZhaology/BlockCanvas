import { useEffect, useRef, useState } from 'react';
import { DEVICE_LIST, widthToDevice, requestDevice, widthLabel } from '@lib/device';

// BlockCanvas · 画布区浮层集合
//  1. 顶部设备切换条：电脑 / 平板 / 手机 —— **不需要选中任何元素** 也能切换，
//     方便随时检查同一个页面在不同设备下的适配情况（与画布宽度、编辑断点三者合一）
//  2. 左上角编辑器技巧提示：每 30 秒随机换一条，看一眼就学会一个小技巧（可在设置里关掉）
//  3. 元素定位脉冲高亮环：类名/ID 总览点「定位」时，自动滚动到元素并圈出，
//     滚动 / 缩放期间实时跟随，不会出现"页面滑走了框还留在原地"

interface Props {
  canvasWidth: string;
}

/** 技巧提示总开关（设置页可关；默认开） */
export const TIPS_KEY = 'bc-canvas-tips';

export function tipsEnabled(): boolean {
  try { return localStorage.getItem(TIPS_KEY) !== '0'; } catch { return true; }
}

const TIPS: string[] = [
  '按住 <b>Shift</b> + 点 <kbd>?</kbd>（或 <kbd>Shift</kbd>+<kbd>/</kbd>）打开全部快捷键',
  '双击画布上的文字，可以直接就地修改文案',
  '<b>Ctrl</b> + 点击元素 = 多选；空白处拖框可批量选中',
  '<b>Alt</b> + 点击元素 = 直接选中它的父级容器',
  '<b>Ctrl</b> + 滚轮 = 缩放画布，比例会实时显示在工具栏',
  '选中元素后按方向键微调位置，按住 <b>Shift</b> 一次走 10px',
  '拖动画布左右边缘，可以任意调整页面宽度看适配效果',
  '给元素起一个「类名」，同类元素改一个样式就全部跟着变',
  '布局用「快捷助手」里的弹性 Flex，横排竖排一句话搞定',
  '按钮想做悬停变色？去「交互状态」挑一个预制动效，再加 0.3s 过渡',
  '「快捷助手 → 文字渐变」能让标题穿上渐变色，一秒变高级',
  '模板页右上角的「撑开口袋」，可以把模板库拉高看更多',
  '顶部「轮廓」按钮打开后，所有 div 的占位范围一目了然',
  '导出前先按 <b>Ctrl</b>+<b>P</b> 在浏览器里预览，最稳妥',
  '想复制一个一模一样的元素？按 <b>Ctrl</b>+<b>D</b> 原地生成副本',
  '粘贴会插进当前选中元素的内部，不用再手动挪层级',
  '右下角属性面板的折叠区状态会记住，下次打开还是你熟悉的样子',
  '不确定某个属性干什么？把鼠标停在它旁边的「?」上',
  '页面整页背景色在「属性 → 页面」页签里设置，改的是整站外观',
  '图片建议用相对路径（./images/x.png），导出后双击也能正常显示',
  '属性面板每条属性左侧的彩色竖线代表分类，颜色一样就是同一类',
  '四值输入框勾上「四边同步」，改一边其余三边跟着变，做等距留白超快',
  '背景色点「渐变」就能用渐变，26 款预制配色随便挑',
  '伪类样式必须有类名才导得出去 —— 没名字时面板会红框提醒你',
  '<b>Ctrl</b>+<b>S</b> 保存的是项目文件（.bcproj），导出网页是 <b>Ctrl</b>+<b>E</b>',
  '不小心删错了？<b>Ctrl</b>+<b>Z</b> 撤销，<b>Ctrl</b>+<b>Shift</b>+<b>Z</b> 重做',
  '多选元素后可以一次性设置类名、关系选择器，批量操作更省事',
  '想看清某个元素在哪？在「类名 · ID 总览」点「定位」，画布会自动滚过去并圈出来',
  '「属性 → 页面」里可以关掉浏览器默认的 8px 白边，让页面真正贴边',
  '图片设了固定宽高后，用「图片填充模式」选 cover，不变形铺满',
  '间距别用空 div 硬撑，用父容器的 gap 一次性给所有子元素留缝',
  '想让卡片浮起来？选中卡片加「盒子阴影」，再在 :hover 里加深一档',
  '顶部设备条随时可切手机/平板，不选中任何元素也能看适配效果',
  '不确定属性写了没生效？属性行右边出现「⚠ 不生效」就是条件没满足',
  '类名不要起成 main、content 这种太通用的名字，容易撞车',
  '导出代码是干净的类名 + 关系选择器，不会塞一堆行内样式',
  '顶部「⚠」按钮会汇总所有类名 / ID 问题，点开就能逐个处理',
  '画布上的虚线框只是编辑辅助，导出的网页里完全不会有',
  '给同一批卡片起同一个类名，改一次全部同步，后期维护最省心',
  '页面全局 CSS 在「属性 → 页面 → 高级 CSS」里写，优先级最高'
];

const TIP_INTERVAL = 30000; // 30 秒换一条

export function CanvasOverlays({ canvasWidth }: Props) {
  const device = widthToDevice(canvasWidth);

  // —— 技巧提示：30 秒随机切换（带淡出→换字→淡入），可在设置里关闭 ——
  const [tipsOn, setTipsOn] = useState<boolean>(() => tipsEnabled());
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const onChanged = () => setTipsOn(tipsEnabled());
    window.addEventListener('bc:canvas-tips-changed', onChanged);
    window.addEventListener('storage', onChanged);
    return () => {
      window.removeEventListener('bc:canvas-tips-changed', onChanged);
      window.removeEventListener('storage', onChanged);
    };
  }, []);

  useEffect(() => {
    if (!tipsOn) return;
    const timer = window.setInterval(() => {
      setSwitching(true);
      window.setTimeout(() => {
        setTipIdx((prev) => {
          if (TIPS.length <= 1) return prev;
          let n = Math.floor(Math.random() * TIPS.length);
          while (n === prev) n = Math.floor(Math.random() * TIPS.length);
          return n;
        });
        setSwitching(false);
      }, 420);
    }, TIP_INTERVAL);
    return () => window.clearInterval(timer);
  }, [tipsOn]);

  // —— 元素定位脉冲高亮：跟随滚动 / 缩放实时贴合 ——
  const [reveal, setReveal] = useState<{ x: number; y: number; w: number; h: number; label: string } | null>(null);
  const revealTimer = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const onReveal = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      if (!id) return;
      window.clearTimeout(revealTimer.current);
      window.cancelAnimationFrame(rafRef.current);

      window.setTimeout(() => {
        const el = document.querySelector(`.canvas [data-bc-id="${cssEscape(id)}"]`) as HTMLElement | null;
        if (!el) return;
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

        // 高亮环存在期间持续跟随：滚动 / 缩放 / 布局变化都能跟上
        const loop = () => {
          if (!el.isConnected) { setReveal(null); return; }
          const r = el.getBoundingClientRect();
          setReveal({ x: r.left, y: r.top, w: r.width, h: r.height, label });
          rafRef.current = window.requestAnimationFrame(loop);
        };
        loop();
        revealTimer.current = window.setTimeout(() => {
          window.cancelAnimationFrame(rafRef.current);
          setReveal(null);
        }, 2600);
      }, 40);
    };

    window.addEventListener('bc:reveal-element', onReveal);
    return () => {
      window.removeEventListener('bc:reveal-element', onReveal);
      window.clearTimeout(revealTimer.current);
      window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      {/* 设备切换条：未选中元素时同样可用 */}
      <div className="device-bar" title="切换设备预览：画布宽度与编辑断点会一起变化（无需选中元素）">
        {DEVICE_LIST.map((d) => (
          <button
            key={d.id}
            className={'device-btn' + (device === d.id ? ' active' : '')}
            onClick={() => requestDevice(d.id)}
            title={d.hint}
          >
            {d.icon} {d.label}
          </button>
        ))}
        <span className="device-bar-sep" />
        <span className="device-bar-width" title="当前画布宽度（也可拖动画布左右边缘自定义）">
          {widthLabel(canvasWidth)}
        </span>
      </div>

      {/* 左上角技巧提示（可在「设置 → 个性化与外观」关闭） */}
      {tipsOn && (
        <div className={'canvas-tips' + (switching ? ' is-switching' : '')}>
          <span className="canvas-tips-icon">💡</span>
          <span className="canvas-tips-text" dangerouslySetInnerHTML={{ __html: TIPS[tipIdx] }} />
        </div>
      )}

      {/* 元素定位高亮环：跟随滚动实时贴合 */}
      {reveal && (
        <div
          className="bc-reveal-ring"
          style={{ left: reveal.x - 4, top: reveal.y - 4, width: reveal.w + 8, height: reveal.h + 8 }}
        >
          <span className="bc-reveal-tag">📍 {reveal.label}</span>
        </div>
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
