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
  '按住 <b>Shift</b> + 点 <kbd>?</kbd>（或 <kbd>Shift</kbd>+<kbd>/</kbd>）随时打开全部快捷键速查表',
  '双击画布上的文字，可以直接就地进入输入框修改文案',
  '<b>Ctrl</b> + 点击元素 = 多选；在画布空白处按住左键拖框可批量圈选',
  '<b>Alt</b> + 点击元素 = 穿透选中它的上一层父级容器',
  '<b>Ctrl</b> + 滚轮 = 缩放画布，比例会实时显示在工具栏',
  '选中元素后按方向键微调位置，按住 <b>Shift</b> 一次走 10px',
  '拖动画布左右边缘的手柄，可以任意调整页面宽度看自适应效果',
  '给元素起一个「类名」，同类名元素修改一个样式，其余所有元素全部同步',
  '布局首选用「快捷助手」里的弹性 Flex，横排竖排一句话搞定',
  '按钮想做悬停变色？去「交互状态」挑选预制动效，再加 0.3s 平滑过渡',
  '「快捷助手 → 文字渐变」能让标题穿上炫彩渐变色，一秒变高级设计',
  '模板页右上角的「撑开口袋」，可以把模板库拉高，大面积浏览挑拣',
  '顶部「轮廓」按钮打开后，所有容器 div 的边界占位范围一目了然',
  '导出前先按 <b>Ctrl</b>+<b>P</b> 在默认浏览器里预览，所见即所得最稳妥',
  '想复制一个一模一样的元素？按 <b>Ctrl</b>+<b>D</b> 原地生成副本',
  '粘贴会自动插入当前选中元素的内部，不用再手动挪动 DOM 层级',
  '右下角属性面板的折叠区状态会按选择器记忆，下次点它还是熟悉的界面',
  '不确定某个属性干什么？把鼠标停在它旁边的「?」小图标上查看图文讲解',
  '页面整页背景色在「属性 → 页面」页签里设置，改的是整站统一基调',
  '图片建议用相对路径（./images/x.png），导出后直接双击本地 html 也能显示',
  '属性面板每条属性左侧都有专属彩色竖线，颜色相同即代表属于同一分类',
  '四值输入框勾上「四边同步」，改一边其余三边跟着变，做四周等距留白超快',
  '背景色点击「渐变」即可切到 PowerPoint 风格方向盘，26 款精选配色随选',
  '伪类动效（:hover/:active）需要设置类名才可编译为 CSS 规则并在浏览器生效',
  '<b>Ctrl</b>+<b>S</b> 保存的是项目工程（.bcproj），导出纯净网页请按 <b>Ctrl</b>+<b>E</b>',
  '不小心改错或删除了？按 <b>Ctrl</b>+<b>Z</b> 即可一步步撤销恢复',
  '多选元素后可以一次性批量设置类名、关系选择器，批量调样式省时省力',
  '想找某个元素在哪？在「类名 · ID 总览」点「定位」，画布会自动平滑滚过去并高亮',
  '「属性 → 页面」里勾选「去掉浏览器默认白边」，让网页真正贴紧窗口',
  '图片设了固定宽高后，把「图片填充模式」设为 cover，图片不变形铺满',
  '容器内子元素间距推荐用父容器的 gap，一次性为所有卡片留出均等缝隙',
  '卡片悬浮感：先加「盒子阴影」，再去 :hover 标签里给它加深一档或加位移',
  '顶部设备条随时可切换电脑、平板与手机，不选中任何元素也能随时看响应式',
  '不确定属性为何没起作用？属性行右侧若出现「⚠ 不生效」通常是布局条件未满足',
  '类名起名推荐用小写短横线，例如 card-item、hero-banner，语义清晰不撞车',
  '导出的代码完全没有依赖包，是人手写级的纯净 HTML + 结构化 CSS 文件',
  '顶部「⚠」按钮会实时分析类名 ID 潜在问题，点开可一键解决同名样式冲突',
  '画布上的蓝色选择框和辅助虚线仅供编辑参考，导出的网页绝不包含任何杂质',
  '手机模式下，点击「一键切竖排」，横排卡片立刻自适应变为纵向单列',
  '在手机端不想展示某个元素？切到手机模式点「🚫 在此设备隐藏」即可',
  '属性行右侧亮起「📱覆盖 ↺」蓝标时，点击它就能一秒还原回电脑端的继承样式',
  '按 <kbd>Esc</kbd> 键可以随时一键清空选中状态，退出聚焦',
  '按钮按下动效：在「交互状态」选 :active 加上缩放 0.96，点击手感极佳',
  '文字行高推荐设置在 1.5 到 1.8 之间，是公认最舒服的中文段落排版行距',
  '卡片圆角推荐 8px ~ 12px，现代精致圆润，适合绝大部分现代网页风格',
  '阴影用 rgba(0,0,0,0.08) 既柔和又立体，比起生硬的纯黑阴影高级很多',
  '善用关系选择器如 .card > h3，不用给每个标题单独命名也能统一批量改样式',
  '设置中心提供自动清洁选项，可在启动时自动清理 Chromium 编译缓存，保持轻盈',
  '在图层管理器中上下拖拽，可以直接调整 DOM 节点的前后顺序和包含层级',
  '想要整个网页变成黑客酷黑风？去「属性 → 页面」直接修改 body 背景色',
  '文字渐变在所有现代主流浏览器中都有极佳的兼容性，不用切图就能做出酷炫字',
  '调色盘支持直接粘贴 Hex、RGB、RGBA 甚至 transparent，随心所欲调配',
  '如果不希望某个透明装饰图层挡住下层点击，可把它的 pointer-events 设为 none',
  '所有设置与偏好（包括折叠状态、面板宽度、窗口位置）都会在本地自动记住'
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
          // 如果元素滑出当前视口，高亮环自动隐藏，不浮在奇怪的位置
          if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
            setReveal(null);
          } else {
            setReveal({ x: r.left, y: r.top, w: r.width, h: r.height, label });
          }
          rafRef.current = window.requestAnimationFrame(loop);
        };
        loop();
        revealTimer.current = window.setTimeout(() => {
          window.cancelAnimationFrame(rafRef.current);
          setReveal(null);
        }, 3200);
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
