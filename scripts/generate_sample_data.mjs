// 样例数据生成入口：node scripts/generate_sample_data.mjs
// 输出 public/sample-data/line_archive.json + 6 个检测 CSV（双线 x 三月）
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildArchive } from './build_archive.mjs'
import { buildTrackCsv } from './build_measurements.mjs'
import { DRIFT_PLANS } from './line_config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'sample-data')

const csvEscape = (v) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const toCsv = (rows) => {
  const header = '序号,原始里程,导高,拉出值,事件,杆号'
  const body = rows
    .map((r) =>
      [r.seq, r.rawMileage, r.heightMm, r.staggerMm, r.event, r.supportCode]
        .map(csvEscape)
        .join(','),
    )
    .join('\n')
  return `﻿${header}\n${body}\n`
}

const main = async () => {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const archive = buildArchive()
  await writeFile(
    join(outDir, 'line_archive.json'),
    JSON.stringify(archive),
    'utf8',
  )
  console.log(`[archive] 支柱 ${archive.supports.length} 根，锚段 ${archive.anchorSections.length} 个`)

  const manifest = []
  for (let m = 0; m < DRIFT_PLANS.length; m++) {
    const plan = DRIFT_PLANS[m]
    for (const trackNo of [1, 2]) {
      const rows = buildTrackCsv(archive, trackNo, plan, m)
      const fileName = `inspect_${plan.month}_track${trackNo}.csv`
      await writeFile(join(outDir, fileName), toCsv(rows), 'utf8')
      manifest.push({
        file: fileName,
        name: `${plan.month} ${trackNo === 1 ? '下行' : '上行'}检测`,
        inspectDate: plan.month,
        trackNo,
        rows: rows.length,
        driftModel: plan.model,
      })
      console.log(`[csv] ${fileName}  ${rows.length} 行  漂移模型=${plan.model}`)
    }
  }

  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  )
  console.log('done ->', outDir)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
