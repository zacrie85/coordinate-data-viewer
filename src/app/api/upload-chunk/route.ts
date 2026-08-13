import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ── Coordinate auto-detection ──

function parseCoordValue(val: any): [number, number] | null {
  if (val === null || val === undefined || val === '') return null
  const s = String(val).trim()
  if (!s) return null
  // Comma-separated: "-6.242,106.446"
  if (s.includes(',')) {
    const parts = s.split(',').map(p => parseFloat(p.trim()))
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]]
  }
  // Space-separated
  if (s.includes(' ')) {
    const parts = s.split(/\s+/).map(p => parseFloat(p.trim()))
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]]
  }
  return null
}

function detectCoordinateColumns(headers: string[]): {
  latCol: string | null
  lngCol: string | null
  coordCol: string | null
} {
  const latCol = headers.find(h => /^(lat\w*|latitude|lintang)$/i.test(h.trim())) || null
  const lngCol = headers.find(h => /^(lng\w*|lon\w*|longitude|bujur)$/i.test(h.trim())) || null
  const coordCol = headers.find(h => /^(coord\w*|coordinate|koordinat|lat_lng|latlon|gps|gps_coordinate)$/i.test(h.trim())) || null
  return { latCol, lngCol, coordCol }
}

function extractCoordinates(
  row: Record<string, any>,
  det: { latCol: string | null; lngCol: string | null; coordCol: string | null }
): { latitude: number; longitude: number } {
  // Priority 1: Separate lat/lng columns
  if (det.latCol && det.lngCol) {
    const lat = parseFloat(row[det.latCol])
    const lng = parseFloat(row[det.lngCol])
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) return { latitude: lat, longitude: lng }
  }
  // Priority 2: Combined coordinate column
  if (det.coordCol) {
    const parsed = parseCoordValue(row[det.coordCol])
    if (parsed && parsed[0] !== 0 && parsed[1] !== 0) return { latitude: parsed[0], longitude: parsed[1] }
  }
  // Priority 3: Scan ALL columns for coord pair
  for (const [, val] of Object.entries(row)) {
    const parsed = parseCoordValue(val)
    if (parsed && parsed[0] !== 0 && parsed[1] !== 0) return { latitude: parsed[0], longitude: parsed[1] }
  }
  return { latitude: 0, longitude: 0 }
}

function buildMetadata(
  row: Record<string, any>,
  det: { latCol: string | null; lngCol: string | null; coordCol: string | null }
): Record<string, any> {
  const skip = new Set<string>()
  if (det.latCol) skip.add(det.latCol)
  if (det.lngCol) skip.add(det.lngCol)
  if (det.coordCol) skip.add(det.coordCol)
  const meta: Record<string, any> = {}
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k)) continue
    meta[k] = (v === null || v === undefined) ? '' : String(v)
  }
  return meta
}

// Using Prisma createMany instead of raw SQL — safe with PgBouncer and handles all escaping

// ── Main handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, datasetId, headers, rows, chunkIndex, totalChunks, detection, datasetName } = body

    // ── CREATE DATASET ──
    if (action === 'create-dataset') {
      const det = detectCoordinateColumns(headers || [])
      const dataset = await db.dataset.create({
        data: {
          name: datasetName || 'Unnamed Dataset',
          headers: headers || [],
          latCol: det.latCol,
          lngCol: det.lngCol,
          coordCol: det.coordCol,
        },
      })
      return NextResponse.json({ datasetId: dataset.id, detection: det })
    }

    // ── DEACTIVATE OLD DATASETS ──
    if (action === 'deactivate-others') {
      await db.dataset.updateMany({
        where: { id: { not: datasetId } },
        data: { isActive: false },
      })
      return NextResponse.json({ ok: true })
    }

    // ── DELETE POINTS FOR DATASET ──
    if (action === 'delete-points') {
      const result = await db.dataPoint.deleteMany({ where: { datasetId } })
      return NextResponse.json({ deleted: result.count })
    }

    // ── UPDATE DATASET ROW COUNT ──
    if (action === 'update-count') {
      await db.dataset.update({
        where: { id: datasetId },
        data: { rowCount: body.rowCount || 0 },
      })
      return NextResponse.json({ ok: true })
    }

    // ── INSERT CHUNK ──
    if (action === 'insert') {
      if (!datasetId || !Array.isArray(rows)) {
        return NextResponse.json({ error: 'datasetId dan rows wajib' }, { status: 400 })
      }

      const det: { latCol: string | null; lngCol: string | null; coordCol: string | null } = detection || { latCol: null, lngCol: null, coordCol: null }

      const processed = rows.map((row: Record<string, any>) => {
        const { latitude, longitude } = extractCoordinates(row, det)
        const metadata = buildMetadata(row, det)
        return { latitude, longitude, metadata }
      }).filter(r => {
        return Object.values(r.metadata).some((v: any) => v !== '') || (r.latitude !== 0 && r.longitude !== 0)
      })

      if (processed.length === 0) {
        return NextResponse.json({ chunkIndex, totalChunks, inserted: 0, skipped: rows.length })
      }

      await db.dataPoint.createMany({
        data: processed.map(r => ({
          datasetId,
          latitude: r.latitude,
          longitude: r.longitude,
          metadata: r.metadata,
        })),
      })

      return NextResponse.json({ chunkIndex, totalChunks, inserted: processed.length, skipped: rows.length - processed.length })
    }

    // ── MANUAL DETECTION (for preview) ──
    if (action === 'detect') {
      const det = detectCoordinateColumns(headers || [])
      return NextResponse.json({ detection: det })
    }

    return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })
  } catch (error: any) {
    console.error('Upload chunk error:', error)
    return NextResponse.json({ error: error.message || 'Gagal memproses' }, { status: 500 })
  }
}
