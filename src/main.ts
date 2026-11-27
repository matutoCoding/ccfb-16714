import './ui/styles.css';
import { store } from './lib/store';
import { renderRoute } from './ui/router';
import { seedDemoData } from './lib/seed';
import { showLoading, hideLoading, toast } from './ui/dom';

async function bootstrap() {
  await store.init();
  updateDbStatus();
  renderRoute();
  window.addEventListener('hashchange', renderRoute);

  document.getElementById('btn-seed')!.addEventListener('click', async () => {
    if (store.state.seeded) {
      const ok = confirm('已存在演示数据，重新生成将清空现有批次/超限/工单。是否继续？');
      if (!ok) return;
      await store.resetAll();
    }
    const btn = document.getElementById('btn-seed') as HTMLButtonElement;
    btn.disabled = true;
    try {
      await seedDemoData((p) => showLoading(p.phase, p.current, p.total));
      hideLoading();
      toast('演示数据载入完成：6 个检测批次已完成里程对齐与超限判定', 'ok', 4200);
      renderRoute();
    } catch (e) {
      hideLoading();
      toast(`数据生成失败：${(e as Error).message}`, 'err', 6000);
      console.error(e);
    } finally {
      btn.disabled = false;
      updateDbStatus();
    }
  });
}

function updateDbStatus() {
  const el = document.getElementById('db-status')!;
  if (!store.state.ready) {
    el.textContent = '数据库：初始化中…';
    el.className = 'db-status';
    return;
  }
  const n = store.state.batches.length;
  el.textContent = store.state.seeded
    ? `数据库：就绪（${n} 个批次 / IndexedDB）`
    : '数据库：就绪（空库）';
  el.className = 'db-status ok';
  const btn = document.getElementById('btn-seed')!;
  btn.textContent = store.state.seeded ? '重新生成演示数据（清空后重建）' : '载入内置演示数据（50km 双线 / 3 批次）';
}

store.subscribe(() => updateDbStatus());
bootstrap();
