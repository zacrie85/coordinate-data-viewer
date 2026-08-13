'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Upload, X, Trash2, ZoomIn, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

interface PhotoItem {
  id: string; fileName: string; fileSize: number; url: string
  thumbUrl: string | null; width: number | null; height: number | null
  caption: string | null; createdAt: string
}

function generateThumbnail(file: File, size = 200): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')!
      const s = Math.min(img.width, img.height)
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size)
      canvas.toBlob(blob => { URL.revokeObjectURL(url); blob ? resolve(blob) : reject(new Error('Canvas empty')) }, 'image/jpeg', 0.8)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Load image failed')) }
    img.src = url
  })
}

function getImageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.width, h: img.height }) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ w: null as any, h: null as any }) }
    img.src = url
  })
}

async function uploadToStorage(file: File | Blob, path: string, contentType: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/odp-photos/${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: file,
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`Storage error ${res.status}: ${t.substring(0, 100)}`) }
  return `${SUPABASE_URL}/storage/v1/object/public/odp-photos/${path}`
}

export default function PhotoSection({ pointId }: { pointId: string }) {
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [viewPhoto, setViewPhoto] = useState<PhotoItem | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/photos?pointId=${pointId}`)
      const data = await res.json()
      setPhotos(Array.isArray(data) ? data : [])
    } catch (err) { console.error('Load photos error:', err) }
    finally { setLoading(false) }
  }, [pointId])
  useEffect(() => { loadPhotos() }, [loadPhotos])

  const handleUpload = useCallback(async (file: File) => {
    if (uploading) return
    setUploading(true)
    try {
      if (!SUPABASE_URL || !SUPABASE_KEY) { toast.error('Supabase belum dikonfigurasi'); return }
      const validExts = ['.jpg', '.jpeg', '.png', '.webp']
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || 'jpg')
      if (!validExts.includes(ext)) { toast.error('Format tidak didukung. Gunakan JPG, PNG, atau WebP.'); return }
      if (file.size > 10 * 1024 * 1024) { toast.error('Ukuran maksimal 10MB'); return }

      const fileId = uuidv4()
      const baseExt = ext.replace('.', '') || 'jpg'

      // 1. Upload original
      const originalPath = `${pointId}/${fileId}.${baseExt}`
      toast.info('Mengupload foto...')
      const url = await uploadToStorage(file, originalPath, file.type || 'image/jpeg')

      // 2. Generate & upload thumbnail
      let thumbUrl: string | null = null
      try {
        const thumb = await generateThumbnail(file)
        const thumbPath = `${pointId}/thumb_${fileId}.jpg`
        thumbUrl = await uploadToStorage(thumb, thumbPath, 'image/jpeg')
      } catch (e) { console.warn('Thumbnail failed:', e) }

      // 3. Get dimensions
      const { w, h } = await getImageSize(file)

      // 4. Save metadata ke database via API
      toast.info('Menyimpan...')
      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointId, fileName: file.name, fileSize: file.size, url, thumbUrl, width: w, height: h, mimeType: file.type }),
      })
      const data = await res.json()
      if (res.ok) { toast.success('Foto berhasil diupload!'); loadPhotos() }
      else { toast.error(data.error || 'Gagal menyimpan', { duration: 5000 }) }
    } catch (err: any) {
      toast.error(err.message || 'Gagal upload foto', { duration: 5000 })
      console.error('Upload error:', err)
    } finally { setUploading(false) }
  }, [pointId, loadPhotos, uploading])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    e.target.value = ''
  }, [handleUpload])

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }, [])
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleUpload(f) }, [handleUpload])

  const handleDelete = useCallback(async (photoId: string, fileName: string) => {
    if (!confirm(`Hapus foto "${fileName}"?`)) return
    try {
      const res = await fetch(`/api/photos?id=${photoId}`, { method: 'DELETE' })
      if (res.ok) { toast.success('Foto dihapus'); loadPhotos() }
      else toast.error('Gagal menghapus foto')
    } catch { toast.error('Gagal menghapus foto') }
  }, [loadPhotos])

  if (loading) return <div className="border-t border-slate-100"><div className="p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 text-slate-400 animate-spin" /><span className="text-xs text-slate-400">Memuat foto...</span></div></div>

  const dzClass = dragOver ? 'border-violet-400 bg-violet-50/50' : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/30'

  return (
    <>
      <div className="border-t border-slate-100">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2"><Camera className="w-4 h-4 text-slate-500" /><span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Foto ({photos.length})</span></div>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="h-7 px-2.5 bg-violet-50 text-violet-600 rounded-lg text-[11px] font-semibold hover:bg-violet-100 flex items-center gap-1 disabled:opacity-50">
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Tambah
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={handleFileSelect} className="hidden" />
        </div>

        {uploading && <div className="px-4 pb-2"><div className="flex items-center gap-2 text-xs text-violet-600"><Loader2 className="w-3 h-3 animate-spin" /><span>Mengupload...</span></div></div>}

        {photos.length === 0 ? (
          <div className="px-4 pb-4">
            <div onClick={() => fileInputRef.current?.click()} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${dzClass}`}>
              <Upload className={`w-6 h-6 mx-auto mb-2 ${dragOver ? 'text-violet-400' : 'text-slate-300'}`} />
              <p className="text-xs text-slate-400">Upload foto ODP ini</p>
              <p className="text-[10px] text-slate-300 mt-0.5">Klik atau drag & drop</p>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4 grid grid-cols-3 gap-1.5">
            {photos.map(photo => (
              <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden bg-slate-100 cursor-pointer">
                <img src={photo.thumbUrl || photo.url} alt={photo.fileName} className="w-full h-full object-cover" loading="lazy" onClick={() => setViewPhoto(photo)} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"><ZoomIn className="w-5 h-5 text-white" /></div>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(photo.id, photo.fileName) }} className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3 h-3 text-white" /></button>
              </div>
            ))}
            <div onClick={() => fileInputRef.current?.click()} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`aspect-square rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-all ${dzClass}`}>
              <Plus className={`w-5 h-5 ${dragOver ? 'text-violet-400' : 'text-slate-300'}`} />
            </div>
          </div>
        )}
      </div>

      {viewPhoto && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80" onClick={() => setViewPhoto(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img src={viewPhoto.url} alt={viewPhoto.fileName} className="max-w-full max-h-[85vh] rounded-lg object-contain" />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg p-4">
              <p className="text-white text-sm font-medium truncate">{viewPhoto.fileName}</p>
              {viewPhoto.width && viewPhoto.height && <p className="text-white/60 text-xs">{viewPhoto.width} x {viewPhoto.height} - {(viewPhoto.fileSize / 1024).toFixed(0)} KB</p>}
            </div>
            <button onClick={() => setViewPhoto(null)} className="absolute top-2 right-2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70"><X className="w-4 h-4 text-white" /></button>
          </div>
        </div>
      )}
    </>
  )
}