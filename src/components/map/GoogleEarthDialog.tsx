'use client'

import { useState, useEffect, useMemo } from 'react'
import { Globe, Download, X, Filter, MapPin, Check, Layers, Folder, Plus, Tag, Pentagon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import type { CustomFilterSlot, MarkerConfig } from '@/app/page'

interface ActiveFilters {
  search: string
  hasCoord: string
  customFilters: CustomFilterSlot[]
}

export default function GoogleEarthDialog({
  open, onOpenChange, filters, markerConfig, filteredCount, totalCount, datasetName, columns,
  selectedAreaIds,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  filters: ActiveFilters
  markerConfig: MarkerConfig
  filteredCount: number
  totalCount: number
  datasetName: string
  columns: string[]
  selectedAreaIds?: Set<string> | null
}) {
  const [refreshMin, setRefreshMin] = useState('5')
  const [hostInput, setHostInput] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [exportMode, setExportMode] = useState<'area' | 'filtered' | 'all'>('filtered')
  const [selectedLabelCols, setSelectedLabelCols] = useState<string[]>([])

  // Auto-select area mode if there's an active area selection
  useEffect(() => {
    if (open && selectedAreaIds && selectedAreaIds.size > 0) {
      setExportMode('area')
    }
  }, [open, selectedAreaIds])

  useEffect(() => {
    if (open && columns.length > 0) {
      setSelectedLabelCols(prev => {
        const valid = prev.filter(c => columns.includes(c))
        if (valid.length > 0) return valid
        return [markerConfig.nameCol1, markerConfig.nameCol2].filter(Boolean) as string[]
      })
    }
  }, [open, columns, markerConfig.nameCol1, markerConfig.nameCol2])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  const toggleLabelCol = (col: string) => {
    setSelectedLabelCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    )
  }

  const activeFilterLabels = useMemo(() => {
    const labels: { key: string; value: string }[] = []
    if (filters.search) labels.push({ key: 'Search', value: `"${filters.search}"` })
    if (filters.hasCoord === 'true') labels.push({ key: 'Koordinat', value: 'Ada koordinat' })
    else if (filters.hasCoord === 'false') labels.push({ key: 'Koordinat', value: 'Tanpa koordinat' })
    for (const cf of filters.customFilters) {
      if (cf.field && cf.values.length > 0) {
        labels.push({ key: cf.field, value: cf.values.join(', ') })
      }
    }
    return labels
  }, [filters])

  const hasActiveFilters = activeFilterLabels.length > 0
  const hasAreaSelection = selectedAreaIds && selectedAreaIds.size > 0

  const getFilterParams = () => {
    const params = new URLSearchParams()
    if (selectedLabelCols.length > 0) params.set('labelCols', selectedLabelCols.join(','))
    if (markerConfig.nameCol1) params.set('nameCol1', markerConfig.nameCol1)
    if (markerConfig.nameCol2) params.set('nameCol2', markerConfig.nameCol2)
    if (markerConfig.capacityCol) params.set('capacityCol', markerConfig.capacityCol)
    if (markerConfig.activeCol) params.set('activeCol', markerConfig.activeCol)
    if (markerConfig.availCol) params.set('availCol', markerConfig.availCol)

    // ── AREA SELECTION: kirim IDs ke API ──
    if (exportMode === 'area' && hasAreaSelection) {
      params.set('ids', Array.from(selectedAreaIds).join(','))
      return params
    }

    if (exportMode === 'all') return params
    if (filters.search) params.set('search', filters.search)
    if (filters.hasCoord) params.set('hasCoord', filters.hasCoord)
    filters.customFilters.forEach((cf, i) => {
      if (cf.field && cf.values.length > 0) {
        params.set(`cf${i}`, cf.field)
        params.set(`cv${i}`, cf.values.join(','))
      }
    })
    const activeGroupFields = filters.customFilters.filter(cf => cf.field && cf.values.length > 0).map(cf => cf.field)
    if (activeGroupFields.length > 0) params.set('groupBy', activeGroupFields.join(','))
    return params
  }

  const buildNetworkLinkUrl = () => {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const h = hostInput.trim() || new URL(base).host
    const filterParams = getFilterParams()
    filterParams.set('host', h)
    filterParams.set('protocol', new URL(base).protocol.replace(':', ''))
    filterParams.set('refresh', refreshMin)
    return `/api/kml/network-link?${filterParams.toString()}`
  }

  const buildDirectKmlUrl = () => {
    const filterParams = getFilterParams()
    const q = filterParams.toString()
    return q ? `/api/kml?${q}` : '/api/kml'
  }

  const downloadBlob = async (url: string, filename: string, label: string) => {
    if (downloading) return
    setDownloading(label)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      toast.success(`File ${filename} berhasil didownload!`)
    } catch (err) {
      console.error('Download error:', err)
      toast.error('Gagal download. Coba lagi.')
    } finally {
      setDownloading(null)
    }
  }

  const downloadNetworkLink = () => downloadBlob(buildNetworkLinkUrl(), 'data-realtime.kml', 'networklink')
  const downloadDirectKml = () => {
    const suffix = exportMode === 'area' ? '-area' : ''
    downloadBlob(buildDirectKmlUrl(), `data-export${suffix}.kml`, 'direct')
  }

  const copyKmlUrl = () => {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const h = hostInput.trim() || new URL(base).host
    const filterParams = getFilterParams()
    const filterStr = filterParams.toString() ? '?' + filterParams.toString() : ''
    const url = `${new URL(base).protocol}//${h}/api/kml${filterStr}`
    navigator.clipboard.writeText(url)
    toast.success('URL KML berhasil disalin!')
  }

  const fullKmlUrl = typeof window !== 'undefined'
    ? buildDirectKmlUrl().replace('/api/kml', `${window.location.origin}/api/kml`)
    : '/api/kml'

  const displayCount = exportMode === 'area' && hasAreaSelection
    ? selectedAreaIds.size
    : exportMode === 'filtered'
      ? filteredCount
      : totalCount

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ zIndex: 10000 }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-blue-100 flex items-center justify-center">
              <Globe className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Export ke Google Earth</h2>
              <p className="text-[11px] text-slate-400">KML/KMZ dengan filter, area, atau semua data</p>
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Label Column Selector */}
          {columns.length > 0 && (
            <div className="bg-violet-50 rounded-lg p-3 border border-violet-100">
              <div className="flex items-center gap-2 mb-2">
                <Tag className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-xs font-semibold text-violet-700">Kolom Label</span>
                <span className="text-[10px] text-violet-400">— nama di Google Earth</span>
              </div>
              <p className="text-[10px] text-violet-500 mb-2">Klik kolom untuk pilih sebagai label. Urutan = urutan tampil.</p>
              {selectedLabelCols.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedLabelCols.map((col, idx) => (
                    <button
                      key={col}
                      onClick={() => toggleLabelCol(col)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-200 text-violet-800 text-[11px] font-semibold border border-violet-300 hover:bg-violet-300 transition-colors"
                    >
                      <span className="text-violet-400 text-[9px]">{idx + 1}</span>
                      {col}
                      <X className="w-3 h-3 text-violet-500" />
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                {columns.filter(c => !selectedLabelCols.includes(c)).map(col => (
                  <button
                    key={col}
                    onClick={() => toggleLabelCol(col)}
                    className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-white text-slate-600 text-[10px] border border-slate-200 hover:border-violet-300 hover:text-violet-700 transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    {col}
                  </button>
                ))}
              </div>
              {selectedLabelCols.length > 0 && (
                <div className="mt-2 text-[10px] text-violet-500">
                  Preview label: <b className="text-violet-700">{selectedLabelCols.join(' - ')}</b>
                </div>
              )}
            </div>
          )}

          {/* Export Mode — 3 pilihan: Area / Filtered / All */}
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs font-semibold text-slate-700">Data yang di-export</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {/* Area Selection */}
              <button
                onClick={() => setExportMode('area')}
                className={`relative flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all text-center ${
                  exportMode === 'area'
                    ? 'border-violet-500 bg-violet-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${!hasAreaSelection ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                disabled={!hasAreaSelection}
              >
                {exportMode === 'area' && hasAreaSelection && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
                <Pentagon className={`w-4 h-4 ${exportMode === 'area' ? 'text-violet-600' : 'text-slate-400'}`} />
                <span className={`text-[11px] font-semibold ${exportMode === 'area' ? 'text-violet-700' : 'text-slate-600'}`}>Area</span>
                <span className="text-lg font-bold text-violet-600">{hasAreaSelection ? selectedAreaIds.size.toLocaleString('id-ID') : '0'}</span>
                <span className="text-[10px] text-slate-400">Polygon</span>
              </button>

              {/* Filtered Only */}
              <button
                onClick={() => setExportMode('filtered')}
                className={`relative flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all text-center ${
                  exportMode === 'filtered'
                    ? 'border-blue-500 bg-blue-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${!hasActiveFilters ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                disabled={!hasActiveFilters}
              >
                {exportMode === 'filtered' && hasActiveFilters && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
                <Filter className={`w-4 h-4 ${exportMode === 'filtered' ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className={`text-[11px] font-semibold ${exportMode === 'filtered' ? 'text-blue-700' : 'text-slate-600'}`}>Filtered</span>
                <span className="text-lg font-bold text-blue-600">{filteredCount.toLocaleString('id-ID')}</span>
                <span className="text-[10px] text-slate-400">Terfilter</span>
              </button>

              {/* All Data */}
              <button
                onClick={() => setExportMode('all')}
                className={`relative flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all text-center ${
                  exportMode === 'all'
                    ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } cursor-pointer`}
              >
                {exportMode === 'all' && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
                <MapPin className={`w-4 h-4 ${exportMode === 'all' ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span className={`text-[11px] font-semibold ${exportMode === 'all' ? 'text-emerald-700' : 'text-slate-600'}`}>Semua</span>
                <span className="text-lg font-bold text-emerald-600">{totalCount.toLocaleString('id-ID')}</span>
                <span className="text-[10px] text-slate-400">Seluruh titik</span>
              </button>
            </div>

            {/* Info messages */}
            {exportMode === 'area' && !hasAreaSelection && (
              <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-amber-500" />
                Tidak ada area terpilih. Gambar polygon di peta terlebih dahulu.
              </p>
            )}
            {exportMode === 'filtered' && !hasActiveFilters && (
              <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-amber-500" />
                Tidak ada filter aktif. Pilih &quot;Semua Data&quot; atau terapkan filter terlebih dahulu.
              </p>
            )}
          </div>

          {/* Area Selection Info */}
          {exportMode === 'area' && hasAreaSelection && (
            <div className="bg-violet-50/60 rounded-lg p-3 border border-violet-100">
              <div className="flex items-center gap-1.5 mb-1">
                <Pentagon className="w-3 h-3 text-violet-500" />
                <span className="text-[11px] font-semibold text-violet-700">Area Selection</span>
              </div>
              <p className="text-[10px] text-violet-600">
                <b>{selectedAreaIds.size.toLocaleString('id-ID')}</b> titik di dalam polygon akan di-export ke KML.
              </p>
            </div>
          )}

          {/* Active Filters */}
          {hasActiveFilters && exportMode === 'filtered' && (
            <div className="bg-blue-50/60 rounded-lg p-3 border border-blue-100">
              <div className="flex items-center gap-1.5 mb-2">
                <Filter className="w-3 h-3 text-blue-500" />
                <span className="text-[11px] font-semibold text-blue-700">Filter aktif ({activeFilterLabels.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeFilterLabels.map((f) => (
                  <span key={f.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-[10px] text-blue-700 font-medium">
                    <span className="text-blue-400">{f.key}:</span> {f.value}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
            <MapPin className="w-3 h-3" />
            <span><b className="text-slate-700">{displayCount.toLocaleString('id-ID')}</b> titik akan di-export</span>
          </div>

          {/* Refresh interval */}
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Interval Auto-Refresh</label>
            <select
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md bg-white"
              value={refreshMin}
              onChange={(e) => setRefreshMin(e.target.value)}
            >
              <option value="1">Setiap 1 menit</option>
              <option value="5">Setiap 5 menit</option>
              <option value="15">Setiap 15 menit</option>
              <option value="30">Setiap 30 menit</option>
              <option value="60">Setiap 1 jam</option>
              <option value="240">Setiap 4 jam</option>
              <option value="480">Setiap 8 jam</option>
              <option value="960">Setiap 16 jam</option>
              <option value="1440">Setiap 24 jam</option>
            </select>
          </div>

          {/* Host input */}
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">
              Host Server (opsional)
              <span className="text-slate-400 font-normal"> — isi jika Google Earth di komputer lain</span>
            </label>
            <Input
              placeholder={typeof window !== 'undefined' ? window.location.host : 'localhost:3000'}
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Option 1: NetworkLink */}
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-bold text-blue-800">Cara 1: NetworkLink (Rekomendasi)</div>
              <span className="text-[10px] bg-blue-200/60 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Auto-refresh</span>
            </div>
            <p className="text-[11px] text-blue-600 mb-2.5 leading-relaxed">
              Download file KML, buka di Google Earth. Data otomatis refresh sesuai interval.
              {exportMode === 'area' && ' Hanya data di dalam polygon.'}
              {exportMode === 'filtered' && hasActiveFilters && ' Hanya data yang sesuai filter.'}
            </p>
            <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700" onClick={downloadNetworkLink} disabled={downloading === 'networklink'}>
              {downloading === 'networklink' ? (
                <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Mengunduh...</span>
              ) : (
                <><Download className="w-3.5 h-3.5 mr-2" />Download NetworkLink KML</>
              )}
            </Button>
          </div>

          {/* Option 2: Direct KML */}
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-bold text-slate-700">Cara 2: KML Langsung (Sekali)</div>
              <span className="text-[10px] bg-slate-200/60 text-slate-600 px-1.5 py-0.5 rounded-full font-medium">Snapshot</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2.5 leading-relaxed">
              Download snapshot data saat ini. Tidak auto-refresh.
              {exportMode === 'area' && ' Hanya data di dalam polygon.'}
              {exportMode === 'filtered' && hasActiveFilters && ' Hanya data yang sesuai filter.'}
            </p>
            <Button size="sm" variant="outline" className="w-full" onClick={downloadDirectKml} disabled={downloading === 'direct'}>
              {downloading === 'direct' ? (
                <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />Mengunduh...</span>
              ) : (
                <><Download className="w-3.5 h-3.5 mr-2" />Download KML Langsung</>
              )}
            </Button>
          </div>

          {/* Option 3: Copy URL */}
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-bold text-slate-700">Cara 3: Copy URL</div>
              <span className="text-[10px] bg-slate-200/60 text-slate-600 px-1.5 py-0.5 rounded-full font-medium">Manual</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2.5 leading-relaxed">
              Di Google Earth: Add &rarr; Network Link &rarr; paste URL ini.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={fullKmlUrl}
                className="h-8 text-[11px] font-mono flex-1"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button size="sm" variant="outline" className="shrink-0 h-8 px-3" onClick={copyKmlUrl}>
                Salin
              </Button>
            </div>
          </div>

          {/* Steps */}
          <div className="text-[11px] text-slate-500 space-y-1.5 pt-1">
            <div className="font-semibold text-slate-700 text-xs">Cara pakai:</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Pilih kolom label (opsional) — tentukan nama yang tampil di Google Earth</li>
              <li>Pilih mode export: <b>Area</b>, <b>Filtered</b>, atau <b>Semua Data</b></li>
              <li>Download file NetworkLink KML (Cara 1) atau KML Langsung (Cara 2)</li>
              <li>Buka file tersebut dengan Google Earth Pro</li>
              <li>Data akan muncul di peta Google Earth</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
