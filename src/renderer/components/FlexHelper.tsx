import { useScene, findNode, findParent } from '@store/sceneStore';
import { CONTAINER_TAGS } from '@lib/types';
import type { ElementType } from '@lib/types';
import { NumberUnitInput } from './NumberUnitInput';
import { HelpButton } from './HelpButton';

// BlockCanvas · 布局助手（Flex 弹性 + Grid 现代网格可视化封装）
// 设计理念：
//  - 小白友好：只要看得懂中文就能随心所欲完成专业排版；
//  - 专业透明：每个设置项都同时展示通俗中文与标准 CSS 属性名（如 justify-content、grid-template-columns）；
//  - 模式切换：默认流式 / ⭲ Flex 弹性横竖排 / ⊞ Grid 现代二维网格。

const JUSTIFY_OPTIONS: Array<[string, string]> = [
  ['flex-start', '开头对齐 (flex-start)'],
  ['center', '居中对齐 (center)'],
  ['flex-end', '结尾靠拢 (flex-end)'],
  ['space-between', '两端贴边平分 (space-between)'],
  ['space-around', '每项两侧等距 (space-around)'],
  ['space-evenly', '整体完全均分 (space-evenly)']
];

const ALIGN_OPTIONS: Array<[string, string]> = [
  ['stretch', '拉伸占满 (stretch)'],
  ['flex-start', '顶部对齐 (flex-start)'],
  ['center', '垂直居中 (center)'],
  ['flex-end', '底部对齐 (flex-end)'],
  ['baseline', '文字基线 (baseline)']
];

const GRID_PRESETS: Array<{ label: string; value: string; desc: string }> = [
  { label: '2 列等分', value: 'repeat(2, 1fr)', desc: '并排 2 列，宽度均分' },
  { label: '3 列等分', value: 'repeat(3, 1fr)', desc: '并排 3 列，卡片组常用' },
  { label: '4 列等分', value: 'repeat(4, 1fr)', desc: '并排 4 列，多数据展示' },
  { label: '自适应流', value: 'repeat(auto-fill, minmax(220px, 1fr))', desc: '智能响应式：随窗口变窄自动换列' },
  { label: '侧栏+主区', value: '240px 1fr', desc: '左侧固定 240px，右侧撑满' }
];

export function FlexHelper(props: { elementId: string; elementType: ElementType }) {
  const { elementId, elementType } = props;
  const scene = useScene((s) => s.scene);
  const updateStyle = useScene((s) => s.updateStyle);
  const selectElement = useScene((s) => s.selectElement);

  const node = findNode(scene.root, elementId);
  if (!node) return null;

  // 叶子元素：提供「选中父容器」入口（嵌套层级选择）
  if (!CONTAINER_TAGS.has(elementType)) {
    const parent = findParent(scene.root, elementId);
    if (!parent) return null;
    return (
      <div className="flex-helper flex-helper-hint">
        <div className="flex-helper-title">
          布局助手
          <HelpButton
            title="布局助手"
            content={'弹性与网格布局是定义在【父容器】上的：\n\n· 父容器（如 div / section / header 等）决定里面所有子元素怎么排（横排、网格、对齐方式、间距）。\n· 点击下方按钮直接选中父级容器进行排版设置。'}
          />
        </div>
        <div className="flex-helper-hint-row">
          <span>当前是叶子元素，排版由父容器控制：</span>
          <button
            className="btn-mini"
            onClick={() => selectElement(parent.id)}
            title="跳到父容器设置它的 Flex/Grid 布局"
          >
            选中父级 &lt;{parent.type}&gt; 设布局
          </button>
        </div>
      </div>
    );
  }

  const style = node.style ?? {};
  const display = style.display ?? '';
  const flexDir = style.flexDirection ?? 'row';
  const isFlex = display === 'flex';
  const isGrid = display === 'grid';
  const mode = isGrid ? 'grid' : isFlex ? 'flex' : 'block';

  const setMode = (nextMode: 'block' | 'flex' | 'grid') => {
    if (nextMode === 'block') {
      updateStyle(elementId, {
        display: '',
        flexDirection: '',
        justifyContent: '',
        alignItems: '',
        gap: '',
        flexWrap: '',
        gridTemplateColumns: '',
        gridTemplateRows: '',
        justifyItems: ''
      });
    } else if (nextMode === 'flex') {
      updateStyle(elementId, {
        display: 'flex',
        flexDirection: style.flexDirection || 'row',
        gap: style.gap || '16px',
        gridTemplateColumns: '',
        gridTemplateRows: '',
        justifyItems: ''
      });
    } else if (nextMode === 'grid') {
      updateStyle(elementId, {
        display: 'grid',
        gridTemplateColumns: style.gridTemplateColumns || 'repeat(3, 1fr)',
        gap: style.gap || '16px',
        flexDirection: '',
        justifyContent: '',
        flexWrap: ''
      });
    }
  };

  return (
    <div className={'flex-helper' + (mode !== 'block' ? ' flex-helper-active' : '')}>
      <div className="flex-helper-title">
        布局助手 (display)
        <HelpButton
          title="布局模式介绍"
          content={'网页的三大主流布局方式：\n\n1. 默认流式 (block)：子元素从上到下像写文章一样自然垂直堆叠。\n\n2. 弹性布局 (flex)：子元素横向排成一行（可随时切换竖排），支持灵活对齐与自动折行。\n\n3. 网格布局 (grid)：现代强大的二维网格系统，做多列等分卡片、响应式卡片流最强大省心！'}
        />
        <span className="flex-helper-scope">控制子元素排列</span>
      </div>

      <div className="seg-group" role="group" aria-label="布局模式">
        <button
          className={'seg-btn' + (mode === 'block' ? ' active' : '')}
          onClick={() => setMode('block')}
          title="默认流式布局：子元素垂直向下堆叠"
        >
          默认流式
        </button>
        <button
          className={'seg-btn' + (mode === 'flex' ? ' active' : '')}
          onClick={() => setMode('flex')}
          title="Flex 弹性布局：支持横竖排、对齐、自动换行"
        >
          ⭲ 弹性 Flex
        </button>
        <button
          className={'seg-btn' + (mode === 'grid' ? ' active' : '')}
          onClick={() => setMode('grid')}
          title="Grid 网格布局：快速分列排版"
        >
          ⊞ 网格 Grid
        </button>
      </div>

      {/* ——— Flex 弹性布局面板 ——— */}
      {isFlex && (
        <>
          <div className="flex-helper-row">
            <label>轴线方向 (flex-direction)</label>
            <div className="flex-mini-seg">
              <button
                className={'flex-mini-btn' + (flexDir === 'row' ? ' active' : '')}
                onClick={() => updateStyle(elementId, { flexDirection: 'row' })}
                title="横排从左到右 (row)"
              >⭲ 横排</button>
              <button
                className={'flex-mini-btn' + (flexDir === 'column' ? ' active' : '')}
                onClick={() => updateStyle(elementId, { flexDirection: 'column' })}
                title="竖排从上到下 (column)"
              >⭳ 竖排</button>
            </div>
          </div>

          <div className="flex-helper-row">
            <label>主轴对齐 (justify-content)</label>
            <select
              value={style.justifyContent ?? ''}
              onChange={(e) => updateStyle(elementId, { justifyContent: e.target.value })}
            >
              <option value="">— 默认 (开头靠拢) —</option>
              {JUSTIFY_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex-helper-row">
            <label>交叉轴对齐 (align-items)</label>
            <select
              value={style.alignItems ?? ''}
              onChange={(e) => updateStyle(elementId, { alignItems: e.target.value })}
            >
              <option value="">— 默认 (拉伸占满) —</option>
              {ALIGN_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex-helper-row">
            <label>自动换行 (flex-wrap)</label>
            <select
              value={style.flexWrap ?? ''}
              onChange={(e) => updateStyle(elementId, { flexWrap: e.target.value })}
            >
              <option value="">不换行 (nowrap) · 单行挤压</option>
              <option value="wrap">wrap · 自动折行（多卡片推荐）</option>
              <option value="wrap-reverse">wrap-reverse · 反向折行</option>
            </select>
          </div>

          <div className="flex-helper-row">
            <label>元素间距 (gap)</label>
            <NumberUnitInput elementId={elementId} schemaKey="gap" unit="px" />
          </div>

          <div className="flex-helper-row flex-helper-exit">
            <button className="flex-exit-btn" onClick={() => setMode('block')} title="恢复默认块级流式布局">
              恢复默认流式
            </button>
          </div>
        </>
      )}

      {/* ——— Grid 网格布局面板 ——— */}
      {isGrid && (
        <>
          <div className="flex-helper-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>网格预设 (常用多列模板)</span>
              <span className="field-hint">点击快速应用</span>
            </label>
            <div className="grid-preset-grid">
              {GRID_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={'grid-preset-btn' + (style.gridTemplateColumns === p.value ? ' active' : '')}
                  onClick={() => updateStyle(elementId, { gridTemplateColumns: p.value })}
                  title={p.desc}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-helper-row">
            <label>列模板 (grid-template-columns)</label>
            <input
              type="text"
              className="grid-template-input"
              value={style.gridTemplateColumns ?? ''}
              placeholder="例：repeat(3, 1fr) 或 200px 1fr"
              spellCheck={false}
              onChange={(e) => updateStyle(elementId, { gridTemplateColumns: e.target.value })}
            />
          </div>

          <div className="flex-helper-row">
            <label>网格间距 (gap)</label>
            <NumberUnitInput elementId={elementId} schemaKey="gap" unit="px" />
          </div>

          <div className="flex-helper-row">
            <label>单元格对齐 (justify-items)</label>
            <select
              value={style.justifyItems ?? ''}
              onChange={(e) => updateStyle(elementId, { justifyItems: e.target.value })}
            >
              <option value="">拉伸铺满 (stretch)</option>
              <option value="start">靠左对齐 (start)</option>
              <option value="center">水平居中 (center)</option>
              <option value="end">靠右对齐 (end)</option>
            </select>
          </div>

          <div className="flex-helper-row flex-helper-exit">
            <button className="flex-exit-btn" onClick={() => setMode('block')} title="恢复默认块级流式布局">
              恢复默认流式
            </button>
          </div>
        </>
      )}

      {mode === 'block' && (
        <div className="flex-helper-hint-row">
          <span>当前为常规流式垂直堆叠。点「弹性 Flex」或「网格 Grid」可快速实现横向多列卡片排列。</span>
        </div>
      )}
    </div>
  );
}
