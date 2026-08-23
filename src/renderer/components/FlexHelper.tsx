import { useScene, findNode, findParent } from '@store/sceneStore';
import { CONTAINER_TAGS } from '@lib/types';
import type { ElementType } from '@lib/types';
import { NumberUnitInput } from './NumberUnitInput';

// BlockCanvas · 布局助手（Flex 中文封装）
// 小白友好：不暴露 display/flex-direction 术语，用「横排/竖排」按钮 + 中文对齐选项。
// 背面生成干净 CSS：display:flex + flex-direction + justify-content/align-items/gap。
// 规则：
//  - 选中容器（div/section/...）时直接编排它的子元素
//  - 选中文本等叶子元素时提供「选中父容器」快捷入口（嵌套层级选择）
//  - 高级用户仍可用「+ 添加属性」加原始的 显示模式/轴线方向 等行，两套并存不冲突

const JUSTIFY_OPTIONS: Array<[string, string]> = [
  ['flex-start', '开头对齐'],
  ['center', '居中'],
  ['flex-end', '结尾对齐'],
  ['space-between', '两端平分'],
  ['space-around', '每项两侧等距'],
  ['space-evenly', '完全均分']
];

const ALIGN_OPTIONS: Array<[string, string]> = [
  ['stretch', '拉伸占满'],
  ['flex-start', '顶部对齐'],
  ['center', '垂直居中'],
  ['flex-end', '底部对齐'],
  ['baseline', '文字基线']
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
        <div className="flex-helper-title">布局助手</div>
        <div className="flex-helper-hint-row">
          <span>弹性布局作用在父容器上：</span>
          <button
            className="btn-mini"
            onClick={() => selectElement(parent.id)}
            title="跳到父容器，设置它的横排/竖排与对齐方式"
          >
            选中父容器设置布局
          </button>
        </div>
      </div>
    );
  }

  const style = node.style ?? {};
  const display = style.display ?? '';
  const flexDir = style.flexDirection ?? 'row';
  const isFlex = display === 'flex';

  const setLayout = (dir: 'row' | 'column') => {
    updateStyle(elementId, { display: 'flex', flexDirection: dir });
  };
  const exitFlex = () => {
    updateStyle(elementId, {
      display: '',
      flexDirection: '',
      justifyContent: '',
      alignItems: '',
      gap: ''
    });
  };

  return (
    <div className={'flex-helper' + (isFlex ? ' flex-helper-active' : '')}>
      <div className="flex-helper-title">
        布局助手
        <span className="flex-helper-scope">控制子元素的排布</span>
      </div>

      <div className="seg-group" role="group" aria-label="排列方向">
        <button
          className={'seg-btn' + (isFlex && flexDir === 'row' ? ' active' : '')}
          onClick={() => setLayout('row')}
          title="横排：子元素从左到右排成一行"
        >
          ⭲ 横排排列
        </button>
        <button
          className={'seg-btn' + (isFlex && flexDir === 'column' ? ' active' : '')}
          onClick={() => setLayout('column')}
          title="竖排：子元素从上到下排成一列"
        >
          ⭳ 竖排排列
        </button>
      </div>

      {isFlex && (
        <>
          <div className="flex-helper-row">
            <label>主轴对齐</label>
            <select
              value={style.justifyContent ?? ''}
              onChange={(e) => updateStyle(elementId, { justifyContent: e.target.value })}
            >
              <option value="">— 未指定 —</option>
              {JUSTIFY_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex-helper-row">
            <label>交叉轴对齐</label>
            <select
              value={style.alignItems ?? ''}
              onChange={(e) => updateStyle(elementId, { alignItems: e.target.value })}
            >
              <option value="">— 未指定 —</option>
              {ALIGN_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex-helper-row">
            <label>子元素间距</label>
            <NumberUnitInput elementId={elementId} schemaKey="gap" unit="px" />
          </div>
          <div className="flex-helper-row flex-helper-exit">
            <button className="flex-exit-btn" onClick={exitFlex} title="恢复默认块级布局，并清空对齐与间距设置">
              退出弹性布局
            </button>
          </div>
        </>
      )}

      {!isFlex && (
        <div className="flex-helper-hint-row">
          <span>点「横排 / 竖排」后，子元素会自动排开，还能调对齐方式与间距。</span>
        </div>
      )}
    </div>
  );
}
