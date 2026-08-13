'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Upload, X, Trash2, ZoomIn, Plus, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

interface PhotoItem {
  id: string; fileName: string; fileSize: number; url: string
  thumbUrl: string | null; width: number | null; height: number | null
  caption: string | null; createdAt: string
}

function makeThumb(file: File, sz = 200): Promise<Blob> {
  return new Promise((ok, no) => {
    const img = new Image(), u = URL.createObjectURL(file)
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = sz; c.height = sz
      const x = c.getContext('2d')!, s = Math.min(img.width, img.height)
      x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, sz, sz)
      c.toBlob(b => { URL.revokeObjectURL(u); b ? ok(b) : no(new Error('thumb fail')) }, 'image/jpeg', 0.8)
    }
    img.onerror = () => { URL.revokeObjectURL(u); no(new Error('img load fail')) }
    img.src = u
  })
}

function getImgSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise(ok => {
    const img = new Image(), u = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(u); ok({ w: img.width, h: img.height }) }
    img.onerror = () => { URL.revokeObjectURL(u); ok({ w: 0, h: 0 }) }
    img.src = u
  })
}

export default function PhotoSection({ pointId }: { pointId: string }) {
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [viewPhoto, setViewPhoto] = useState<PhotoItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/photos?pointId=${pointId}`)
      const d = await r.json(); setPhotos(Array.isArray(d) ? d : [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [pointId])
  useEffect(() => { load() }, [load])

  const doUpload = useCallback(async (file: File) => {
    if (uploading) return
    setUploading(true); setStatusMsg('')

    try {
      const ext = (file.name.split('.').pop()?.toLowerCase() || 'jpg')
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) { toast.error('Gunakan JPG, PNG, atau WebP'); return }
      if (file.size > 10 * 1024 * 1024) { toast.error('Maksimal 10MB'); return }

      const fid = crypto.randomUUID?.() || ('xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)))

      // 1. Upload original ke Supabase Storage
      setStatusMsg('1/4 Upload foto...')
      const origPath = `${pointId}/${fid}.${ext}`
      const { error: err1 } = await supabase.storage.from('odp-photos').upload(origPath, file, { upsert: true })
      if (err1) throw new Error(`Upload gagal: ${err1.message}`)
      const { data: urlData } = supabase.storage.from('odp-photos').getPublicUrl(origPath)
      const url = urlData.publicUrl

      // 2. Upload thumbnail
      setStatusMsg('2/4 Buat thumbnail...')
      let thumbUrl: string | null = null
      try {
        const tb = await makeThumb(file)
        const thumbPath = `${pointId}/thumb_${fid}.jpg`
        const { error: err2 } = await supabase.storage.from('odp-photos').upload(thumbPath, tb, { upsert: true, contentType: 'image/jpeg' })
        if (!err2) {
          const { data: td } = supabase.storage.from('odp-photos').getPublicUrl(thumbPath)
          thumbUrl = td.publicUrl
        }
      } catch (e) { console.warn('thumb:', e) }

      // 3. Baca ukuran
      setStatusMsg('3/4 Baca ukuran...')
      const { w, h } = await getImgSize(file)

      // 4. Simpan metadata ke DB
      setStatusMsg('4/4 Simpan data...')
      const r = await fetch('/api/photos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointId, fileName: file.name, fileSize: file.size, url, thumbUrl, width: w, height: h, mimeType: file.type }),
      })
      const d = await r.json()
      if (r.ok) { toast.success('Foto berhasil diupload!'); setStatusMsg(''); load() }
      else { toast.error(d.error || 'Gagal simpan', { duration: 8000 }); setStatusMsg('ERROR: ' + (d.error || 'save failed')) }
    } catch (err: any) {
      toast.error(err.message || 'Gagal upload', { duration: 8000 })
      setStatusMsg('ERROR: ' + (err.message || String(err)))
      console.error('Upload error:', err)
    } finally { setUploading(false) }
  }, [pointId, load, uploading])

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ''
  }, [doUpload])
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }, [])
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }, [])
  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) doUpload(f) }, [doUpload])
  const doDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Hapus "${name}"?`)) return
    try { const r = await fetch(`/api/photos?id=${id}`, { method: 'DELETE' }); if (r.ok) { toast.success('Dihapus'); load() } else toast.error('Gagal hapus') } catch { toast.error('Gagal hapus') }
  }, [load])

  if (loading) return <div className="border-t border-slate-100"><div className="p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 text-slate-400 animate-spin" /><span className="text-xs text-slate-400">Memuat foto...</span></div></div>

  const dz = dragOver ? 'border-violet-400 bg-violet-50/50' : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/30'

  return (
    <>
      <div className="border-t border-slate-100">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2"><Camera className="w-4 h-4 text-slate-500" /><span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Foto ({photos.length})</span></div>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="h-7 px-2.5 bg-violet-50 text-violet-600 rounded-lg text-[11px] font-semibold hover:bg-violet-100 flex items-center gap-1 disabled:opacity-50">
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Tambah
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
        </div>

        {statusMsg && (
          <div className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] font-medium flex items-center gap-2 ${statusMsg.startsWith('ERROR') ? 'bg-red-50 text-red-600' : 'bg-violet-50 text-violet-600'}`}>
            {statusMsg.startsWith('ERROR') ? <AlertCircle className="w-3.5 h-3.5 shrink-0" /> : <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            <span>{statusMsg}</span>
          </div>
        )}

        {photos.length === 0 ? (
          <div className="px-4 pb-4">
            <div onClick={() => fileRef.current?.click()} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${dz}`}>
              <Upload className={`w-6 h-6 mx-auto mb-2 ${dragOver ? 'text-violet-400' : 'text-slate-300'}`} />
              <p className="text-xs text-slate-400">Upload foto ODP ini</p>
              <p className="text-[10px] text-slate-300 mt-0.5">Klik atau drag & drop</p>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4 grid grid-cols-3 gap-1.5">
            {photos.map(p => (
              <div key={p.id} className="relative group aspect-square rounded-lg overflow-hidden bg-slate-100 cursor-pointer">
                <img src={p.thumbUrl || p.url} alt={p.fileName} className="w-full h-full object-cover" loading="lazy" onClick={() => setViewPhoto(p)} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"><ZoomIn className="w-5 h-5 text-white" /></div>
                <button onClick={e => { e.stopPropagation(); doDelete(p.id, p.fileName) }} className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3 h-3 text-white" /></button>
              </div>
            ))}
            <div onClick={() => fileRef.current?.click()} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} className={`aspect-square rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-all ${dz}`}>
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