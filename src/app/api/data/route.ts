import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') || ''
  const hasCoord = searchParams.get('hasCoord') || ''
  const limit = parseInt(searchParams.get('limit') || '25000')

  // Parse 3 column filter slots: cf0/cv0, cf1/cv1, cf2/cv2
  const columnFilters: { field: string; values: string[] }[] = []
  for (let i = 0; i < 3; i++) {
    const field = searchParams.get(`cf${i}`) || ''
    const vals = searchParams.get(`cv${i}`) || ''
    if (field && vals) {
      const parsed = vals.split(',').map(v => v.trim()).filter(Boolean)
      if (parsed.length > 0) columnFilters.push({ field, values: parsed })
    }
  }

  try {
    const active = await db.dataset.findFirst({ where: { isActive: true } })
    if (!active) return NextResponse.json({ data: [], pagination: { total: 0, limit } })

    // ── Build raw SQL with parameterized queries ──
    const conditions: string[] = []
    const sqlParams: any[] = []
    let idx = 1

    const nextParam = (val: any) => { sqlParams.push(val); return `$${idx++}` }

    conditions.push(`"datasetId" = ${nextParam(active.id)}`)

    // Coordinate filter
    if (hasCoord === 'true') {
      conditions.push(`"latitude" != 0`)
      conditions.push(`"longitude" != 0`)
    } else if (hasCoord === 'false') {
      conditions.push(`("latitude" = 0 OR "longitude" = 0)`)
    }

    // Search in all metadata (cast entire JSONB to text)
    if (search) {
      conditions.push(`metadata::text ILIKE ${nextParam(`%${search}%`)}`)
    }

    // Multi-column field filters
    for (const cf of columnFilters) {
      const escapedField = cf.field.replace(/'/g, "''")
      if (cf.values.length === 1) {
        conditions.push(`metadata->>'${escapedField}' ILIKE ${nextParam(`%${cf.values[0]}%`)}`)
      } else {
        // Multiple values for same field → OR group
        const orParts = cf.values.map(v =>
          `metadata->>'${escapedField}' ILIKE ${nextParam(`%${v}%`)}`
        )
        conditions.push(`(${orParts.join(' OR ')})`)
      }
    }

    const whereClause = conditions.join(' AND ')

    const rows = await db.$queryRawUnsafe<any[]>(
      `SELECT * FROM "DataPoint" WHERE ${whereClause} ORDER BY "createdAt" DESC LIMIT ${nextParam(limit)}`,
      ...sqlParams
    )

    // Parse metadata if returned as string from raw SQL
    const points = rows.map((r: any) => ({
      id: r.id,
      datasetId: r.datasetId,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {}),
      createdAt: r.createdAt,
    }))

    // Get total count
    const countRows = await db.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*)::int AS count FROM "DataPoint" WHERE ${whereClause}`,
      ...sqlParams.slice(0, -1) // exclude the LIMIT param
    )

    return NextResponse.json({ data: points, pagination: { total: Number(countRows[0]?.count || 0), limit } })
  } catch (error) {
    console.error('Data error:', error)
    return NextResponse.json({ error: 'Gagal mengambil data' }, { status: 500 })
  }
}
