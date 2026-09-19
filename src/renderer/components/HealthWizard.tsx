import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene } from '@store/sceneStore';
import {
  runHealthCheck, countBySeverity, hasBlocking,
  type HealthIssue, type Severity
} from '@lib/healthCheck';

// BlockCanvas · 「导出前体检」向导
//
// 把分散在各处的样式健康检查汇总成一份清单，按严重度排序，一条一条走完：
//   · 能自动修的（起名 / ID 去重 / 统一同名样式）→ 点一下就修好，自动跳下一条
//   · 必须人工决定的（非法类名 / 图片 alt / 固定宽度）→ 直接把用户送到对应面板
//   走完全部 = 这一页可以放心导出。
// 导出 HTML 前若存在「严重」问题会先弹出本向导，避免导出一份效果丢失的网页。

const SEV_META: Record<Severity, { icon: string; label: string; cls: string }> = {
  critical: { icon: '⛔', label: '严重', cls: 'sev-critical' },
  warn: { icon: '⚠️', label: '提醒', cls: 'sev-warn' },
  info: { icon: '💡', label: '提示', cls: 'sev-info' }
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** 走完之后要做的事（例如继续导出）。不传则只关闭。 */
  onFinish?: () => void;
  /** 完成按钮文案；默认「完成」 */
  finishLabel?: string;
}

export function HealthWizard(props: Props) {
  const { open, onClose, onFinish, finishLabel = '完成' } = props;
  const root = useScene((s) => s.scene.root);
  const [step, setStep] = useState(0);
  const [nonce, setNonce] = useState(0); // 修完之后强制重扫
  const [done, setDone] = useState<Set<string>>(new Set());
  // 进场/退场：关闭时先播 170ms 退场动画再卸载（统一动画约定，见 styles.css 的 .bc-mask/.bc-pop）
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  const issues = useMemo(() => runHealthCheck(root), [root, nonce]);

  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); setStep(0); setDone(new Set()); setNonce((n) => n + 1); return; }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => { setMounted(false); setClosing(false); }, 170);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  // 问题被修掉之后列表会变短，step 不能越界
  const safeStep = Math.min(step, Math.max(0, issues.length - 1));
  const current: HealthIssue | undefined = issues[safeStep];
  const counts = countBySeverity(issues);
  const blocking = hasBlocking(issues);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && safeStep < issues.length - 1) setStep(safeStep + 1);
      if (e.key === 'ArrowLeft' && safeStep > 0) setStep(safeStep - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, safeStep, issues.length, onClose]);

  if (!mounted) return null;

  const gotoAndLocate = (issue: HealthIssue) => {
    if (issue.locateId) {
      useScene.getState().selectElement(issue.locateId);
      window.dispatchEvent(new CustomEvent('bc:reveal-element', { detail: issue.locateId }));
    }
    if (issue.goto === 'class') window.dispatchEvent(new CustomEvent('bc:open-class'));
    onClose();
  };

  const doFix = (issue: HealthIssue) => {
    issue.fix?.();
    setDone((prev) => new Set(prev).add(issue.id));
    setNonce((n) => n + 1);
    // 修复后列表可能变短：停留在新列表的同一位置即可
    setStep((s) => Math.max(0, Math.min(s, issues.length - 2)));
  };

  const fixAll = () => {
    const fixable = issues.filter((i) => i.fix);
    if (fixable.length === 0) return;
    const st = useScene.getState();
    st.beginStyleEdit();
    // 逐条调用各自的 fix 内部又会 begin/end，这里改为统一在外面包一次，
    // 让"全部修复"在撤销栈里也是一步。
    for (const i of fixable) i.fix?.();
    st.endStyleEdit();
    setDone(new Set(fixable.map((i) => i.id)));
    setNonce((n) => n + 1);
    setStep(0);
  };

  const fixableCount = issues.filter((i) => i.fix).length;

  return createPortal(
    <div
      className={'hc-backdrop' + (closing ? ' is-closing' : '')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="hc-modal" role="dialog" aria-label="导出前体检">
        {/* —— 头部 —— */}
        <div className="hc-head">
          <div className="hc-head-left">
            <span className="hc-head-icon">🩺</span>
            <div>
              <div className="hc-title">导出前体检</div>
              <div className="hc-sub">
                {issues.length === 0
                  ? '这一页很干净，可以直接导出'
                  : `共 ${issues.length} 项 · 严重 ${counts.critical} · 提醒 ${counts.warn} · 提示 ${counts.info}`}
              </div>
            </div>
          </div>
          <button className="cp-close" onClick={onClose} title="关闭（Esc）">×</button>
        </div>

        {issues.length === 0 ? (
          <div className="hc-clean">
            <div className="hc-clean-icon">✅</div>
            <div className="hc-clean-title">没有发现任何问题</div>
            <div className="hc-clean-desc">
              所有元素都有名字、没有重复 ID、同名样式也统一。可以放心导出。
            </div>
            <div className="hc-clean-actions">
              <button className="btn-primary" onClick={() => { onClose(); onFinish?.(); }}>
                {finishLabel}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* —— 左侧清单 —— */}
            <div className="hc-body">
              <div className="hc-list">
                {issues.map((it, i) => {
                  const meta = SEV_META[it.severity];
                  return (
                    <button
                      key={it.id}
                      className={
                        'hc-list-item' +
                        (i === safeStep ? ' active' : '') +
                        (done.has(it.id) ? ' fixed' : '')
                      }
                      onClick={() => setStep(i)}
                    >
                      <span className={'hc-dot ' + meta.cls}>{done.has(it.id) ? '✓' : meta.icon}</span>
                      <span className="hc-list-text">{it.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* —— 右侧详情 —— */}
              <div className="hc-detail">
                {current && (
                  <>
                    <div className="hc-detail-head">
                      <span className={'hc-sev-tag ' + SEV_META[current.severity].cls}>
                        {SEV_META[current.severity].icon} {SEV_META[current.severity].label}
                      </span>
                      <span className="hc-step">第 {safeStep + 1} / {issues.length} 项</span>
                    </div>
                    <div className="hc-detail-title">{current.title}</div>
                    <div className="hc-detail-desc">
                      {current.detail.split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                    {done.has(current.id) && (
                      <div className="hc-fixed-badge">✓ 这一项已经处理过了（再扫一次若仍出现，说明需要手动微调）</div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* —— 底部操作 —— */}
            <div className="hc-foot">
              <button
                className="btn-mini"
                disabled={safeStep === 0}
                onClick={() => setStep(safeStep - 1)}
              >← 上一项</button>
              <button
                className="btn-mini"
                disabled={safeStep >= issues.length - 1}
                onClick={() => setStep(safeStep + 1)}
              >下一项 →</button>
              <span className="hc-foot-spacer" />
              {fixableCount > 0 && (
                <button className="btn-secondary" onClick={fixAll} title="把所有能自动修的一次性修好（算一步撤销）">
                  🪄 一键修复全部（{fixableCount} 项）
                </button>
              )}
              {current?.fix ? (
                <button className="btn-primary" onClick={() => doFix(current)}>
                  {current.fixLabel ?? '一键修复'}
                </button>
              ) : (
                <button className="btn-primary" onClick={() => gotoAndLocate(current!)}>
                  {current?.locateId || current?.goto === 'class' ? '去处理' : '知道了'}
                </button>
              )}
              {safeStep >= issues.length - 1 && (
                <button
                  className={blocking ? 'btn-secondary' : 'btn-primary'}
                  onClick={() => { onClose(); onFinish?.(); }}
                  title={blocking ? '仍有严重项未处理，导出后效果可能丢失' : '体检完成，继续'}
                >
                  {finishLabel}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
