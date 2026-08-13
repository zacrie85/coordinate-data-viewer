import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/// GET /api/photos?pointId=xxx — Ambil semua foto untuk satu DataPoint
export async function GET(req: NextRequest) {
  const pointId = req.nextUrl.searchParams.get('pointId')
  if (!pointId) {
    return NextResponse.json({ error: 'pointId wajib diisi' }, { status: 400 })
  }

  try {
    const photos = await db.photo.findMany({
      where: { pointId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, fileName: true, fileSize: true, mimeType: true,
        url: true, thumbUrl: true, width: true, height: true,
        caption: true, createdAt: true,
      },
    })
    return NextResponse.json(photos)
  } catch (error) {
    console.error('Photos GET error:', error)
    return NextResponse.json({ error: 'Gagal mengambil foto' }, { status: 500 })
  }
}

/// POST /api/photos — Simpan metadata foto ke database
/// Body (JSON):
///   pointId: string (wajib)
///   fileName: string (wajib)
///   fileSize: number
///   url: string (wajib)
///   thumbUrl: string | null
///   width: number | null
///   height: number | null
///   mimeType: string | null
///   caption: string | null
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { pointId, fileName, fileSize, url, thumbUrl, width, height, mimeType, caption } = body

    if (!pointId) return NextResponse.json({ error: 'pointId wajib diisi' }, { status: 400 })
    if (!fileName) return NextResponse.json({ error: 'fileName wajib diisi' }, { status: 400 })
    if (!url) return NextResponse.json({ error: 'url wajib diisi' }, { status: 400 })

    // Cek DataPoint ada
    const point = await db.dataPoint.findUnique({ where: { id: pointId } })
    if (!point) {
      return NextResponse.json({ error: 'DataPoint tidak ditemukan' }, { status: 404 })
    }

    // Simpan ke database
    const photo = await db.photo.create({
      data: {
        pointId,
        fileName,
        fileSize: fileSize || 0,
        mimeType: mimeType || 'image/jpeg',
        url,
        thumbUrl: thumbUrl || null,
        width: width || null,
        height: height || null,
        caption: caption || null,
      },
    })

    return NextResponse.json({ id: photo.id }, { status: 201 })
  } catch (error: any) {
    console.error('Photo save error:', error)
    return NextResponse.json({ error: error.message || 'Gagal menyimpan foto' }, { status: 500 })
  }
}

/// DELETE /api/photos?id=xxx — Hapus foto
export async function DELETE(req: NextRequest) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  try {
    const photoId = req.nextUrl.searchParams.get('id')
    if (!photoId) return NextResponse.json({ error: 'id wajib diisi' }, { status: 400 })

    const photo = await db.photo.findUnique({ where: { id: photoId } })
    if (!photo) return NextResponse.json({ error: 'Foto tidak ditemukan' }, { status: 404 })

    // Hapus dari Supabase Storage
    if (SUPABASE_URL && SUPABASE_KEY) {
      const storagePath = photo.url.replace(`${SUPABASE_URL}/storage/v1/object/public/odp-photos/`, '')
      await fetch(`${SUPABASE_URL}/storage/v1/object/odp-photos/${storagePath}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
      }).catch(() => {})

      if (photo.thumbUrl) {
        const thumbPath = photo.thumbUrl.replace(`${SUPABASE_URL}/storage/v1/object/public/odp-photos/`, '')
        await fetch(`${SUPABASE_URL}/storage/v1/object/odp-photos/${thumbPath}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
        }).catch(() => {})
      }
    }

    await db.photo.delete({ where: { id: photoId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Photo delete error:', error)
    return NextResponse.json({ error: 'Gagal menghapus foto' }, { status: 500 })
  }
}