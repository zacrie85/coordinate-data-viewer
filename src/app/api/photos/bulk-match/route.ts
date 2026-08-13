import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/// GET /api/photos/bulk-match — Cari file names yang match dengan DataPoint names
/// Query params:
///   fileNames: comma-separated list of file names (tanpa extension)
///   nameCol: nama kolom di metadata yang dipakai untuk matching
///
/// Response: { matches: [{ fileName: string, pointId: string, pointName: string }], unmatched: string[] }
export async function GET(req: NextRequest) {
  const fileNamesRaw = req.nextUrl.searchParams.get('fileNames') || ''
  const nameCol = req.nextUrl.searchParams.get('nameCol') || ''
  const datasetId = req.nextUrl.searchParams.get('datasetId') || ''

  if (!fileNamesRaw) {
    return NextResponse.json({ error: 'fileNames wajib diisi' }, { status: 400 })
  }

  try {
    const fileNames = fileNamesRaw.split(',').map(f => f.trim()).filter(Boolean)
    if (fileNames.length === 0) {
      return NextResponse.json({ matches: [], unmatched: [] })
    }

    // Ambil semua DataPoint dari dataset aktif
    const whereClause: any = { latitude: { not: 0 }, longitude: { not: 0 } }
    if (datasetId) whereClause.datasetId = datasetId
    else {
      const active = await db.dataset.findFirst({ where: { isActive: true } })
      if (!active) return NextResponse.json({ matches: [], unmatched: fileNames })
      whereClause.datasetId = active.id
    }

    // Ambil data yang akan di-match
    const points = await db.dataPoint.findMany({
      where: whereClause,
      select: { id: true, metadata: true },
      take: 50000,
    })

    // Build index: normalizedName → pointId
    const nameIndex = new Map<string, { id: string; name: string }>()
    for (const p of points) {
      const meta = p.metadata as Record<string, any>
      // Jika nameCol spesifik, pakai itu
      if (nameCol && meta[nameCol]) {
        const normalized = String(meta[nameCol]).trim().toLowerCase().replace(/[^a-z0-9\-_.]/gi, '')
        if (normalized) nameIndex.set(normalized, { id: p.id, name: String(meta[nameCol]) })
      }
      // Juga index semua kolom untuk matching lebih luas
      for (const [k, v] of Object.entries(meta)) {
        if (!v || typeof v !== 'string' && typeof v !== 'number') continue
        const normalized = String(v).trim().toLowerCase().replace(/[^a-z0-9\-_.]/gi, '')
        if (normalized && normalized.length > 1) {
          if (!nameIndex.has(normalized)) {
            nameIndex.set(normalized, { id: p.id, name: String(v) })
          }
        }
      }
    }

    // Match file names ke DataPoint
    const matches: { fileName: string; pointId: string; pointName: string; confidence: 'exact' | 'partial' }[] = []
    const unmatched: string[] = []
    const usedPointIds = new Set<string>()

    for (const fileName of fileNames) {
      // Normalisasi nama file: hapus extension
      const baseName = fileName.replace(/\.[^.]+$/, '').trim().toLowerCase().replace(/[^a-z0-9\-_.]/gi, '')
      if (!baseName) { unmatched.push(fileName); continue }

      // 1. Exact match
      let matched = nameIndex.get(baseName)
      if (matched && !usedPointIds.has(matched.id)) {
        matches.push({ fileName, pointId: matched.id, pointName: matched.name, confidence: 'exact' })
        usedPointIds.add(matched.id)
        continue
      }

      // 2. Partial: cek apakah nama DataPoint mengandung baseName atau sebaliknya
      let partialMatch: { id: string; name: string } | null = null
      for (const [key, val] of nameIndex.entries()) {
        if (usedPointIds.has(val.id)) continue
        if (key.includes(baseName) || baseName.includes(key)) {
          // Prefer match yang panjangnya mirip
          if (!partialMatch || Math.abs(key.length - baseName.length) < Math.abs(partialMatch.name.length - baseName.length)) {
            partialMatch = val
          }
        }
      }

      if (partialMatch) {
        matches.push({ fileName, pointId: partialMatch.id, pointName: partialMatch.name, confidence: 'partial' })
        usedPointIds.add(partialMatch.id)
      } else {
        unmatched.push(fileName)
      }
    }

    return NextResponse.json({
      matches,
      unmatched,
      stats: {
        totalFiles: fileNames.length,
        matched: matches.length,
        unmatched: unmatched.length,
        exactMatches: matches.filter(m => m.confidence === 'exact').length,
        partialMatches: matches.filter(m => m.confidence === 'partial').length,
      },
    })
  } catch (error) {
    console.error('Bulk match error:', error)
    return NextResponse.json({ error: 'Gagal melakukan matching' }, { status: 500 })
  }
}
