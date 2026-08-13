import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const active = await db.dataset.findFirst({ where: { isActive: true } })
    if (!active) return NextResponse.json({ total: 0, withCoord: 0, withoutCoord: 0, datasetName: '' })

    const [total, withCoord] = await Promise.all([
      db.dataPoint.count({ where: { datasetId: active.id } }),
      db.dataPoint.count({ where: { datasetId: active.id, latitude: { not: 0 }, longitude: { not: 0 } } }),
    ])

    return NextResponse.json({
      total,
      withCoord,
      withoutCoord: total - withCoord,
      datasetName: active.name,
      rowCount: active.rowCount,
    })
  } catch (error) {
    console.error('Stats error:', error)
    return NextResponse.json({ error: 'Gagal' }, { status: 500 })
  }
}
