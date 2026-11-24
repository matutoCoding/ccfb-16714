// 一键载入 public/sample-data：线路档案 + 6 个检测批次
import type { LineArchive } from '@/types'
import { importCsvBatch } from '@/core/importer'
import { saveArchive } from '@/db/idb'

interface ManifestItem {
  file: string
  name: string
  inspectDate: string
  trackNo: 1 | 2
  rows: number
  driftModel: string
}

export interface LoadProgress {
  current: number
  total: number
  message: string
}

export const loadDemoData = async (
  onProgress?: (p: LoadProgress) => void,
): Promise<void> => {
  const base = `${import.meta.env.BASE_URL}sample-data`
  const manifest = (await fetch(`${base}/manifest.json`).then((r) => r.json())) as ManifestItem[]

  const archive = (await fetch(`${base}/line_archive.json`).then((r) =>
    r.json(),
  )) as LineArchive
  await saveArchive(archive)
  onProgress?.({ current: 0, total: manifest.length, message: '线路档案已写入' })

  for (let i = 0; i < manifest.length; i++) {
    const item = manifest[i]
    onProgress?.({ current: i, total: manifest.length, message: `正在导入 ${item.name}` })
    const text = await fetch(`${base}/${item.file}`).then((r) => r.text())
    await importCsvBatch(
      text,
      {
        name: item.name,
        inspectDate: item.inspectDate,
        trackNo: item.trackNo,
        driftModel: item.driftModel,
      },
      archive,
    )
  }
  onProgress?.({
    current: manifest.length,
    total: manifest.length,
    message: '全部批次导入完成',
  })
}
