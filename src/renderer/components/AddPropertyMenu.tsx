import { useState, useEffect, useRef } from 'react';
import { SCHEMA, checkApplicability } from '@lib/propertySchema';
import type { PropertySchema, PropertyCategory } from '@lib/propertySchema';
import type { ElementType } from '@lib/types';
import { getPluginProperties } from '@lib/pluginHost';

// BlockCanvas · "+ 添加属性"下拉
// - 按类别分组展示；顶部搜索框支持中英文（中文名 / 英文 key / 类别 / 4 边 key）
// - 动态检测适用性：对当前不适用的属性置灰显示并标注原因（如行内元素不能设外边距等）
// - 统一对齐：左侧统一 [父]/[子] 标识占位与属性名，右侧展示类别与不生效提示

interface Props {
  type: ElementType;
  elementStyle?: Record<string, string | undefined>;
  visibleKeys: string[];      // 已显示的属性 key 列表
  onAdd: (key: string) => void;
}

const CATEGORY_ORDER: PropertyCategory[] = [
  '盒模型', '颜色', '字体与排版', '边框与阴影', '列表', '多媒体', '定位', 'Flex & Grid 布局', '其他'
];

// 智能中文别名、拼音缩写与模糊搜索词典
const SEARCH_ALIASES: Record<string, string[]> = {
  // 盒模型
  width: ['kuandu', 'kd', 'w', 'kuan', '宽', '宽度', '尺寸', 'size', '横向尺寸'],
  height: ['gaodu', 'gd', 'h', 'gao', '高', '高度', '尺寸', 'size', '纵向尺寸'],
  minWidth: ['zuixiaokuandu', 'zxkd', 'minw', '最小宽', '下限', '保底宽'],
  maxWidth: ['zuidakuandu', 'zdkd', 'maxw', '最大宽', '上限', '封顶宽'],
  minHeight: ['zuixiaogaodu', 'zxgd', 'minh', '最小高', '下限', '保底高'],
  maxHeight: ['zuidagaodu', 'zdgd', 'maxh', '最大高', '上限', '封顶高', '最高限制'],
  padding: ['neibianju', 'nbj', 'pad', 'padding', '内边距', '内留白', '内容内衬', '填充', '留白', '四周内距'],
  margin: ['waibianju', 'wbj', 'mar', 'margin', '外边距', '外留白', '间距', '居中', '元素间隔', '留白'],
  boxSizing: ['hepingce', 'heboxing', 'box', 'sizing', '盒模型', '计算方式', '边框盒', '怪异盒', '标准盒'],

  // 颜色
  backgroundColor: ['beijingse', 'beijing', 'bjs', 'bg', 'background', '底色', '背景', '背景颜色', '填充色', '色块'],
  color: ['wenziyanse', 'yanse', 'wenzise', 'wzs', 'ys', 'color', 'text', 'fontcolor', '文字颜色', '字体颜色', '字色', '正文颜色'],
  opacity: ['toumingdu', 'butoumingdu', 'tmd', 'tm', 'opacity', 'alpha', '透明度', '不透明度', '半透明', '遮罩', '隐现', '透光'],

  // 字体与排版
  fontSize: ['zihao', 'ziti', 'zh', 'font', 'size', '字号', '文字大小', '字体大小', '大字', '小字'],
  fontWeight: ['ziti', 'cuxi', 'jiacu', 'cx', 'weight', 'bold', '粗细', '加粗', '字重', '粗体', '细体'],
  fontFamily: ['ziti', 'zitizu', 'zt', 'font', 'family', '字体', '字体族', '微软雅黑', '苹方', '宋体', '代码等宽'],
  lineHeight: ['hanggao', 'hangju', 'hg', 'line', 'height', '行高', '行距', '文字行距', '段落行高'],
  textAlign: ['duiqi', 'juzhong', 'dq', 'align', 'text', 'center', '文字对齐', '对齐方式', '居中', '靠左', '靠右'],
  letterSpacing: ['zijianju', 'jianju', 'zjj', 'spacing', 'letter', '字间距', '字符间距', '字距'],
  textDecoration: ['xiushixian', 'xiahuaxian', 'shanchuxian', 'xhx', 'underline', '下划线', '删除线', '修饰线', '上划线'],
  textTransform: ['daxiaoxie', 'daxie', 'xiaoxie', 'dxx', 'case', 'upper', 'lower', '大小写', '大写', '小写', '首字母大写'],
  whiteSpace: ['huanhang', 'zhehang', 'hh', 'wrap', 'nowrap', '换行', '折行', '不换行', '强制一行'],
  wordBreak: ['duanhang', 'danci', 'break', 'word', '单词断行', '断行', '自动换行', '防撑破'],
  direction: ['fangxiang', 'yuedu', 'dir', 'rtl', 'ltr', '文字方向', '阅读方向', '从右向左'],

  // 边框与阴影
  border: ['biankuang', 'miaobian', 'bk', 'mb', 'border', 'line', '边框', '描边', '线框', '边线', '四周描边'],
  borderWidth: ['biankuangcuxi', 'bkcx', 'bkw', '边框粗细', '边框宽度', '线粗'],
  borderStyle: ['biankuangxianxing', 'bkxx', 'style', 'solid', 'dashed', '边框样式', '实线', '虚线', '点线'],
  borderColor: ['biankuangyanse', 'bkys', '边框颜色', '描边色', '边线颜色'],
  borderRadius: ['yuanjiao', 'daojiao', 'hudu', 'yj', 'radius', 'round', 'corner', 'pill', '圆角', '倒角', '弧度', '胶囊', '圆形', '四角圆润'],
  boxShadow: ['yinying', 'touying', 'faguang', 'xuanfu', 'yy', 'ty', 'shadow', 'elevation', 'glow', '3d', '阴影', '盒子阴影', '立体投影', '发光', '悬浮立体', '弥散阴影', '霓虹'],
  textShadow: ['wenziyinying', 'zitifaguang', 'wzyy', 'textshadow', 'glow', '文字阴影', '立体字', '文字发光', '霓虹字', '描边投影'],

  // 动画与交互
  transform: ['bianhuan', 'suofang', 'weiyi', 'xuanzhuan', 'qingxie', 'fangda', 'suoxiao', 'bh', 'sf', 'wy', 'xz', 'scale', 'translate', 'rotate', 'skew', 'move', 'zoom', '变换', '缩放', '位移', '旋转', '倾斜', '放大', '上浮', '下沉'],
  transition: ['guodu', 'donghua', 'pinghua', 'huandong', 'gd', 'dh', 'trans', 'transition', 'anim', 'ease', '过渡', '平滑过渡', '过渡动画', '动效', '缓动', '渐变时长', '交互动画'],
  cursor: ['shubiao', 'zhizhen', 'shouxing', 'guangbiao', 'dianji', 'sb', 'zz', 'sx', 'gb', 'cursor', 'pointer', 'hand', 'mouse', 'click', '鼠标', '指针', '手型', '光标', '鼠标手势', '点击样式'],

  // 定位与层级
  position: ['dingwei', 'juedui', 'guding', 'dw', 'pos', 'position', 'absolute', 'fixed', 'sticky', 'relative', '定位', '绝对定位', '固定定位', '吸顶', '相对定位'],
  top: ['shangpianyi', 'dingbu', 'top', '上偏移', '顶部距离', 'Y坐标'],
  bottom: ['xiapianyi', 'dibu', 'bottom', '下偏移', '底部距离'],
  left: ['zuopianyi', 'left', '左偏移', '左侧距离', 'X坐标'],
  right: ['youpianyi', 'right', '右偏移', '右侧距离'],
  zIndex: ['cengji', 'fugai', 'shunxu', 'zhedang', 'cj', 'zindex', 'layer', 'depth', 'stack', '层级', '前后顺序', '谁盖住谁', '遮挡', 'Z轴'],

  // 布局
  display: ['buju', 'xianshi', 'hengpai', 'shupai', 'flex', 'block', 'grid', 'none', '布局', '显示模式', '弹性布局', '弹性容器', '隐藏'],
  flexDirection: ['fangxiang', 'hengpai', 'shupai', 'dir', 'row', 'column', '排列方向', '横排', '竖排', '主轴方向'],
  flexWrap: ['huanhang', 'zhedie', 'wrap', '换行', '多行排布', '允许换行'],
  justifyContent: ['zhuzhou', 'hengxiang', 'juzhong', 'liangduan', 'justify', 'center', 'space', '主轴对齐', '水平对齐', '两端对齐', '等间距'],
  alignItems: ['cizhou', 'zongxiang', 'juzhong', 'align', 'items', 'center', '交叉轴对齐', '垂直对齐', '居中对齐'],
  gap: ['jianju', 'kongxi', 'jianpan', 'gap', 'space', '子元素间距', '行列间距', '卡片间隔'],

  // 其他
  overflow: ['yichu', 'gundong', 'caijian', 'yincang', 'yc', 'gd', 'overflow', 'scroll', 'hidden', 'auto', '溢出', '滚动条', '隐藏超出', '内容滚动']
};

export function AddPropertyMenu(props: Props) {
  const [open, setOpen] = useState(false);
  // 关闭时先播出场动画再卸载（0.18s）
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(0);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const closeMenu = () => {
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, 180);
  };

  // 打开菜单：清空搜索并聚焦搜索框
  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const q = search.trim().toLowerCase();

  const matches = (s: PropertySchema): boolean => {
    if (!q) return true;
    const camelDash = s.key.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
    const sideKeys = (s.sides ?? []).map((sd) => sd.key).join(' ');
    const aliases = (SEARCH_ALIASES[s.key] ?? []).join(' ');
    const hay = `${s.label} ${s.key} ${camelDash} ${sideKeys} ${s.category} ${s.placeholder ?? ''} ${aliases}`.toLowerCase();
    
    // 支持按空格分词搜索（例如 "文字 居中"、"bg tm"）
    const tokens = q.split(/\s+/).filter(Boolean);
    return tokens.every((token) => hay.includes(token));
  };

  // 候选 = 该元素还没显示的属性（含插件扩展属性）
  const allSchema = [...SCHEMA, ...getPluginProperties()];
  const baseCandidates = allSchema.filter((s) => !props.visibleKeys.includes(s.key));
  // 搜索过滤后的展示列表
  const candidates = q ? baseCandidates.filter(matches) : baseCandidates;

  // 按类别分组
  const grouped: Record<PropertyCategory, PropertySchema[]> = {
    '盒模型': [], '颜色': [], '字体与排版': [], '边框与阴影': [], '列表': [], '多媒体': [], '定位': [], 'Flex & Grid 布局': [], '其他': []
  };
  for (const c of candidates) {
    if (grouped[c.category]) grouped[c.category].push(c);
    else (grouped['其他'] = grouped['其他'] || []).push(c);
  }

  const addAndClose = (key: string) => {
    props.onAdd(key);
    setSearch('');
    closeMenu();
  };

  const renderItem = (s: PropertySchema) => {
    const app = checkApplicability(s, props.type, props.elementStyle);
    return (
      <button
        key={s.key}
        className={"add-prop-item" + (!app.applicable ? " is-disabled" : "")}
        onClick={() => { if (app.applicable) addAndClose(s.key); }}
        disabled={!app.applicable}
        title={!app.applicable ? `暂不可用: ${app.disabledReason}` : s.help ? `${s.label}\n${s.help.content}` : s.label}
      >
        <div className="add-prop-item-left">
          {s.scope ? (
            <span className="prop-scope" title={s.scope === '父' ? '作用在父容器上，管子元素排布' : '作用在自身/子元素上'}>{s.scope}</span>
          ) : (
            <span className="prop-scope-space" />
          )}
          <span className="add-prop-item-label">{s.label}</span>
        </div>
        <div className="add-prop-item-right">
          {!app.applicable && <span className="add-prop-disabled-tag" title={app.disabledReason}>不生效</span>}
          {q && <span className="add-prop-item-cat">{s.category}</span>}
        </div>
      </button>
    );
  };

  return (
    <div className="add-prop-wrap">
      <button
        className="add-prop-trigger"
        onClick={() => setOpen(!open)}
        disabled={baseCandidates.length === 0 && !open}
        title="添加 CSS 样式属性"
      >
        + 添加属性 {open ? '▴' : '▾'}
      </button>
      {open && (
        <>
          <div className="add-prop-backdrop" onClick={closeMenu} />
          <div className={'add-prop-menu' + (closing ? ' is-closing' : '')}>
            <div className="add-prop-search">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索属性：中文 / CSS 名（如：过渡、圆角、border、wrap）"
              />
              {search && (
                <button className="add-prop-search-clear" onClick={() => { setSearch(''); searchRef.current?.focus(); }}>×</button>
              )}
            </div>
            <div className="add-prop-scroll">
              {candidates.length === 0 && (
                <div className="add-prop-empty">没有匹配的属性</div>
              )}
              {q ? (
                candidates.map((s) => renderItem(s))
              ) : (
                CATEGORY_ORDER.map((cat) => {
                  if (!grouped[cat] || grouped[cat].length === 0) return null;
                  return (
                    <div key={cat} className="add-prop-group">
                      <div className="add-prop-group-title">{cat}</div>
                      {grouped[cat].map((s) => renderItem(s))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
