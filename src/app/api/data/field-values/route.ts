import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const field = searchParams.get('field') || ''

  if (!field) return NextResponse.json({ error: 'Parameter field wajib' }, { status: 400 })
  if (!/^[a-zA-Z0-9_\-\s]+$/.test(field)) return NextResponse.json({ error: 'Nama kolom tidak valid' }, { status: 400 })

  try {
    const active = await db.dataset.findFirst({ where: { isActive: true } })
    if (!active) return NextResponse.json([])

    const escaped = field.replace(/'/g, "''")
    const result = await db.$queryRawUnsafe<{ value: string; count: bigint }[]>(`
      SELECT
        metadata->>'${escaped}' AS value,
        COUNT(*) AS count
      FROM "DataPoint"
      WHERE "datasetId" = '${active.id}'
        AND metadata->>'${escaped}' IS NOT NULL
        AND metadata->>'${escaped}' != ''
      GROUP BY metadata->>'${escaped}'
      ORDER BY count DESC
      LIMIT 100
    `)

    return NextResponse.json(result.map(r => ({ value: r.value, count: Number(r.count) })))
  } catch (error) {
    console.error('Field values error:', error)
    return NextResponse.json({ error: 'Gagal' }, { status: 500 })
  }
}
