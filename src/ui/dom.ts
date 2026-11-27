// 极简 DOM 构建工具
export type HProps = {
  class?: string;
  style?: string;
  dataset?: Record<string, string>;
  [event: `on${string}`]: EventListener | string | Record<string, string> | undefined;
} & Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HProps = {},
  children: Array<Node | string | null | undefined | false> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') el.className = v as string;
    else if (k === 'style') el.setAttribute('style', v as string);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else {
      (el as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  el.replaceChildren();
}

export function toast(message: string, kind: 'ok' | 'err' | 'warn' | 'info' = 'info', ms = 3200) {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  const t = h('div', { class: `toast ${kind === 'info' ? '' : kind}` }, [message]);
  root.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 320);
  }, ms);
}

export function showModal(title: string, content: Node, opts: { width?: number } = {}): () => void {
  const mask = h('div', { class: 'modal-mask' });
  const modal = h('div', { class: 'modal' });
  if (opts.width) modal.style.width = `min(${opts.width}px, 94vw)`;
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  modal.append(
    h('div', { class: 'jcsb aic flex mb12' }, [
      h('h3', { class: 'modal-title', style: 'margin:0' }, [title]),
      h('button', { class: 'btn btn-sm modal-close', onClick: close }, ['✕']),
    ]),
    content,
  );
  mask.appendChild(modal);
  document.body.appendChild(mask);
  return close;
}

export function showLoading(phase: string, current = 0, total = 1) {
  let mask = document.getElementById('loading-mask') as HTMLElement | null;
  if (!mask) {
    mask = h('div', { id: 'loading-mask', class: 'loading-mask' });
    document.body.appendChild(mask);
  }
  const pct = total ? Math.round((current / total) * 100) : 0;
  mask.replaceChildren(
    h('div', { class: 'loading-box' }, [
      h('div', { class: 'spinner' }),
      h('div', { id: 'loading-phase' }, [phase]),
      h('div', { class: 'progress-bar' }, [h('div', { class: 'progress-fill', style: `width:${pct}%` })]),
      h('div', { class: 'muted mt8', style: 'font-size:12px' }, [`${current} / ${total}`]),
    ]),
  );
}
export function hideLoading() {
  document.getElementById('loading-mask')?.remove();
}

export function fmtDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}
