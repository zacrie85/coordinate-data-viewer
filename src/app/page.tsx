'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Menu, MapPin, X, PanelRightClose, Upload, Globe, FileDown, Pentagon, Table2, Download, Camera } from 'lucide-react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'

const ODPMap = dynamic(() => import('@/components/map/ODPMap'), { ssr: false })
const UploadExcelDialog = dynamic(() => import('@/components/map/UploadExcelDialog'), { ssr: false })
const FilterSidebar = dynamic(() => import('@/components/map/FilterSidebar'), { ssr: false })
const ODPDetailPanel = dynamic(() => import('@/components/map/ODPDetailPanel'), { ssr: false })
const GoogleEarthDialog = dynamic(() => import('@/components/map/GoogleEarthDialog'), { ssr: false })
const BulkPhotoDialog = dynamic(() => import('@/components/map/BulkPhotoDialog'), { ssr: false })

interface DataPoint {
  id: string; latitude: number; longitude: number; metadata: Record<string, any>; createdAt: string
}

interface ColumnInfo {
  columns: string[]; datasetName: string; latCol: string | null; lngCol: string | null; coordCol: string | null; datasetId: string
}

interface StatsData { total: number; withCoord: number; withoutCoord: number; datasetName: string; rowCount: number }

export interface CustomFilterSlot { field: string; values: string[] }

export interface MarkerConfig {
  nameCol1: string
  nameCol2: string
  capacityCol: string
  activeCol: string
  availCol: string
  labelCol: string
}

const DEFAULT_MC: MarkerConfig = { nameCol1: '', nameCol2: '', capacityCol: '', activeCol: '', availCol: '', labelCol: '' }

// ── AUTO-DETECT: scan kolom Excel dan cocokkan berdasarkan pola nama ──

const CAPACITY_PATTERNS = /capac|kapas|avail|ketersedia|usage|pemakaian|used|terpakai|utilized|penggunaan|penuh|fill|occup|terisi/i
const ACTIVE_PATTERNS = /^active$|^status$|^enable$|^state$|^aktif$|^kondisi$|^condition$/i
const NAME1_PATTERNS = /^name$|^nama$|^odp$|^label$|^description$|^deskripsi$|^alamat$|^address$|^location$|^lokasi$/i
const NAME2_PATTERNS = /^kode$|^code$|^id$|^no$|^number$|^nomor$|^sn$|^serial$/i

function autoDetectConfig(cols: string[]): MarkerConfig {
  const mc: MarkerConfig = { ...DEFAULT_MC }
  const lower = cols.map(c => c.toLowerCase().trim())

  for (let i = 0; i < cols.length; i++) {
    if (CAPACITY_PATTERNS.test(lower[i])) { mc.capacityCol = cols[i]; break }
  }

  for (let i = 0; i < cols.length; i++) {
    if (ACTIVE_PATTERNS.test(lower[i])) { mc.activeCol = cols[i]; break }
  }

  for (let i = 0; i < cols.length; i++) {
    if (/^avail|^ketersedia|^available/i.test(lower[i]) && cols[i] !== mc.capacityCol) {
      mc.availCol = cols[i]; break
    }
  }

  if (!mc.availCol && mc.capacityCol) mc.availCol = mc.capacityCol
  if (!mc.availCol && mc.activeCol) mc.availCol = mc.activeCol

  const usedCols = new Set([mc.capacityCol, mc.activeCol, mc.availCol])
  for (let i = 0; i < cols.length; i++) {
    if (!usedCols.has(cols[i]) && NAME1_PATTERNS.test(lower[i])) { mc.nameCol1 = cols[i]; break }
  }
  for (let i = 0; i < cols.length; i++) {
    if (!usedCols.has(cols[i]) && cols[i] !== mc.nameCol1 && NAME2_PATTERNS.test(lower[i])) { mc.nameCol2 = cols[i]; break }
  }

  // labelCol default = nameCol2 (Code column)
  mc.labelCol = mc.nameCol2 || mc.nameCol1 || ''

  return mc
}

export default function Home() {
  const [points, setPoints] = useState<DataPoint[]>([])
  const [stats, setStats] = useState<StatsData | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [datasetName, setDatasetName] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [coordInfo, setCoordInfo] = useState({ latCol: null as string | null, lngCol: null as string | null, coordCol: null as string | null })
  const [loading, setLoading] = useState(true)
  const [selectedPoint, setSelectedPoint] = useState<DataPoint | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [googleEarthOpen, setGoogleEarthOpen] = useState(false)
  const [bulkPhotoOpen, setBulkPhotoOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [hasCoord, setHasCoord] = useState('')
  const [customFilters, setCustomFilters] = useState<CustomFilterSlot[]>([
    { field: '', values: [] }, { field: '', values: [] }, { field: '', values: [] },
  ])
  const [markerConfig, setMarkerConfig] = useState<MarkerConfig>(DEFAULT_MC)
  const autoDetectedRef = useRef(false)

  // Area selection state
  const [drawMode, setDrawMode] = useState(false)
  const [selectedAreaIds, setSelectedAreaIds] = useState<Set<string> | null>(null)

  // Drag Zoom state
  const [dragZoom, setDragZoom] = useState(false)

  // ★ OPTIMASI: debounce timer untuk filter changes
  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadColumns = useCallback(() => {
    fetch('/api/data/columns').then(r => r.json()).then((d: ColumnInfo) => {
      const cols = d.columns || []
      setColumns(cols)
      setDatasetName(d.datasetName || '')
      setDatasetId(d.datasetId || '')
      setCoordInfo({ latCol: d.latCol, lngCol: d.lngCol, coordCol: d.coordCol })

      if (cols.length > 0) {
        const detected = autoDetectConfig(cols)
        setMarkerConfig(detected)
        autoDetectedRef.current = true
      }
    }).catch(() => {})
  }, [])

  const loadStats = useCallback(() => {
    fetch('/api/data/stats').then(r => r.json()).then((d: StatsData) => setStats(d)).catch(() => {})
  }, [])

  const loadData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('limit', '25000')
    if (searchQuery) params.set('search', searchQuery)
    if (hasCoord) params.set('hasCoord', hasCoord)
    customFilters.forEach((cf, i) => {
      if (cf.field && cf.values.length > 0) {
        params.set(`cf${i}`, cf.field)
        params.set(`cv${i}`, cf.values.join(','))
      }
    })
    fetch(`/api/data?${params}`).then(r => r.json()).then(d => {
      setPoints(d.data || [])
      setLoading(false)
    }).catch(() => { setLoading(false); toast.error('Gagal memuat data') })
  }, [searchQuery, hasCoord, customFilters])

  const refreshAll = useCallback(() => { loadStats(); loadColumns(); loadData() }, [loadStats, loadColumns, loadData])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadColumns() }, [loadColumns])
  useEffect(() => { loadData() }, [loadData])

  // ★ OPTIMASI: debounce filter changes 300ms sebelum trigger API
  const handleFiltersChange = useCallback((f: { search: string; hasCoord: string; customFilters: CustomFilterSlot[] }) => {
    setSelectedPoint(null)
    setSelectedAreaIds(null)
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current)
    filterTimerRef.current = setTimeout(() => {
      setSearchQuery(f.search)
      setHasCoord(f.hasCoord)
      setCustomFilters(f.customFilters)
    }, 300)
  }, [])

  const filteredWithCoord = points.filter(p => p.latitude !== 0 && p.longitude !== 0).length

  // Build filter params for export
  const getExportParams = useCallback(() => {
    const params = new URLSearchParams()
    if (searchQuery) params.set('search', searchQuery)
    if (hasCoord) params.set('hasCoord', hasCoord)
    customFilters.forEach((cf, i) => {
      if (cf.field && cf.values.length > 0) {
        params.set(`cf${i}`, cf.field)
        params.set(`cv${i}`, cf.values.join(','))
      }
    })
    return params
  }, [searchQuery, hasCoord, customFilters])

  const handleExportCsv = useCallback(() => {
    const params = getExportParams()
    params.set('limit', '50000')
    params.set('format', 'csv')
    const url = `/api/data/export?${params}`
    const a = document.createElement('a')
    a.href = url
    a.download = `${datasetName.replace(/[^a-zA-Z0-9]/g, '_') || 'data'}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success('Export CSV dimulai!')
  }, [getExportParams, datasetName])

  const handleExportExcel = useCallback(() => {
    const params = getExportParams()
    params.set('limit', '50000')
    params.set('format', 'xlsx')
    const url = `/api/data/export?${params}`
    const a = document.createElement('a')
    a.href = url
    a.download = `${datasetName.replace(/[^a-zA-Z0-9]/g, '_') || 'data'}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success('Export Excel dimulai!')
  }, [getExportParams, datasetName])

  const buildAreaData = useCallback((format: 'csv' | 'xlsx') => {
    if (!selectedAreaIds || selectedAreaIds.size === 0) return null
    const areaPoints = points.filter(p => selectedAreaIds.has(p.id))
    if (areaPoints.length === 0) return null

    const allCols = columns.length > 0 ? columns : Object.keys(areaPoints[0]?.metadata || {})
    const colNames = [...allCols, 'Latitude', 'Longitude']
    const flatRows: any[] = []
    for (const p of areaPoints) {
      const meta = p.metadata || {}
      const row: any = {}
      for (const col of allCols) row[col] = meta[col] ?? ''
      row['Latitude'] = p.latitude
      row['Longitude'] = p.longitude
      flatRows.push(row)
    }
    return { colNames, flatRows, count: areaPoints.length }
  }, [selectedAreaIds, points, columns])

  const handleExportCsvArea = useCallback(() => {
    const data = buildAreaData('csv')
    if (!data) { toast.error('Tidak ada data di area terpilih'); return }
    const rows: string[][] = [data.colNames]
    for (const r of data.flatRows) {
      const row = data.colNames.map(col => {
        const val = String(r[col] ?? '')
        if (val.includes(',') || val.includes('"') || val.includes('\n')) return `"${val.replace(/"/g, '""')}"`
        return val
      })
      rows.push(row)
    }
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `${datasetName.replace(/[^a-zA-Z0-9]/g, '_') || 'area'}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
    toast.success(`${data.count} titik di area di-export ke CSV!`)
  }, [buildAreaData, datasetName])

  const handleExportExcelArea = useCallback(() => {
    const data = buildAreaData('xlsx')
    if (!data) { toast.error('Tidak ada data di area terpilih'); return }
    // Dynamic import xlsx for client-side generation
    import('xlsx').then(XLSX => {
      const ws = XLSX.utils.json_to_sheet(data.flatRows, { header: data.colNames })
      const colWidths = data.colNames.map(name => {
        let maxLen = name.length
        for (const row of data.flatRows) {
          const val = String(row[name] ?? '')
          if (val.length > maxLen) maxLen = val.length
        }
        return { wch: Math.min(maxLen + 2, 50) }
      })
      ws['!cols'] = colWidths
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Area Data')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${datasetName.replace(/[^a-zA-Z0-9]/g, '_') || 'area'}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`${data.count} titik di area di-export ke Excel!`)
    }).catch(() => toast.error('Gagal export Excel'))
  }, [buildAreaData, datasetName])

  // Area selection callbacks
  const handleAreaSelected = useCallback((ids: Set<string>) => {
    setSelectedAreaIds(ids)
    if (ids.size > 0) {
      toast.success(`${ids.size.toLocaleString()} titik dipilih dalam area`)
    }
  }, [])

  const handleClearArea = useCallback(() => {
    setSelectedAreaIds(null)
    setDrawMode(false)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-slate-100 overflow-hidden">
      {/* Mobile header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 z-50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center"><MapPin className="w-4 h-4 text-emerald-600" /></div>
          <div><h1 className="text-sm font-bold text-slate-800">Map Viewer</h1><p className="text-[10px] text-slate-400">{datasetName || 'Upload Excel untuk mulai'}</p></div>
        </div>
        <div className="flex items-center gap-1">
          {stats && stats.total > 0 && (
            <>
              <button className="h-8 px-2 flex items-center gap-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600" onClick={handleExportCsv}>
                <FileDown className="w-4 h-4" /><span className="text-xs font-medium">CSV</span>
              </button>
              <button className="h-8 px-2 flex items-center gap-1.5 rounded-lg hover:bg-green-50 text-green-600" onClick={handleExportExcel}>
                <Table2 className="w-4 h-4" /><span className="text-xs font-medium">Excel</span>
              </button>
              <button className="h-8 px-2 flex items-center gap-1.5 rounded-lg hover:bg-violet-50 text-violet-600" onClick={() => setDrawMode(!drawMode)}>
                <Pentagon className="w-4 h-4" /><span className="text-xs font-medium">Area</span>
              </button>
              <button className="h-8 px-2 flex items-center gap-1.5 rounded-lg hover:bg-blue-50 text-blue-600" onClick={() => setGoogleEarthOpen(true)}>
                <Globe className="w-4 h-4" /><span className="text-xs font-medium">KML</span>
              </button>
            </>
          )}
          <button className="h-8 w-8 flex items-center justify-center rounded hover:bg-slate-100" onClick={() => setMobileSidebar(!mobileSidebar)}><Menu className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {mobileSidebar && (
          <div className="lg:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/30" onClick={() => setMobileSidebar(false)} />
            <div className="relative z-50 w-80 h-full">
              <FilterSidebar stats={stats} columns={columns} datasetName={datasetName} coordInfo={coordInfo} totalResults={points.length} searchQuery={searchQuery} hasCoord={hasCoord} customFilters={customFilters} markerConfig={markerConfig} onMarkerConfigChange={setMarkerConfig} onFiltersChange={(f) => { handleFiltersChange(f); setMobileSidebar(false) }} onUploadClick={() => { setUploadDialogOpen(true); setMobileSidebar(false) }} onDatasetSwitch={refreshAll} onExportCsv={handleExportCsv} onExportExcel={handleExportExcel} onClose={() => setMobileSidebar(false)} />
            </div>
          </div>
        )}

        {sidebarOpen && (
          <div className="hidden lg:block shrink-0">
            <FilterSidebar stats={stats} columns={columns} datasetName={datasetName} coordInfo={coordInfo} totalResults={points.length} searchQuery={searchQuery} hasCoord={hasCoord} customFilters={customFilters} markerConfig={markerConfig} onMarkerConfigChange={setMarkerConfig} onFiltersChange={handleFiltersChange} onUploadClick={() => setUploadDialogOpen(true)} onDatasetSwitch={refreshAll} onExportCsv={handleExportCsv} onExportExcel={handleExportExcel} />
          </div>
        )}

        <div className="flex-1 relative min-h-0 min-w-0">
          {!sidebarOpen && (
            <button className="absolute top-4 left-4 z-[1000] h-9 w-9 bg-white rounded-lg shadow-lg flex items-center justify-center hover:bg-slate-50" onClick={() => setSidebarOpen(true)}><Menu className="w-4 h-4" /></button>
          )}
          {sidebarOpen && (
            <button className="hidden lg:flex absolute top-4 left-[21rem] z-[1000] h-9 w-9 bg-white rounded-lg shadow-lg items-center justify-center hover:bg-slate-50" onClick={() => setSidebarOpen(false)}><PanelRightClose className="w-4 h-4" /></button>
          )}

          {/* Top-right action buttons */}
          {stats && stats.total > 0 && (
            <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2">
              {/* Drag Zoom */}
              <button
                className={`h-9 px-3 rounded-lg shadow-lg flex items-center gap-2 font-medium text-xs transition-colors ${dragZoom ? 'bg-violet-500 text-white hover:bg-violet-600' : 'bg-white text-violet-600 hover:bg-violet-50'}`}
                onClick={() => setDragZoom(!dragZoom)}
                title={dragZoom ? 'Keluar Drag Zoom (Esc)' : 'Drag Zoom'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  <rect x="7" y="7" width="8" height="8" rx="1" stroke-dasharray="3 2"/>
                </svg>
                <span className="hidden sm:inline">{dragZoom ? 'Zooming...' : 'Drag Zoom'}</span>
              </button>
              <button className="h-9 px-3 bg-white rounded-lg shadow-lg flex items-center gap-2 hover:bg-emerald-50 text-emerald-600 font-medium text-xs transition-colors" onClick={handleExportCsv}>
                <FileDown className="w-4 h-4" /><span className="hidden sm:inline">CSV</span>
              </button>
              <button className="h-9 px-3 bg-white rounded-lg shadow-lg flex items-center gap-2 hover:bg-green-50 text-green-700 font-medium text-xs transition-colors" onClick={handleExportExcel}>
                <Table2 className="w-4 h-4" /><span className="hidden sm:inline">Excel</span>
              </button>
              <button
                className={`h-9 px-3 rounded-lg shadow-lg flex items-center gap-2 font-medium text-xs transition-colors ${drawMode ? 'bg-violet-500 text-white hover:bg-violet-600' : 'bg-white text-violet-600 hover:bg-violet-50'}`}
                onClick={() => { setDrawMode(!drawMode); if (selectedAreaIds) setSelectedAreaIds(null) }}
              >
                <Pentagon className="w-4 h-4" /><span className="hidden sm:inline">{drawMode ? 'Gambar Area...' : 'Pilih Area'}</span>
              </button>
              <button className="h-9 px-3 bg-white rounded-lg shadow-lg flex items-center gap-2 hover:bg-blue-50 text-blue-600 font-medium text-xs transition-colors" onClick={() => setGoogleEarthOpen(true)}>
                <Globe className="w-4 h-4" /><span className="hidden sm:inline">Google Earth</span>
              </button>
              <button className="h-9 px-3 bg-white rounded-lg shadow-lg flex items-center gap-2 hover:bg-amber-50 text-amber-600 font-medium text-xs transition-colors" onClick={() => setBulkPhotoOpen(true)}>
                <Camera className="w-4 h-4" /><span className="hidden sm:inline">Foto ODP</span>
              </button>
            </div>
          )}

          {/* Area selection info bar */}
          {selectedAreaIds && selectedAreaIds.size > 0 && (
            <div className="absolute top-16 right-4 z-[1000] flex items-center gap-2">
              <div className="h-9 px-3 bg-violet-500 text-white rounded-lg shadow-lg flex items-center gap-2 text-xs font-semibold">
                <Pentagon className="w-4 h-4" />
                {selectedAreaIds.size.toLocaleString()} titik dipilih
              </div>
              <button className="h-9 px-3 bg-white rounded-lg shadow-lg flex items-center gap-2 hover:bg-emerald-50 text-emerald-600 font-medium text-xs transition-colors" onClick={handleExportCsvArea}>
                <FileDown className="w-4 h-4" /><span className="hidden sm:inline">CSV</span>
              </button>
              <button className="h-9 px-3 bg-white rounded-lg shadow-lg flex items-center gap-2 hover:bg-green-50 text-green-700 font-medium text-xs transition-colors" onClick={handleExportExcelArea}>
                <Table2 className="w-4 h-4" /><span className="hidden sm:inline">Excel</span>
              </button>
              <button className="h-9 px-3 bg-white rounded-lg shadow-lg flex items-center gap-2 hover:bg-blue-50 text-blue-600 font-medium text-xs transition-colors" onClick={() => setGoogleEarthOpen(true)}>
                <Download className="w-4 h-4" /><span className="hidden sm:inline">KML</span>
              </button>
              <button className="h-9 px-3 bg-white rounded-lg shadow-lg flex items-center gap-1 hover:bg-red-50 text-red-500 text-xs font-medium transition-colors" onClick={handleClearArea}>
                <X className="w-3.5 h-3.5" /> Hapus
              </button>
            </div>
          )}

          <ODPMap
            points={points}
            loading={loading}
            selectedPoint={selectedPoint}
            onSelectPoint={setSelectedPoint}
            columns={columns}
            markerConfig={markerConfig}
            drawMode={drawMode}
            onAreaSelected={handleAreaSelected}
            selectedAreaIds={selectedAreaIds}
            dragZoom={dragZoom}
            onDragZoomEnd={() => setDragZoom(false)}
          />

          {selectedPoint && (
            <div className="hidden md:block absolute right-0 top-16 h-[calc(100%-4rem)] z-[999]">
              <ODPDetailPanel point={selectedPoint} columns={columns} markerConfig={markerConfig} onClose={() => setSelectedPoint(null)} />
            </div>
          )}
          {selectedPoint && (
            <div className="md:hidden absolute bottom-0 left-0 right-0 z-[999] max-h-[60vh] overflow-y-auto rounded-t-2xl shadow-2xl bg-white">
              <div className="flex justify-center py-2"><div className="w-10 h-1 rounded-full bg-slate-300" /></div>
              <ODPDetailPanel point={selectedPoint} columns={columns} markerConfig={markerConfig} onClose={() => setSelectedPoint(null)} />
            </div>
          )}

          {!loading && points.length === 0 && !stats?.total && (
            <div className="absolute inset-0 flex items-center justify-center z-[1001]">
              <div className="text-center p-8 bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl max-w-sm">
                <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4"><Upload className="w-8 h-8 text-emerald-600" /></div>
                <h2 className="text-lg font-bold text-slate-800 mb-2">Belum Ada Data</h2>
                <p className="text-sm text-slate-500 mb-4">Upload file Excel yang berisi data koordinat. Format apapun bisa!</p>
                <button className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700" onClick={() => setUploadDialogOpen(true)}>Upload Excel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <UploadExcelDialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen} onUploadComplete={refreshAll} />

      <BulkPhotoDialog
        open={bulkPhotoOpen} onOpenChange={setBulkPhotoOpen}
        columns={columns}
        markerConfig={markerConfig}
        selectedAreaIds={selectedAreaIds}
        areaPoints={selectedAreaIds ? points.filter(p => selectedAreaIds.has(p.id)) : undefined}
      />

      <GoogleEarthDialog
        open={googleEarthOpen} onOpenChange={setGoogleEarthOpen}
        filters={{ search: searchQuery, hasCoord, customFilters }}
        markerConfig={markerConfig}
        filteredCount={filteredWithCoord} totalCount={stats?.withCoord || 0} datasetName={datasetName}
        columns={columns}
        selectedAreaIds={selectedAreaIds}
      />
    </div>
  )
}
