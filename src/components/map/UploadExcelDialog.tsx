'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, X, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2, Database, Crosshair, Eye, RefreshCw, Trash2 } from 'lucide-react'
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

type UploadMode = 'append' | 'replace' | 'update'

export default function UploadExcelDialog({ open, onOpenChange, onUploadComplete }: UploadExcelDialogProps) {
  const [mode, setMode] = useState<UploadMode>('replace')
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

  // Update mode state
  const [activeDataset, setActiveDataset] = useState<{ id: string; name: string; headers: string[]; rowCount: number; photoCount: number } | null>(null)
  const [keyCol, setKeyCol] = useState<string>('')
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [loadingActive, setLoadingActive] = useState(false)

  // Fetch active dataset info when switching to update mode
  useEffect(() => {
    if (mode === 'update' && !activeDataset) {
      setLoadingActive(true)
      fetch('/api/upload-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-active-dataset' }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error) {
            toast.error(data.error)
            setMode('replace')
          } else {
            setActiveDataset(data)
            // Auto-detect key column: prefer 'code', 'kode', 'id', 'no'
            const headers = data.headers || []
            const preferred = ['code', 'kode', 'id', 'no', 'number', 'nomor', 'sn', 'serial', 'odp', 'name', 'nama']
            const found = headers.find(h => preferred.some(p => h.toLowerCase().trim() === p))
            setKeyCol(found || headers[0] || '')
          }
        })
        .catch(() => toast.error('Gagal memuat info dataset'))
        .finally(() => setLoadingActive(false))
    }
  }, [mode])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.match(/\.xlsx?$/i)) { toast.error('Hanya file .xls/.xlsx'); return }

    setFile(f)
    setResult(null)
    setConfirmReplace(false)
    setConfirmCleanup(false)
    setProgress(0)
    if (!datasetName || mode !== 'update') setDatasetName(f.name.replace(/\.xlsx?$/i, ''))

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
    if (mode === 'update' && !keyCol) { toast.error('Pilih kolom kunci'); return }

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

      if (mode === 'update') {
        // ═══ UPDATE MODE: update-in-place, foto tetap nyambung ═══
        const res = await fetch('/api/upload-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update-dataset',
            datasetId: activeDataset?.id,
            headers,
            keyCol,
            rows: allRows,
            detection: detection || { latCol: null, lngCol: null, coordCol: null },
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Gagal update')

        setProgress(100)
        setResult({
          totalRows: data.totalRows,
          updated: data.updated,
          inserted: data.inserted,
          removed: data.removed,
          datasetName: activeDataset?.name || 'Update',
          mode: 'update',
        })

        const msg = `Update berhasil: ${data.updated} diupdate, ${data.inserted} baru`
        toast.success(msg)
        onUploadComplete()
      } else {
        // ═══ APPEND / REPLACE MODE: buat dataset baru ═══
        // Step 1: Create dataset record
        const dsRes = await fetch('/api/upload-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create-dataset', headers, datasetName }),
        })
        const dsData = await dsRes.json()
        const datasetId = dsData.datasetId
        const det = dsData.detection || detection || { latCol: null, lngCol: null, coordCol: null }

        // Step 2: Deactivate old datasets (only for replace mode)
        if (mode === 'replace') {
          await fetch('/api/upload-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deactivate-others', datasetId }),
          })
        }

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

        setResult({
          totalRows: allRows.length,
          imported: totalInserted,
          skipped: totalSkipped,
          datasetName,
          detection: det,
          mode,
        })

        toast.success(`Berhasil import ${totalInserted.toLocaleString()} data!`)
        onUploadComplete()
      }
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
    setConfirmCleanup(false)
    setProgress(0)
    setPreview(null)
    setDetection(null)
    if (mode !== 'update') setDatasetName('')
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

  // Reset active dataset when switching away from update mode
  const handleModeChange = (newMode: UploadMode) => {
    setMode(newMode)
    if (newMode !== 'update') {
      setActiveDataset(null)
      setKeyCol('')
    }
    reset()
  }

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
          {/* Dataset Name (hidden in update mode) */}
          {mode !== 'update' && (
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
          )}

          {/* Mode */}
          <div>
            <label className="text-xs font-medium text-slate-700 mb-2 block">Mode Upload</label>
            <div className="grid grid-cols-3 gap-2">
              {/* Mode: Tambah Dataset Baru */}
              <button
                onClick={() => handleModeChange('append')}
                className={`p-2.5 rounded-lg border-2 text-left transition-colors ${mode === 'append' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <Upload className={`w-4 h-4 mb-1 ${mode === 'append' ? 'text-emerald-600' : 'text-slate-400'}`} />
                <div className={`text-[11px] font-bold ${mode === 'append' ? 'text-emerald-800' : 'text-slate-600'}`}>Dataset Baru</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Dataset lama tetap</div>
              </button>

              {/* Mode: Ganti Dataset */}
              <button
                onClick={() => handleModeChange('replace')}
                className={`p-2.5 rounded-lg border-2 text-left transition-colors ${mode === 'replace' ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <Database className={`w-4 h-4 mb-1 ${mode === 'replace' ? 'text-orange-600' : 'text-slate-400'}`} />
                <div className={`text-[11px] font-bold ${mode === 'replace' ? 'text-orange-800' : 'text-slate-600'}`}>Ganti Dataset</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Lama non-aktif</div>
              </button>

              {/* Mode: Update Dataset Aktif (BARU) */}
              <button
                onClick={() => handleModeChange('update')}
                className={`p-2.5 rounded-lg border-2 text-left transition-colors ${mode === 'update' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <RefreshCw className={`w-4 h-4 mb-1 ${mode === 'update' ? 'text-blue-600' : 'text-slate-400'}`} />
                <div className={`text-[11px] font-bold ${mode === 'update' ? 'text-blue-800' : 'text-slate-600'}`}>Update Aktif</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Foto tetap nyambung</div>
              </button>
            </div>
          </div>

          {/* Update Mode: Active Dataset Info & Key Column Selector */}
          {mode === 'update' && activeDataset && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-800">Update Dataset: {activeDataset.name}</span>
              </div>

              <div className="text-[11px] text-blue-700">
                <div className="flex justify-between">
                  <span>Data saat ini:</span>
                  <span className="font-semibold">{activeDataset.rowCount?.toLocaleString()} baris</span>
                </div>
                {activeDataset.photoCount > 0 && (
                  <div className="flex justify-between mt-0.5">
                    <span>Foto terhubung:</span>
                    <span className="font-semibold text-amber-700">{activeDataset.photoCount} foto</span>
                  </div>
                )}
              </div>

              {/* Key Column Selector */}
              <div>
                <label className="text-[11px] font-bold text-blue-800 mb-1 block">
                  Kolom Kunci (untuk matching data)
                </label>
                <select
                  value={keyCol}
                  onChange={(e) => setKeyCol(e.target.value)}
                  className="w-full h-8 px-2 text-xs border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white"
                >
                  <option value="">-- Pilih kolom --</option>
                  {activeDataset.headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <div className="text-[10px] text-blue-600 mt-1">
                  Data lama & baru yang nilai kolom ini sama akan di-match. Data yang sudah ada akan di-update, yang baru akan ditambahkan.
                </div>
              </div>

              {keyCol && activeDataset.photoCount > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="text-[10px] text-emerald-700">
                    <b>Foto aman!</b> Data yang di-update akan mempertahankan ID, jadi foto yang sudah diupload tetap terhubung.
                  </div>
                </div>
              )}
            </div>
          )}

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
                  const isKey = mode === 'update' && h === keyCol
                  return (
                    <span key={h} className={`px-2 py-0.5 rounded text-[10px] border ${isKey ? 'bg-blue-100 text-blue-700 border-blue-300 font-bold' : isCoord ? 'bg-emerald-100 text-emerald-700 border-emerald-300 font-semibold' : 'bg-white text-slate-600 border-slate-200'}`}>
                      {isCoord && <Crosshair className="w-2.5 h-2.5 inline mr-1" />}
                      {isKey && <span className="mr-1">🔑</span>}
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
                <span className="text-slate-600">{mode === 'update' ? 'Mengupdate...' : 'Mengupload...'}</span>
                <span className={`font-semibold ${mode === 'update' ? 'text-blue-600' : 'text-emerald-600'}`}>{progress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2.5">
                <div className={`h-2.5 rounded-full transition-all ${mode === 'update' ? 'bg-blue-600' : 'bg-emerald-600'}`} style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Upload button */}
          <button
            className={`w-full py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 ${mode === 'update' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            disabled={!file || uploading || (mode === 'replace' && !confirmReplace) || (mode === 'update' && (!keyCol || loadingActive))}
            onClick={handleUpload}
          >
            {uploading ? (
              <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</span>
            ) : mode === 'update' ? (
              <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Update Data</span>
            ) : (
              <span className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload Data</span>
            )}
          </button>

          {/* Result */}
          {result && (
            <div className={`${result.mode === 'update' ? 'bg-blue-50 border-blue-200' : 'bg-emerald-50 border-emerald-200'} rounded-lg p-3 border`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`text-xs font-bold ${result.mode === 'update' ? 'text-blue-700' : 'text-emerald-700'}`}>
                  {result.mode === 'update' ? 'Hasil Update' : 'Hasil Upload'}
                </div>
                <span className="text-[10px] text-slate-400">Auto-tutup 3 detik...</span>
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-slate-500">Dataset</span><span className="font-semibold">{result.datasetName}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Total baris</span><span className="font-semibold">{result.totalRows?.toLocaleString()}</span></div>
                {result.mode === 'update' ? (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500">Di-update</span><span className="font-semibold text-blue-600">{result.updated?.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Ditambahkan baru</span><span className="font-semibold text-emerald-600">{result.inserted?.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Tidak ada di file baru</span><span className="font-semibold text-amber-600">{result.removed?.toLocaleString()}</span></div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500">Berhasil</span><span className="font-semibold text-emerald-600">{result.imported?.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Dilewati</span><span className="font-semibold">{result.skipped?.toLocaleString()}</span></div>
                  </>
                )}
              </div>
              <button
                onClick={handleClose}
                className={`w-full mt-3 py-2 text-white rounded-lg text-xs font-semibold transition-colors ${result.mode === 'update' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
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
              <li><b>Update Aktif:</b> Update data di tempat, foto tetap terhubung</li>
              <li>Semua header Excel jadi opsi filter otomatis</li>
              <li>Upload chunked (aman untuk file besar di Vercel)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
