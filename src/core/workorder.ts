// 工单修复后，用“下一次检测”在同里程窗口自动核对是否修好
import type { DetectionRun, LimitSettings, WorkOrder } from './types';
import { peakDeviationNear } from './judge';

export interface VerifyResult {
  runId: string;
  batchId: string;
  passed: boolean;
  beforeValue: number;
  afterValue: number;
  reductionPct: number;
  note: string;
}

/**
 * 在晚于工单完成时间的检测批次中，取最早一次包含该 track 的 run 进行核对。
 * beforeValue 由调用方保存（建单时的峰值偏差）。
 */
export function verifyRepair(args: {
  track: 'up' | 'down';
  mileage: number;
  metric: 'height' | 'pull';
  beforeValue: number;
  finishedAt: number;
  runs: DetectionRun[]; // 应已按批次日期升序
  batchDateOf: (batchId: string) => string | undefined;
  settings: LimitSettings;
  designHeight: number;
  designStagger: number;
}): (VerifyResult & { checkedAt: number }) | null {
  const { track, mileage, metric, beforeValue, runs, settings, designHeight, designStagger, finishedAt } = args;

  const candidates = runs
    .filter((r) => r.track === track)
    .filter((r) => {
      const d = args.batchDateOf(r.batchId);
      if (!d) return true;
      return new Date(d).getTime() >= finishedAt - 24 * 3600 * 1000;
    })
    .sort((a, b) => {
      const da = args.batchDateOf(a.batchId) ?? '';
      const db = args.batchDateOf(b.batchId) ?? '';
      return da.localeCompare(db);
    });

  const run = candidates[0];
  if (!run) return null;

  const { peak, excess } = peakDeviationNear(
    run,
    mileage,
    metric,
    designHeight,
    settings.verifyWindow,
    designStagger,
  );
  // beforeValue 与 excess 同为“超出正常基准的异常分量”，降幅才可比较
  const afterValue = excess;
  const reductionPct = beforeValue > 0 ? Math.max(0, ((beforeValue - afterValue) / beforeValue) * 100) : 0;
  const level1 = metric === 'height' ? settings.heightLevel1 : settings.pullLevel1;
  const passed = peak < level1 && reductionPct >= settings.verifyReductionPct;

  const metricLabel = metric === 'height' ? '导高偏差' : '拉出值';
  const note = passed
    ? `下次检测在 ${settings.verifyWindow}m 窗口内${metricLabel}峰值 ${peak.toFixed(0)}，异常分量由 ${beforeValue.toFixed(0)} 降至 ${afterValue.toFixed(0)}（降幅 ${reductionPct.toFixed(0)}%），未再超限，确认修复。`
    : peak >= level1
      ? `下次检测该处${metricLabel}峰值仍有 ${peak.toFixed(0)}（一级阈值 ${level1}），超限未消除，需重新处理。`
      : `异常分量降至 ${afterValue.toFixed(0)}，但降幅 ${reductionPct.toFixed(0)}% 未达 ${settings.verifyReductionPct}% 要求，继续观察。`;

  return {
    runId: run.id,
    batchId: run.batchId,
    passed,
    beforeValue: Math.round(beforeValue),
    afterValue: Math.round(afterValue),
    reductionPct: Math.round(reductionPct),
    note,
    checkedAt: Date.now(),
  };
}

/** 工单状态展示辅助 */
export function orderStatusMeta(o: WorkOrder): { label: string; color: string } {
  if (o.status !== 'done') {
    return o.status === 'processing'
      ? { label: '处理中', color: '#2563eb' }
      : { label: '待处理', color: '#d97706' };
  }
  if (!o.verification) return { label: '已处理·待下次检测核对', color: '#7c3aed' };
  return o.verification.passed
    ? { label: '已修复·复核通过', color: '#059669' }
    : { label: '复核未过·疑似复发', color: '#dc2626' };
}
