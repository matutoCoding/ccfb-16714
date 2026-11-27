import React from 'react';
import { useUi } from '../state/ui';

export function Badge({ kind, children }: { kind: 'l1' | 'l2' | 'ok' | 'info' | 'gray' | 'purple'; children: React.ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function LevelBadge({ level }: { level: 1 | 2 }) {
  return level === 2 ? <Badge kind="l2">二级超限</Badge> : <Badge kind="l1">一级超限</Badge>;
}

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  lg?: boolean;
}) {
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.lg ? 'lg' : ''}`}>
        <div className="modal-hd">
          <h3>{props.title}</h3>
          <button className="x" onClick={props.onClose}>✕</button>
        </div>
        <div className="modal-bd">{props.children}</div>
        {props.footer && <div className="modal-ft">{props.footer}</div>}
      </div>
    </div>
  );
}

export function ToastHost() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast-wrap">
      <div className={`toast ${toast.type === 'ok' ? 'ok' : toast.type === 'err' ? 'err' : ''}`}>
        {toast.type === 'ok' ? '✓' : toast.type === 'err' ? '⚠' : 'ℹ'} {toast.text}
      </div>
    </div>
  );
}

export function Stat(props: { label: string; value: React.ReactNode; unit?: string; foot?: React.ReactNode; tone?: 'good' | 'bad' | 'warn'; bar?: string }) {
  return (
    <div className={`stat ${props.tone ?? ''}`}>
      {props.bar && <i className="bar" style={{ background: props.bar }} />}
      <div className="k">{props.label}</div>
      <div className="v">
        {props.value}
        {props.unit && <span className="u">{props.unit}</span>}
      </div>
      {props.foot && <div className="foot">{props.foot}</div>}
    </div>
  );
}

export function Empty({ icon = '📭', text, hint }: { icon?: string; text: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div>{text}</div>
      {hint && <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/** 里程文本 + 点击跳转三维 */
export function MileageLink({ mileage, children }: { mileage: number; children?: React.ReactNode }) {
  const gotoReplay = useUi((s) => s.gotoReplay);
  return (
    <a
      href="#/replay"
      onClick={(e) => {
        e.preventDefault();
        gotoReplay({ mileage });
      }}
      style={{ color: 'var(--primary)', fontWeight: 700, cursor: 'pointer' }}
      title="在三维回放中定位"
    >
      {children}
    </a>
  );
}
