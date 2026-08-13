'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Upload, X, Trash2, ZoomIn, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface PhotoItem {
  id: string
  fileName: string
  fileSize: number
  url: string
  thumbUrl: string | null
  width: number | null
  height: number | null
  caption: string | null
  createdAt: string
}

interface PhotoSectionProps {
  pointId: string
}

export default function PhotoSection({ pointId }: PhotoSectionProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [viewPhoto, setViewPhoto] = useState<PhotoItem | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/photos?pointId=${pointId}`)
      const data = await res.json()
      setPhotos(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Load photos error:', err)
    } finally {
      setLoading(false)
    }
  }, [pointId])

  useEffect(() => { loadPhotos() }, [loadPhotos])

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('pointId', pointId)
      const res = await fetch('/api/photos', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) { toast.success('Foto berhasil diupload'); loadPhotos() }
      else { toast.error(data.error || 'Gagal upload foto') }
    } catch (err) {
      toast.error('Gagal upload foto')
    } finally {
      setUploading(false)
    }
  }, [pointId, loadPhotos])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    e.target.value = ''
  }, [handleUpload])

  const handleDelete = useCallback(async (photoId: string, fileName: string) => {
    if (!confirm(`Hapus foto "${fileName}"?`)) return
    try {
      const res = await fetch(`/api/photos?id=${photoId}`, { method: 'DELETE' })
      if (res.ok) { toast.success('Foto dihapus'); loadPhotos() }
      else { toast.error('Gagal menghapus foto') }
    } catch (err) {
      toast.error('Gagal menghapus foto')
    }
  }, [loadPhotos])

  if (loading) {
    return (
      <div className="border-t border-slate-100">
        <div className="p-4 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
          <span className="text-xs text-slate-400">Memuat foto...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="border-t border-slate-100">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Foto ({photos.length})</span>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="h-7 px-2.5 bg-violet-50 text-violet-600 rounded-lg text-[11px] font-semibold hover:bg-violet-100 flex items-center gap-1 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Tambah
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
        </div>

        {photos.length === 0 ? (
          <div className="px-4 pb-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition-all"
            >
              <Upload className="w-6 h-6 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-400">Upload foto ODP ini</p>
              <p className="text-[10px] text-slate-300 mt-0.5">Klik atau drag & drop</p>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4 grid grid-cols-3 gap-1.5">
            {photos.map(photo => (
              <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden bg-slate-100 cursor-pointer">
                <img
                  src={photo.thumbUrl || photo.url}
                  alt={photo.fileName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onClick={() => setViewPhoto(photo)}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <ZoomIn className="w-5 h-5 text-white" />
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(photo.id, photo.fileName) }}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition-all"
            >
              <Plus className="w-5 h-5 text-slate-300" />
            </div>
          </div>
        )}
      </div>

      {viewPhoto && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80" onClick={() => setViewPhoto(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img
              src={viewPhoto.url}
              alt={viewPhoto.fileName}
              className="max-w-full max-h-[85vh] rounded-lg object-contain"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg p-4">
              <p className="text-white text-sm font-medium truncate">{viewPhoto.fileName}</p>
              {viewPhoto.width && viewPhoto.height && (
                <p className="text-white/60 text-xs">{viewPhoto.width} x {viewPhoto.height} - {(viewPhoto.fileSize / 1024).toFixed(0)} KB</p>
              )}
            </div>
            <button
              onClick={() => setViewPhoto(null)}
              className="absolute top-2 right-2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
