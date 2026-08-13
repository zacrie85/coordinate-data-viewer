'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, X, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2, Database, Crosshair, Eye } from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

const CHUNK_SIZE = 200

interface DetectionResult {
  latCol: string | null
  lngCol: string | null
  coordCol: string | null
}

interface UploadExcelDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onUploadComplete: () => void
}

export default function UploadExcelDialog({ open, onOpenChange, onUploadComplete }: UploadExcelDialogProps) {
  const [mode, setMode] = useState<'append' | 'replace'>('replace')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<any>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [datasetName, setDatasetName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Preview state
  const [preview, setPreview] = useState<{
    headers: string[]
    rowCount: number
    sampleRows: Record<string, any>[]
  } | null>(null)
  const [detection, setDetection] = useState<DetectionResult | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.match(/\.xlsx?$/i)) { toast.error('Hanya file .xls/.xlsx'); return }

    setFile(f)
    setResult(null)
    setConfirmReplace(false)
    setProgress(0)
    setDatasetName(f.name.replace(/\.xlsx?$/i, ''))

    try {
      const buffer = await f.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
      const headers = Object.keys(data[0] || {})

      setPreview({ headers, rowCount: data.length, sampleRows: data.slice(0, 3) })

      // Auto-detect coordinates
      const res = await fetch('/api/upload-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect', headers }),
      })
      const detData = await res.json()
      setDetection(detData.detection || null)
    } catch {
      toast.error('Gagal membaca file Excel')
      setPreview(null)
      setDetection(null)
    }
  }

  const handleUpload = async () => {
    if (!file) { toast.error('Pilih file Excel'); return }
    if (mode === 'replace' && !confirmReplace) { toast.error('Konfirmasi dulu'); return }

    setUploading(true)
    setResult(null)
    setProgress(0)

    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const allRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
      const headers = Object.keys(allRows[0] || {})

      if (allRows.length === 0) { toast.error('File kosong'); setUploading(false); return }

      // Step 1: Create dataset record
      const dsRes = await fetch('/api/upload-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-dataset', headers, datasetName }),
      })
      const dsData = await dsRes.json()
      const datasetId = dsData.datasetId
      const det = dsData.detection || detection || { latCol: null, lngCol: null, coordCol: null }

      // Step 2: Deactivate old datasets
      await fetch('/api/upload-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate-others', datasetId }),
      })

      // Step 3: Upload chunks
      const totalChunks = Math.ceil(allRows.length / CHUNK_SIZE)
      let totalInserted = 0
      let totalSkipped = 0

      for (let i = 0; i < totalChunks; i++) {
        const chunk = allRows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        const res = await fetch('/api/upload-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'insert', datasetId, headers, rows: chunk,
            chunkIndex: i, totalChunks, detection: det,
          }),
        })
        const data = await res.json()
        if (res.ok) {
          totalInserted += data.inserted || 0
          totalSkipped += data.skipped || 0
        }
        setProgress(Math.round(((i + 1) / totalChunks) * 100))
      }

      // Step 4: Update row count
      await fetch('/api/upload-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-count', datasetId, rowCount: allRows.length }),
      })

      const totalSkippedFinal = totalSkipped
      const totalInsertedFinal = totalInserted
      setResult({
        totalRows: allRows.length,
        imported: totalInsertedFinal,
        skipped: totalSkippedFinal,
        datasetName,
        detection: det,
      })

      toast.success(`Berhasil import ${totalInsertedFinal.toLocaleString()} data! Dialog tertutup otomatis...`)
      onUploadComplete()
    } catch (err: any) {
      toast.error('Gagal: ' + (err.message || 'Unknown'))
    } finally {
      setUploading(false)
    }
  }

  const reset = () => {
    setFile(null)
    setResult(null)
    setConfirmReplace(false)
    setProgress(0)
    setPreview(null)
    setDetection(null)
    setDatasetName('')
    if (fileRef.current) fileRef.current.value = ''
  }

  // Auto-close dialog after successful upload
  useEffect(() => {
    if (result && !uploading) {
      closeTimerRef.current = setTimeout(() => {
        reset()
        onOpenChange(false)
      }, 2500)
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [result, uploading])

  // Escape key to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const handleClose = useCallback(() => {
    if (uploading) return
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    reset()
    onOpenChange(false)
  }, [uploading, onOpenChange])

  if (!open) return null

  const coordDetected = detection && (detection.latCol || detection.coordCol)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" style={{ zIndex: 10000 }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-emerald-100 flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Upload Excel</h2>
              <p className="text-[11px] text-slate-400">Format-agnostic: auto-detect koordinat</p>
            </div>
          </div>
          <button onClick={handleClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Dataset Name */}
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Nama Dataset</label>
            <input
              type="text"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="Contoh: ODP List Jakarta"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>

          {/* Mode */}
          <div>
            <label className="text-xs font-medium text-slate-700 mb-2 block">Mode Upload</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setMode('append'); reset() }}
                className={`p-3 rounded-lg border-2 text-left transition-colors ${mode === 'append' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <Upload className={`w-4 h-4 mb-1 ${mode === 'append' ? 'text-emerald-600' : 'text-slate-400'}`} />
                <div className={`text-xs font-bold ${mode === 'append' ? 'text-emerald-800' : 'text-slate-600'}`}>Tambah Dataset Baru</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Dataset sebelumnya tetap ada</div>
              </button>
              <button
                onClick={() => { setMode('replace'); reset() }}
                className={`p-3 rounded-lg border-2 text-left transition-colors ${mode === 'replace' ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <Database className={`w-4 h-4 mb-1 ${mode === 'replace' ? 'text-orange-600' : 'text-slate-400'}`} />
                <div className={`text-xs font-bold ${mode === 'replace' ? 'text-orange-800' : 'text-slate-600'}`}>Ganti Dataset</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Dataset lama jadi non-aktif</div>
              </button>
            </div>
          </div>

          {/* Replace warning */}
          {mode === 'replace' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-red-700">Perhatian!</div>
                <div className="text-[11px] text-red-600 mt-0.5">Dataset lama akan dinonaktifkan (data tidak dihapus).</div>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} className="rounded border-red-300 text-red-600" />
                  <span className="text-[11px] text-red-700 font-medium">Ya, saya yakin</span>
                </label>
              </div>
            </div>
          )}

          {/* File Input */}
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Pilih File Excel</label>
            <div
              onClick={() => !uploading && fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${file ? 'border-emerald-300 bg-emerald-50' : 'border-slate-300 hover:border-slate-400'} ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input ref={fileRef} type="file" accept=".xls,.xlsx" onChange={handleFileChange} className="hidden" />
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <div className="text-left">
                    <div className="text-xs font-semibold text-emerald-700">{file.name}</div>
                    <div className="text-[10px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                  {!uploading && (
                    <button onClick={(e) => { e.stopPropagation(); reset() }} className="ml-2 w-5 h-5 rounded-full hover:bg-red-100 flex items-center justify-center">
                      <X className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <div className="text-xs text-slate-500">Klik untuk pilih file .xls/.xlsx</div>
                  <div className="text-[10px] text-slate-400 mt-1">Koordinat dideteksi otomatis</div>
                </>
              )}
            </div>
          </div>

          {/* Preview + Detection */}
          {preview && (
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-3">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-bold text-slate-700">Preview</span>
                <span className="text-[10px] text-slate-400">{preview.rowCount.toLocaleString()} baris, {preview.headers.length} kolom</span>
              </div>

              {/* Headers */}
              <div className="flex flex-wrap gap-1">
                {preview.headers.map(h => {
                  const isCoord = (detection?.latCol === h || detection?.lngCol === h || detection?.coordCol === h)
                  return (
                    <span key={h} className={`px-2 py-0.5 rounded text-[10px] border ${isCoord ? 'bg-emerald-100 text-emerald-700 border-emerald-300 font-semibold' : 'bg-white text-slate-600 border-slate-200'}`}>
                      {isCoord && <Crosshair className="w-2.5 h-2.5 inline mr-1" />}
                      {h}
                    </span>
                  )
                })}
              </div>

              {/* Detection result */}
              {detection && (
                <div className={`rounded-lg p-2.5 text-[11px] ${coordDetected ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                  <div className="font-semibold mb-1">
                    {coordDetected ? '✓ Koordinat Terdeteksi' : '⚠ Koordinat Tidak Terdeteksi Otomatis'}
                  </div>
                  {detection.latCol && <div>Latitude: <b>{detection.latCol}</b></div>}
                  {detection.lngCol && <div>Longitude: <b>{detection.lngCol}</b></div>}
                  {detection.coordCol && <div>Koordinat Gabungan: <b>{detection.coordCol}</b></div>}
                  {!coordDetected && <div className="mt-1">Akan scan semua kolom mencari format &quot;lat, lng&quot;</div>}
                </div>
              )}

              {/* Sample rows */}
              <div>
                <div className="text-[10px] text-slate-400 mb-1">3 baris pertama:</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="text-left text-slate-500">
                        {preview.headers.slice(0, 6).map(h => <th key={h} className="pr-3 pb-1 font-medium whitespace-nowrap">{h}</th>)}
                        {preview.headers.length > 6 && <th className="pb-1 text-slate-400">...</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, i) => (
                        <tr key={i} className="text-slate-600">
                          {preview.headers.slice(0, 6).map(h => <td key={h} className="pr-3 py-0.5 whitespace-nowrap max-w-[120px] truncate">{String(row[h] || '').substring(0, 30)}</td>)}
                          {preview.headers.length > 6 && <td className="py-0.5 text-slate-400">...</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Progress */}
          {uploading && (
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-600">Mengupload...</span>
                <span className="font-semibold text-emerald-600">{progress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2.5">
                <div className="h-2.5 rounded-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Upload button */}
          <button
            className="w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            disabled={!file || uploading || (mode === 'replace' && !confirmReplace)}
            onClick={handleUpload}
          >
            {uploading ? (
              <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</span>
            ) : (
              <span className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload Data</span>
            )}
          </button>

          {/* Result */}
          {result && (
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-emerald-700">Hasil Upload</div>
                <span className="text-[10px] text-emerald-500">Auto-tutup 3 detik...</span>
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-slate-500">Dataset</span><span className="font-semibold">{result.datasetName}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Total baris</span><span className="font-semibold">{result.totalRows?.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Berhasil</span><span className="font-semibold text-emerald-600">{result.imported?.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Dilewati</span><span className="font-semibold">{result.skipped?.toLocaleString()}</span></div>
              </div>
              <button
                onClick={handleClose}
                className="w-full mt-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors"
              >
                Selesai
              </button>
            </div>
          )}

          {/* Info */}
          <div className="text-[10px] text-slate-400 space-y-0.5">
            <div className="font-semibold text-slate-500 text-xs mb-1">Fitur:</div>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Auto-detect kolom Latitude/Longitude terpisah atau gabungan</li>
              <li>Semua header Excel jadi opsi filter otomatis</li>
              <li>DatasetConfig tersimpan (bisa switch antar dataset)</li>
              <li>Upload chunked (aman untuk file besar di Vercel)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
