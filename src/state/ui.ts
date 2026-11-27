import { create } from 'zustand';
import type { TrackId } from '../core/types';

export type PageKey = 'batches' | 'archive' | 'replay' | 'defects' | 'workorders' | 'trends' | 'settings';

export interface ReplayRequest {
  batchId?: string;
  track?: TrackId;
  runId?: string;
  mileage?: number;
  defectId?: string;
  /** 每次请求递增，保证同一缺陷重复点击也能触发 */
  nonce: number;
}

interface UiState {
  page: PageKey;
  navigate: (p: PageKey) => void;
  replay: ReplayRequest | null;
  gotoReplay: (req: Omit<ReplayRequest, 'nonce'>) => void;
  toast: { id: number; type: 'info' | 'ok' | 'err'; text: string } | null;
  showToast: (text: string, type?: 'info' | 'ok' | 'err') => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUi = create<UiState>((set, get) => ({
  page: (location.hash.replace('#/', '') as PageKey) || 'batches',
  navigate: (p) => {
    location.hash = `/${p}`;
    set({ page: p });
  },
  replay: null,
  gotoReplay: (req) => {
    set({ page: 'replay', replay: { ...req, nonce: Date.now() } });
    location.hash = '/replay';
  },
  toast: null,
  showToast: (text, type = 'info') => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), type, text } });
    toastTimer = setTimeout(() => set({ toast: null }), 3600);
  },
}));

// 浏览器前进后退同步
window.addEventListener('hashchange', () => {
  const p = location.hash.replace('#/', '') as PageKey;
  if (p && ['batches', 'archive', 'replay', 'defects', 'workorders', 'trends', 'settings'].includes(p)) {
    useUi.setState({ page: p });
  }
});
