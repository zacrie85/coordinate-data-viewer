import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const active = await db.dataset.findFirst({ where: { isActive: true } })
    if (!active) return NextResponse.json({ columns: [], datasetName: '' })

    return NextResponse.json({
      columns: active.headers,
      datasetName: active.name,
      latCol: active.latCol,
      lngCol: active.lngCol,
      coordCol: active.coordCol,
      datasetId: active.id,
    })
  } catch (error) {
    console.error('Columns error:', error)
    return NextResponse.json({ error: 'Gagal mengambil kolom' }, { status: 500 })
  }
}
