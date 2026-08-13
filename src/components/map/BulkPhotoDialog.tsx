'use client'

import { useState, useCallback, useRef } from 'react'
import { X, Upload, Image, Check, AlertCircle, Loader2, Camera, MapPin, FolderSearch } from 'lucide-react'
import { toast } from 'sonner'

interface MatchResult {
  fileName: string
  pointId: string
  pointName: string
  confidence: 'exact' | 'partial'
}

interface BulkPhotoDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  columns: string[]
  markerConfig: { nameCol1: string; nameCol2: string }
  // Untuk mode area upload
  selectedAreaIds?: Set<string> | null
  areaPoints?: { id: string; metadata: Record<string, any> }[]
}

type UploadMode = 'dragdrop' | 'area'

export default function BulkPhotoDialog({
  open, onOpenChange, columns, markerConfig, selectedAreaIds, areaPoints,
}: BulkPhotoDialogProps) {
  const [mode, setMode] = useState<UploadMode>('dragdrop')
  const [files, setFiles] = useState<File[]>([])
  const [matchColumn, setMatchColumn] = useState('')
  const [matches, setMatches] = useState<MatchResult[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [matching, setMatching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState<{ success: boolean; fileName: string; error?: string }[]>([])
  const [step, setStep] = useState<'select' | 'match' | 'upload' | 'done'>('select')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const nameCol = matchColumn || markerConfig.nameCol1 || markerConfig.nameCol2 || ''

  // Reset saat dialog buka
  const handleOpen = useCallback((v: boolean) => {
    if (!v) {
      setFiles([])
      setMatches([])
      setUnmatched([])
      setStep('select')
      setUploadResults([])
      setMode(selectedAreaIds && selectedAreaIds.size > 0 ? 'area' : 'dragdrop')
    }
    onOpenChange(v)
  }, [onOpenChange, selectedAreaIds])

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('image/') || f.name.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)
    )
    if (droppedFiles.length === 0) {
      toast.error('Hanya file gambar yang didukung (JPG, PNG, WebP)')
      return
    }
    setFiles(prev => [...prev, ...droppedFiles])
    setStep('match')
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (selected.length > 0) {
      setFiles(prev => [...prev, ...selected])
      setStep('match')
    }
    e.target.value = ''
  }, [])

  // Auto-match files ke DataPoint
  const doMatch = useCallback(async () => {
    if (files.length === 0) return
    setMatching(true)
    try {
      const fileNames = files.map(f => f.name).join(',')
      const params = new URLSearchParams({ fileNames, nameCol })
      const res = await fetch(`/api/photos/bulk-match?${params}`)
      const data = await res.json()
      setMatches(data.matches || [])
      setUnmatched(data.unmatched || [])
      if (data.stats) {
        toast.info(`Match: ${data.stats.matched} cocok, ${data.stats.unmatched} tidak cocok`)
      }
    } catch (err) {
      toast.error('Gagal melakukan matching')
    } finally {
      setMatching(false)
    }
  }, [files, nameCol])

  // Lakukan match otomatis saat files berubah
  const [matchTriggered, setMatchTriggered] = useState(false)
  useState(() => {
    if (files.length > 0 && !matchTriggered) {
      setMatchTriggered(true)
    }
  })

  // Upload semua file yang sudah di-match
  const doUpload = useCallback(async () => {
    if (matches.length === 0) return
    setUploading(true)
    setStep('upload')

    try {
      const formData = new FormData()
      const mapping: { fileName: string; pointId: string }[] = []

      for (const match of matches) {
        const file = files.find(f => f.name === match.fileName)
        if (!file) continue
        formData.append(match.fileName, file)
        mapping.push({ fileName: match.fileName, pointId: match.pointId })
      }

      formData.append('mapping', JSON.stringify(mapping))

      const res = await fetch('/api/photos/bulk-upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      setUploadResults(data.results || [])
      setStep('done')
      const success = data.results?.filter((r: any) => r.success).length || 0
      const failed = data.results?.filter((r: any) => !r.success).length || 0
      toast.success(`${success} foto berhasil di-upload${failed > 0 ? `, ${failed} gagal` : ''}`)
    } catch (err) {
      toast.error('Gagal upload foto')
      setStep('match')
    } finally {
      setUploading(false)
    }
  }, [matches, files])

  // Area upload: upload untuk semua ODP di area terpilih
  const doAreaUpload = useCallback(async (areaFiles: File[]) => {
    if (!areaPoints || areaPoints.length === 0 || areaFiles.length === 0) return
    setUploading(true)
    setStep('upload')

    try {
      const formData = new FormData()
      const mapping: { fileName: string; pointId: string }[] = []

      // Match files ke area points
      for (const file of areaFiles) {
        const baseName = file.name.replace(/\.[^.]+$/, '').trim().toLowerCase().replace(/[^a-z0-9\-_._]/gi, '')
        let matchedPoint: { id: string; metadata: Record<string, any> } | null = null

        for (const point of areaPoints) {
          for (const [, val] of Object.entries(point.metadata)) {
            const normalized = String(val).trim().toLowerCase().replace(/[^a-z0-9\-_._]/gi, '')
            if (normalized === baseName) { matchedPoint = point; break }
          }
          if (matchedPoint) break
        }

        if (matchedPoint) {
          formData.append(file.name, file)
          mapping.push({ fileName: file.name, pointId: matchedPoint.id })
        }
      }

      if (mapping.length === 0) {
        toast.error('Tidak ada file yang cocok dengan ODP di area')
        setUploading(false)
        setStep('select')
        return
      }

      formData.append('mapping', JSON.stringify(mapping))

      const res = await fetch('/api/photos/bulk-upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      setUploadResults(data.results || [])
      setStep('done')
      toast.success(`${mapping.length} foto berhasil di-upload ke area`)
    } catch (err) {
      toast.error('Gagal upload foto area')
      setStep('select')
    } finally {
      setUploading(false)
    }
  }, [areaPoints])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => handleOpen(false)} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
              <Camera className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Upload Foto ODP</h2>
              <p className="text-xs text-slate-400">Foto akan tampil di popup web & Google Earth</p>
            </div>
          </div>
          <button onClick={() => handleOpen(false)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-2 px-5 pt-4">
          <button
            onClick={() => { setMode('dragdrop'); setStep('select'); setFiles([]); setMatches([]); setUnmatched([]); setUploadResults([]) }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${mode === 'dragdrop' ? 'bg-violet-500 text-white shadow-lg shadow-violet-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            <Upload className="w-4 h-4" />
            Drag & Drop + Auto-Match
          </button>
          {selectedAreaIds && selectedAreaIds.size > 0 && (
            <button
              onClick={() => { setMode('area'); setStep('select'); setFiles([]); setMatches([]); setUploadResults([]) }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${mode === 'area' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              <MapPin className="w-4 h-4" />
              Upload Area ({selectedAreaIds.size} ODP)
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Step: Select files */}
          {step === 'select' && (
            <div>
              {mode === 'dragdrop' && (
                <div>
                  <div
                    ref={dropRef}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition-all"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                      <Image className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-600 mb-1">Drag & drop foto di sini</p>
                    <p className="text-xs text-slate-400 mb-3">atau klik untuk pilih file</p>
                    <p className="text-[10px] text-slate-300">JPG, PNG, WebP, HEIC • Maks 10MB per file</p>
                  </div>
                  <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileSelect} className="hidden" />

                  {files.length > 0 && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-600">{files.length} file dipilih</span>
                        <button onClick={() => { setFiles([]); setStep('select') }} className="text-xs text-red-500 hover:text-red-600">Hapus Semua</button>
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {files.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5">
                            <Image className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{f.name}</span>
                            <span className="text-slate-300 ml-auto shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={doMatch}
                        disabled={matching}
                        className="mt-3 w-full py-2.5 bg-violet-500 text-white rounded-xl text-sm font-semibold hover:bg-violet-600 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {matching ? <><Loader2 className="w-4 h-4 animate-spin" /> Matching...</> : <><FolderSearch className="w-4 h-4" /> Auto-Match ke ODP</>}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {mode === 'area' && (
                <div>
                  <div
                    ref={dropRef}
                    onDragOver={handleDragOver}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation()
                      const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
                      if (dropped.length > 0) {
                        setFiles(dropped)
                        doAreaUpload(dropped)
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-emerald-200 rounded-2xl p-10 text-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-all"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                      <MapPin className="w-8 h-8 text-emerald-500" />
                    </div>
                    <p className="text-sm font-semibold text-slate-600 mb-1">Upload foto untuk {selectedAreaIds?.size || 0} ODP terpilih</p>
                    <p className="text-xs text-slate-400 mb-3">Nama file akan di-auto-match ke nama ODP di area</p>
                    <p className="text-[10px] text-slate-300">Contoh: ODP-001.jpg → cocok ke ODP dengan nama &quot;ODP-001&quot;</p>
                  </div>
                  <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={(e) => {
                    const selected = Array.from(e.target.files || [])
                    if (selected.length > 0) { setFiles(selected); doAreaUpload(selected) }
                    e.target.value = ''
                  }} className="hidden" />
                </div>
              )}
            </div>
          )}

          {/* Step: Match review */}
          {step === 'match' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-700">Hasil Auto-Match</h3>
                <div className="flex gap-2 text-[11px]">
                  <span className="text-green-600 font-semibold">{matches.length} cocok</span>
                  {unmatched.length > 0 && <span className="text-red-400 font-semibold">{unmatched.length} tidak cocok</span>}
                </div>
              </div>

              {matches.length > 0 && (
                <div className="space-y-1.5 mb-4 max-h-48 overflow-y-auto">
                  {matches.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 bg-green-50 rounded-lg px-3 py-2 text-xs">
                      <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      <span className="font-medium text-slate-700 truncate">{m.fileName}</span>
                      <span className="text-slate-300">→</span>
                      <span className={`truncate ${m.confidence === 'exact' ? 'text-green-700' : 'text-yellow-600'}`}>
                        {m.pointName}
                      </span>
                      {m.confidence === 'partial' && (
                        <span className="shrink-0 text-[10px] bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded font-medium">partial</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {unmatched.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-red-400 mb-1.5">Tidak cocok:</p>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {unmatched.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 bg-red-50 rounded-lg px-3 py-1.5 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep('select')} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-200">Kembali</button>
                <button
                  onClick={doUpload}
                  disabled={matches.length === 0 || uploading}
                  className="flex-1 py-2.5 bg-violet-500 text-white rounded-xl text-sm font-semibold hover:bg-violet-600 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : `Upload ${matches.length} Foto`}
                </button>
              </div>
            </div>
          )}

          {/* Step: Uploading */}
          {step === 'upload' && (
            <div className="text-center py-10">
              <Loader2 className="w-10 h-10 text-violet-500 animate-spin mx-auto mb-4" />
              <p className="text-sm font-semibold text-slate-600">Mengupload foto...</p>
              <p className="text-xs text-slate-400 mt-1">Mohon tunggu, jangan tutup halaman ini</p>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div>
              <div className="text-center mb-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">Upload Selesai!</h3>
                <p className="text-sm text-slate-400">
                  {uploadResults.filter(r => r.success).length} berhasil, {uploadResults.filter(r => !r.success).length} gagal
                </p>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 mb-4">
                {uploadResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${r.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-500'}`}>
                    {r.success ? <Check className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                    <span className="truncate">{r.fileName}</span>
                    {!r.success && r.error && <span className="text-slate-400 ml-auto shrink-0 truncate max-w-[120px]">{r.error}</span>}
                  </div>
                ))}
              </div>
              <button onClick={() => handleOpen(false)} className="w-full py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-200">Tutup</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
