import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ── Coordinate auto-detection ──

function parseCoordValue(val: any): [number, number] | null {
  if (val === null || val === undefined || val === '') return null
  const s = String(val).trim()
  if (!s) return null
  if (s.includes(',')) {
    const parts = s.split(',').map(p => parseFloat(p.trim()))
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]]
  }
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
  if (det.latCol && det.lngCol) {
    const lat = parseFloat(row[det.latCol])
    const lng = parseFloat(row[det.lngCol])
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) return { latitude: lat, longitude: lng }
  }
  if (det.coordCol) {
    const parsed = parseCoordValue(row[det.coordCol])
    if (parsed && parsed[0] !== 0 && parsed[1] !== 0) return { latitude: parsed[0], longitude: parsed[1] }
  }
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

// ── Main handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, datasetId, headers, rows, detection, datasetName } = body

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

    // ── INSERT CHUNK (untuk dataset baru) ──
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
        return NextResponse.json({ chunkIndex: body.chunkIndex, totalChunks: body.totalChunks, inserted: 0, skipped: rows.length })
      }

      await db.dataPoint.createMany({
        data: processed.map(r => ({ datasetId, latitude: r.latitude, longitude: r.longitude, metadata: r.metadata })),
      })

      return NextResponse.json({ chunkIndex: body.chunkIndex, totalChunks: body.totalChunks, inserted: processed.length, skipped: rows.length - processed.length })
    }

    // ── UPDATE CHUNK (update-in-place, chunked, foto tetap nyambung) ──
    if (action === 'update-chunk') {
      const { keyCol, rows: chunkRows } = body
      if (!datasetId || !keyCol || !Array.isArray(chunkRows)) {
        return NextResponse.json({ error: 'datasetId, keyCol, dan rows wajib' }, { status: 400 })
      }

      const det: { latCol: string | null; lngCol: string | null; coordCol: string | null } = detection || { latCol: null, lngCol: null, coordCol: null }

      // 1. Ambil key values dari chunk ini
      const chunkKeys = chunkRows
        .map(r => r[keyCol])
        .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
        .map(v => String(v).trim().toLowerCase())

      // 2. Query existing DataPoints yang key-nya cocok (hanya yang relevan)
      const existingPoints = chunkKeys.length > 0
        ? await db.dataPoint.findMany({
            where: { datasetId },
            select: { id: true, metadata: true },
          })
        : []

      // Build index dari existing: normalized key → id
      const existingIndex = new Map<string, string>()
      for (const p of existingPoints) {
        const meta = p.metadata as Record<string, any>
        const kv = meta[keyCol]
        if (kv !== undefined && kv !== null && String(kv).trim() !== '') {
          existingIndex.set(String(kv).trim().toLowerCase(), p.id)
        }
      }

      // 3. Proses: pisah update vs insert
      const toUpdate: { id: string; latitude: number; longitude: number; metadata: Record<string, any> }[] = []
      const toInsert: { datasetId: string; latitude: number; longitude: number; metadata: Record<string, any> }[] = []
      let skipped = 0

      for (const row of chunkRows) {
        const { latitude, longitude } = extractCoordinates(row, det)
        const metadata = buildMetadata(row, det)
        const keyValue = row[keyCol]
        const normalizedKey = keyValue !== undefined && keyValue !== null && String(keyValue).trim() !== ''
          ? String(keyValue).trim().toLowerCase()
          : ''

        // Skip baris kosong
        if (!normalizedKey && Object.values(metadata).every(v => v === '') && latitude === 0 && longitude === 0) {
          skipped++
          continue
        }

        if (normalizedKey && existingIndex.has(normalizedKey)) {
          toUpdate.push({ id: existingIndex.get(normalizedKey)!, latitude, longitude, metadata })
        } else {
          toInsert.push({ datasetId, latitude, longitude, metadata })
        }
      }

      // 4. Execute: batch insert + individual updates
      let inserted = 0
      let updated = 0

      if (toInsert.length > 0) {
        const res = await db.dataPoint.createMany({ data: toInsert })
        inserted = res.count
      }

      for (const item of toUpdate) {
        await db.dataPoint.update({
          where: { id: item.id },
          data: { latitude: item.latitude, longitude: item.longitude, metadata: item.metadata },
        })
        updated++
      }

      return NextResponse.json({ updated, inserted, skipped, chunkIndex: body.chunkIndex, totalChunks: body.totalChunks })
    }

    // ── FINALIZE UPDATE: update dataset info & count removed ──
    if (action === 'update-finalize') {
      const { keyCol, totalRows } = body
      if (!datasetId || !keyCol) {
        return NextResponse.json({ error: 'datasetId dan keyCol wajib' }, { status: 400 })
      }

      const det: { latCol: string | null; lngCol: string | null; coordCol: string | null } = detection || { latCol: null, lngCol: null, coordCol: null }

      // Update dataset headers & row count
      await db.dataset.update({
        where: { id: datasetId },
        data: {
          headers: headers || [],
          latCol: det.latCol,
          lngCol: det.lngCol,
          coordCol: det.coordCol,
          rowCount: totalRows || 0,
          updatedAt: new Date(),
        },
      })

      return NextResponse.json({ ok: true })
    }

    // ── GET ACTIVE DATASET INFO (untuk update mode) ──
    if (action === 'get-active-dataset') {
      const active = await db.dataset.findFirst({
        where: { isActive: true },
        select: { id: true, name: true, headers: true, rowCount: true },
      })
      if (!active) {
        return NextResponse.json({ error: 'Tidak ada dataset aktif' }, { status: 404 })
      }
      const photoCount = await db.photo.count({
        where: { point: { datasetId: active.id } },
      })
      return NextResponse.json({ ...active, photoCount })
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
