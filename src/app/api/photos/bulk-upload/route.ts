import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

async function uploadToStorage(file: File, storagePath: string): Promise<{ url: string; thumbUrl: string | null }> {
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/odp-photos/${storagePath}`
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type || 'image/jpeg',
      'x-upsert': 'true',
    },
    body: file,
  })
  if (!uploadRes.ok) throw new Error(`Storage upload failed for ${storagePath}`)

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/odp-photos/${storagePath}`
  let thumbUrl: string | null = null

  try {
    const arrayBuffer = await file.arrayBuffer()
    const sharp = (await import('sharp')).default
    const buffer = Buffer.from(arrayBuffer)
    const thumbBuffer = await sharp(buffer).resize(200, 200, { fit: 'cover', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
    const thumbFileName = `thumb_${storagePath.replace(/\.[^.]+$/, '.jpg')}`
    const thumbUploadUrl = `${SUPABASE_URL}/storage/v1/object/odp-photos/${thumbFileName}`
    const thumbRes = await fetch(thumbUploadUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      body: thumbBuffer,
    })
    if (thumbRes.ok) thumbUrl = `${SUPABASE_URL}/storage/v1/object/public/odp-photos/${thumbFileName}`
  } catch (e) { console.warn('Thumbnail failed:', e) }

  return { url: publicUrl, thumbUrl }
}

/// POST /api/photos/bulk-upload
/// Body (JSON): { uploads: [{ pointId: string, file: base64 string, fileName: string, mimeType: string }] }
/// Atau FormData dengan multiple files + mapping JSON
export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase Storage belum dikonfigurasi' }, { status: 500 })
  }

  try {
    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      // ── Mode 1: FormData (untuk upload dari browser langsung) ──
      const formData = await req.formData()
      const mappingJson = formData.get('mapping') as string | null
      if (!mappingJson) return NextResponse.json({ error: 'mapping JSON wajib' }, { status: 400 })

      const mapping: { fileName: string; pointId: string }[] = JSON.parse(mappingJson)
      const fileMap = new Map<string, File>()
      for (const [key, value] of formData.entries()) {
        if (value instanceof File && key !== 'mapping') {
          fileMap.set(key, value)
        }
      }

      const results: { fileName: string; pointId: string; success: boolean; photoId?: string; error?: string }[] = []

      for (const item of mapping) {
        try {
          const file = fileMap.get(item.fileName)
          if (!file) { results.push({ fileName: item.fileName, pointId: item.pointId, success: false, error: 'File tidak ditemukan di FormData' }); continue }

          // Validasi DataPoint ada
          const point = await db.dataPoint.findUnique({ where: { id: item.pointId } })
          if (!point) { results.push({ fileName: item.fileName, pointId: item.pointId, success: false, error: 'DataPoint tidak ditemukan' }); continue }

          const ext = file.name.split('.').pop() || 'jpg'
          const storagePath = `${item.pointId}/${uuidv4()}.${ext}`
          const { url, thumbUrl } = await uploadToStorage(file, storagePath)

          const photo = await db.photo.create({
            data: { pointId: item.pointId, fileName: file.name, fileSize: file.size, mimeType: file.type, url, thumbUrl },
          })

          results.push({ fileName: item.fileName, pointId: item.pointId, success: true, photoId: photo.id })
        } catch (e: any) {
          results.push({ fileName: item.fileName, pointId: item.pointId, success: false, error: e.message })
        }
      }

      const success = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      return NextResponse.json({ message: `${success} foto berhasil, ${failed} gagal`, results }, { status: 200 })

    } else {
      // ── Mode 2: JSON body (untuk bulk upload dari client) ──
      const body = await req.json()
      const { uploads } = body as { uploads: { pointId: string; fileData: string; fileName: string; mimeType: string }[] }

      if (!uploads || !Array.isArray(uploads)) {
        return NextResponse.json({ error: 'uploads array wajib' }, { status: 400 })
      }

      const results: { fileName: string; pointId: string; success: boolean; photoId?: string; error?: string }[] = []

      for (const item of uploads) {
        try {
          const fileBuffer = Buffer.from(item.fileData, 'base64')
          const file = new File([fileBuffer], item.fileName, { type: item.mimeType || 'image/jpeg' })

          const point = await db.dataPoint.findUnique({ where: { id: item.pointId } })
          if (!point) { results.push({ fileName: item.fileName, pointId: item.pointId, success: false, error: 'DataPoint tidak ditemukan' }); continue }

          const ext = item.fileName.split('.').pop() || 'jpg'
          const storagePath = `${item.pointId}/${uuidv4()}.${ext}`
          const { url, thumbUrl } = await uploadToStorage(file, storagePath)

          const photo = await db.photo.create({
            data: { pointId: item.pointId, fileName: item.fileName, fileSize: fileBuffer.length, mimeType: item.mimeType || 'image/jpeg', url, thumbUrl },
          })

          results.push({ fileName: item.fileName, pointId: item.pointId, success: true, photoId: photo.id })
        } catch (e: any) {
          results.push({ fileName: item.fileName, pointId: item.pointId, success: false, error: e.message })
        }
      }

      const success = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      return NextResponse.json({ message: `${success} foto berhasil, ${failed} gagal`, results }, { status: 200 })
    }
  } catch (error: any) {
    console.error('Bulk upload error:', error)
    return NextResponse.json({ error: error.message || 'Gagal bulk upload' }, { status: 500 })
  }
}
