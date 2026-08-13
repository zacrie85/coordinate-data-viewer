import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/// Upload foto ke Supabase Storage
async function uploadToStorage(file: File, storagePath: string): Promise<{ url: string; thumbUrl: string | null }> {
  // Step 1: Upload original ke Supabase Storage
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/odp-photos/${storagePath}`
  
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type,
      'x-upsert': 'true',
    },
    body: file,
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    throw new Error(`Storage upload failed: ${err}`)
  }

  // Public URL for original
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/odp-photos/${storagePath}`

  // Step 2: Generate thumbnail menggunakan sharp (server-side)
  let thumbUrl: string | null = null
  try {
    const arrayBuffer = await file.arrayBuffer()
    const sharp = (await import('sharp')).default
    const buffer = Buffer.from(arrayBuffer)

    const thumbBuffer = await sharp(buffer)
      .resize(200, 200, { fit: 'cover', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    const thumbFileName = `thumb_${storagePath.replace(/\.[^.]+$/, '.jpg')}`
    const thumbUploadUrl = `${SUPABASE_URL}/storage/v1/object/odp-photos/${thumbFileName}`

    const thumbRes = await fetch(thumbUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
      body: thumbBuffer,
    })

    if (thumbRes.ok) {
      thumbUrl = `${SUPABASE_URL}/storage/v1/object/public/odp-photos/${thumbFileName}`
    }
  } catch (e) {
    console.warn('Thumbnail generation failed:', e)
  }

  return { url: publicUrl, thumbUrl }
}

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

/// POST /api/photos — Upload foto (single atau multiple via FormData)
/// Body (FormData):
///   file: File (wajib)
///   pointId: string (wajib) — ID DataPoint
///   caption?: string
export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase Storage belum dikonfigurasi. Tambahkan NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env' }, { status: 500 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const pointId = formData.get('pointId') as string | null
    const caption = formData.get('caption') as string | null

    if (!file) return NextResponse.json({ error: 'File wajib diisi' }, { status: 400 })
    if (!pointId) return NextResponse.json({ error: 'pointId wajib diisi' }, { status: 400 })

    // Validasi tipe file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
      return NextResponse.json({ error: 'Tipe file tidak didukung. Gunakan JPG, PNG, atau WebP.' }, { status: 400 })
    }

    // Validasi ukuran (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Ukuran file maksimal 10MB' }, { status: 400 })
    }

    // Cek DataPoint ada
    const point = await db.dataPoint.findUnique({ where: { id: pointId } })
    if (!point) return NextResponse.json({ error: 'DataPoint tidak ditemukan' }, { status: 404 })

    // Generate storage path: {pointId}/{uuid}.{ext}
    const ext = file.name.split('.').pop() || 'jpg'
    const fileId = uuidv4()
    const storagePath = `${pointId}/${fileId}.${ext}`

    // Upload ke Supabase Storage
    const { url, thumbUrl } = await uploadToStorage(file, storagePath)

    // Ambil dimensi gambar
    let width: number | null = null
    let height: number | null = null
    try {
      const arrayBuffer = await file.arrayBuffer()
      const sharp = (await import('sharp')).default
      const buffer = Buffer.from(arrayBuffer)
      const metadata = await sharp(buffer).metadata()
      width = metadata.width || null
      height = metadata.height || null
    } catch (e) {
      // ignore
    }

    // Simpan ke database
    const photo = await db.photo.create({
      data: {
        pointId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        url,
        thumbUrl,
        width,
        height,
        caption: caption || null,
      },
    })

    return NextResponse.json({
      id: photo.id,
      fileName: photo.fileName,
      fileSize: photo.fileSize,
      url: photo.url,
      thumbUrl: photo.thumbUrl,
      width: photo.width,
      height: photo.height,
      caption: photo.caption,
      createdAt: photo.createdAt,
    }, { status: 201 })
  } catch (error: any) {
    console.error('Photo upload error:', error)
    return NextResponse.json({ error: error.message || 'Gagal upload foto' }, { status: 500 })
  }
}

/// DELETE /api/photos?id=xxx — Hapus foto
export async function DELETE(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Storage belum dikonfigurasi' }, { status: 500 })
  }

  try {
    const photoId = req.nextUrl.searchParams.get('id')
    if (!photoId) return NextResponse.json({ error: 'id wajib diisi' }, { status: 400 })

    const photo = await db.photo.findUnique({ where: { id: photoId } })
    if (!photo) return NextResponse.json({ error: 'Foto tidak ditemukan' }, { status: 404 })

    // Hapus dari Supabase Storage
    const storagePath = photo.url.replace(`${SUPABASE_URL}/storage/v1/object/public/odp-photos/`, '')
    await fetch(`${SUPABASE_URL}/storage/v1/object/odp-photos/${storagePath}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
    }).catch(() => {})

    // Hapus thumbnail jika ada
    if (photo.thumbUrl) {
      const thumbPath = photo.thumbUrl.replace(`${SUPABASE_URL}/storage/v1/object/public/odp-photos/`, '')
      await fetch(`${SUPABASE_URL}/storage/v1/object/odp-photos/${thumbPath}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
      }).catch(() => {})
    }

    // Hapus dari database
    await db.photo.delete({ where: { id: photoId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Photo delete error:', error)
    return NextResponse.json({ error: 'Gagal menghapus foto' }, { status: 500 })
  }
}
