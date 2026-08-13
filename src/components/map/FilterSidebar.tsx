'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Search, X, ChevronDown, ChevronUp, MapPin, Database, Upload,
  Trash2, Crosshair, Filter, ArrowUpFromLine, Layers, Eye, FileDown, Table2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { CustomFilterSlot, MarkerConfig } from '@/app/page'

interface StatsData {
  total: number
  withCoord: number
  withoutCoord: number
  datasetName: string
  rowCount: number
}

interface ColumnInfo {
  columns: string[]
  datasetName: string
  latCol: string | null
  lngCol: string | null
  coordCol: string | null
  datasetId: string
}

interface DatasetItem {
  id: string
  name: string
  headers: string[]
  latCol: string | null
  lngCol: string | null
  coordCol: string | null
  rowCount: number
  isActive: boolean
  createdAt: string
}

interface FilterValues {
  search: string
  hasCoord: string
  customFilters: CustomFilterSlot[]
}

interface FilterSidebarProps {
  stats: StatsData | null
  columns: string[]
  datasetName: string
  coordInfo: { latCol: string | null; lngCol: string | null; coordCol: string | null }
  totalResults: number
  searchQuery: string
  hasCoord: string
  customFilters: CustomFilterSlot[]
  markerConfig: MarkerConfig
  onMarkerConfigChange: (mc: MarkerConfig) => void
  onFiltersChange: (f: FilterValues) => void
  onUploadClick: () => void
  onDatasetSwitch: () => void
  onExportCsv: () => void
  onExportExcel?: () => void
  onClose?: () => void
}

function FilterItem({ value, count, checked, onToggle }: {
  value: string; count: number; checked: boolean; onToggle: () => void
}) {
  return (
    <label className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${checked ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-600'}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600" />
      <span className="truncate flex-1 text-left">{value || '(kosong)'}</span>
      <span className={`text-[11px] shrink-0 tabular-nums ${checked ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>{count.toLocaleString()}</span>
    </label>
  )
}

// Single column filter slot component
function ColumnFilterSlot({
  index,
  slot,
  columns,
  onSlotChange,
}: {
  index: number
  slot: CustomFilterSlot
  columns: string[]
  onSlotChange: (index: number, updated: CustomFilterSlot) => void
}) {
  const [sectionSearch, setSectionSearch] = useState('')
  const [fieldValues, setFieldValues] = useState<{ value: string; count: number }[]>([])
  const [fieldLoading, setFieldLoading] = useState(false)

  // Load field values when slot.field changes
  useEffect(() => {
    if (!slot.field) { setFieldValues([]); return }
    setFieldLoading(true)
    setSectionSearch('')
    fetch(`/api/data/field-values?field=${encodeURIComponent(slot.field)}`)
      .then(r => r.json())
      .then(data => { setFieldValues(Array.isArray(data) ? data : []); setFieldLoading(false) })
      .catch(() => setFieldLoading(false))
  }, [slot.field])

  const toggleValue = (val: string) => {
    const updated = slot.values.includes(val)
      ? slot.values.filter(v => v !== val)
      : [...slot.values, val]
    onSlotChange(index, { ...slot, values: updated })
  }

  const clearSlot = () => {
    setSectionSearch('')
    onSlotChange(index, { field: '', values: [] })
  }

  const filteredValues = useMemo(() => {
    if (!sectionSearch) return fieldValues
    const q = sectionSearch.toLowerCase()
    return fieldValues.filter(v => v.value.toLowerCase().includes(q))
  }, [fieldValues, sectionSearch])

  // Columns available (exclude columns used by other slots)
  const usedCols = new Set<string>()
  columns.forEach(() => {}) // just for reference

  return (
    <div className={`rounded-lg border p-2.5 space-y-2 ${slot.field ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Filter {index + 1}</span>
        {slot.field && (
          <button onClick={clearSlot} className="text-slate-400 hover:text-red-500 transition-colors" title="Reset filter ini">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <select
        className="w-full h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
        value={slot.field}
        onChange={(e) => onSlotChange(index, { field: e.target.value, values: [] })}
      >
        <option value="">-- Pilih Kolom --</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      {slot.field && (
        fieldLoading ? (
          <div className="flex items-center justify-center py-3">
            <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-[11px] text-slate-400">Memuat...</span>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input placeholder="Cari nilai..." className="w-full pl-8 h-7 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white" value={sectionSearch} onChange={(e) => setSectionSearch(e.target.value)} />
            </div>
            <div className="max-h-36 overflow-y-auto space-y-0.5">
              {filteredValues.slice(0, 50).map(v => (
                <FilterItem key={v.value} value={v.value} count={v.count} checked={slot.values.includes(v.value)} onToggle={() => toggleValue(v.value)} />
              ))}
              {filteredValues.length > 50 && <p className="px-3 py-1 text-[10px] text-slate-400 italic">+ {filteredValues.length - 50} lainnya...</p>}
              {filteredValues.length === 0 && !fieldLoading && <p className="px-3 py-2 text-xs text-slate-400">Tidak ada data</p>}
            </div>
            {slot.values.length > 0 && (
              <div className="text-[10px] text-emerald-600 font-medium px-1">
                {slot.values.length} nilai dipilih
              </div>
            )}
          </>
        )
      )}

      {!slot.field && (
        <p className="text-[10px] text-slate-400 px-1">Pilih kolom untuk memfilter</p>
      )}
    </div>
  )
}

export default function FilterSidebar({
  stats, columns, datasetName, coordInfo, totalResults,
  searchQuery, hasCoord, customFilters, markerConfig, onMarkerConfigChange,
  onFiltersChange, onUploadClick, onDatasetSwitch, onExportCsv, onExportExcel, onClose
}: FilterSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    datasets: true, search: true, coordinate: true, filter: true, display: true,
  })
  const [datasets, setDatasets] = useState<DatasetItem[]>([])

  const toggleSection = (s: string) => setExpandedSections(p => ({ ...p, [s]: !p[s] }))

  // Load datasets list
  useEffect(() => {
    fetch('/api/datasets').then(r => r.json()).then(setDatasets).catch(() => {})
  }, [])

  const activeCustomCount = useMemo(() => {
    return customFilters.reduce((acc, cf) => acc + cf.values.length, 0)
  }, [customFilters])

  const totalFilterCount = useMemo(() => {
    let c = 0
    if (searchQuery) c++
    if (hasCoord) c++
    c += activeCustomCount
    return c
  }, [searchQuery, hasCoord, activeCustomCount])

  const handleSlotChange = (index: number, updated: CustomFilterSlot) => {
    const newFilters = [...customFilters]
    newFilters[index] = updated
    onFiltersChange({ search: searchQuery, hasCoord, customFilters: newFilters })
  }

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      hasCoord: '',
      customFilters: [
        { field: '', values: [] },
        { field: '', values: [] },
        { field: '', values: [] },
      ],
    })
  }

  const activateDataset = async (id: string) => {
    await fetch('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId: id }) })
    toast.success('Dataset diaktifkan')
    onDatasetSwitch()
  }

  const deleteDataset = async (id: string) => {
    if (!confirm('Hapus dataset ini beserta semua datanya?')) return
    await fetch(`/api/datasets?id=${id}`, { method: 'DELETE' })
    toast.success('Dataset dihapus')
    onDatasetSwitch()
  }

  return (
    <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800">Map Viewer</h1>
              <p className="text-[10px] text-slate-400">Format-agnostic</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {totalFilterCount > 0 && <span className="h-5 px-1.5 text-[10px] bg-emerald-500 text-white rounded-full font-medium">{totalFilterCount}</span>}
            {onClose && <button className="lg:hidden h-8 w-8 flex items-center justify-center rounded hover:bg-slate-100" onClick={onClose}><X className="w-4 h-4" /></button>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={onUploadClick} className="flex-1 flex items-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors text-left">
            <div className="w-6 h-6 rounded bg-emerald-500 flex items-center justify-center shrink-0"><ArrowUpFromLine className="w-3.5 h-3.5 text-white" /></div>
            <div className="min-w-0"><div className="text-xs font-semibold text-emerald-800">Upload</div><div className="text-[10px] text-emerald-500">Excel</div></div>
          </button>
          <button onClick={onDatasetSwitch} className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors text-left">
            <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center shrink-0"><Layers className="w-3.5 h-3.5 text-white" /></div>
            <div className="min-w-0"><div className="text-xs font-semibold text-blue-800">Dataset</div><div className="text-[10px] text-blue-500">Switch</div></div>
          </button>
          <button onClick={onExportCsv} className="flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors text-left">
            <div className="w-6 h-6 rounded bg-amber-500 flex items-center justify-center shrink-0"><FileDown className="w-3.5 h-3.5 text-white" /></div>
            <div className="min-w-0"><div className="text-xs font-semibold text-amber-800">Export</div><div className="text-[10px] text-amber-500">CSV</div></div>
          </button>
          {onExportExcel && (
            <button onClick={onExportExcel} className="flex items-center gap-2 px-3 py-2 bg-green-50 hover:bg-green-100 rounded-lg transition-colors text-left">
              <div className="w-6 h-6 rounded bg-green-600 flex items-center justify-center shrink-0"><Table2 className="w-3.5 h-3.5 text-white" /></div>
              <div className="min-w-0"><div className="text-xs font-semibold text-green-800">Export</div><div className="text-[10px] text-green-500">Excel</div></div>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Current dataset info */}
        {datasetName && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-800">{datasetName}</span>
            </div>
            {coordInfo && (coordInfo.latCol || coordInfo.coordCol) && (
              <div className="text-[10px] text-emerald-600 flex items-center gap-1 mt-1">
                <Crosshair className="w-3 h-3" />
                {coordInfo.latCol && <span>Lat: {coordInfo.latCol}</span>}
                {coordInfo.lngCol && <span>Lng: {coordInfo.lngCol}</span>}
                {coordInfo.coordCol && <span>Koord: {coordInfo.coordCol}</span>}
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="flex items-center gap-1 mb-1"><Database className="w-3 h-3 text-slate-400" /><span className="text-[10px] text-slate-400 uppercase">Total</span></div>
              <div className="text-sm font-bold text-slate-800">{stats.total.toLocaleString()}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="flex items-center gap-1 mb-1"><Crosshair className="w-3 h-3 text-green-500" /><span className="text-[10px] text-slate-400 uppercase">Coord</span></div>
              <div className="text-sm font-bold text-green-600">{stats.withCoord.toLocaleString()}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2.5">
              <div className="flex items-center gap-1 mb-1"><MapPin className="w-3 h-3 text-slate-400" /><span className="text-[10px] text-slate-400 uppercase">Tampil</span></div>
              <div className="text-sm font-bold text-emerald-600">{totalResults.toLocaleString()}</div>
            </div>
          </div>
        )}

        {/* Datasets list */}
        <div>
          <button className="flex items-center justify-between w-full text-sm font-semibold text-slate-700 mb-2" onClick={() => toggleSection('datasets')}>
            <div className="flex items-center gap-2"><Layers className="w-4 h-4" /> Datasets ({datasets.length})</div>
            {expandedSections.datasets ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandedSections.datasets && (
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {datasets.map(ds => (
                <div key={ds.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${ds.isActive ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-600'}`}>
                  <button onClick={() => !ds.isActive && activateDataset(ds.id)} className="flex-1 text-left truncate font-medium" disabled={ds.isActive}>
                    {ds.isActive && '● '}{ds.name}
                    <span className="text-[10px] ml-1 opacity-60">({ds.rowCount.toLocaleString()})</span>
                  </button>
                  {ds.isActive && <span className="text-[10px] text-emerald-600 font-semibold">AKTIF</span>}
                  <button onClick={() => deleteDataset(ds.id)} className="text-slate-300 hover:text-red-500 shrink-0" title="Hapus">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {datasets.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Belum ada dataset</p>}
            </div>
          )}
        </div>

        <hr className="border-slate-100" />

        {/* Search */}
        <div>
          <button className="flex items-center justify-between w-full text-sm font-semibold text-slate-700 mb-2" onClick={() => toggleSection('search')}>
            <div className="flex items-center gap-2"><Search className="w-4 h-4" /> Pencarian</div>
            {expandedSections.search ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandedSections.search && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                placeholder="Cari di semua kolom..."
                className="w-full pl-9 pr-8 h-9 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                value={searchQuery}
                onChange={(e) => onFiltersChange({ search: e.target.value, hasCoord, customFilters })}
              />
              {searchQuery && (
                <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => onFiltersChange({ search: '', hasCoord, customFilters })}><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          )}
        </div>

        <hr className="border-slate-100" />

        {/* Coordinate filter */}
        <div>
          <button className="flex items-center justify-between w-full text-sm font-semibold text-slate-700 mb-2" onClick={() => toggleSection('coordinate')}>
            <div className="flex items-center gap-2"><Crosshair className="w-4 h-4" /> Koordinat</div>
            {expandedSections.coordinate ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandedSections.coordinate && stats && (
            <div className="space-y-0.5">
              <FilterItem value="Ada Koordinat" count={stats.withCoord} checked={hasCoord === 'true'}
                onToggle={() => onFiltersChange({ search: searchQuery, hasCoord: hasCoord === 'true' ? '' : 'true', customFilters })} />
              <FilterItem value="Tanpa Koordinat" count={stats.withoutCoord} checked={hasCoord === 'false'}
                onToggle={() => onFiltersChange({ search: searchQuery, hasCoord: hasCoord === 'false' ? '' : 'false', customFilters })} />
            </div>
          )}
        </div>

        <hr className="border-slate-100" />

        {/* DYNAMIC COLUMN FILTERS — 3 SLOTS */}
        <div>
          <button className="flex items-center justify-between w-full text-sm font-semibold text-slate-700 mb-2" onClick={() => toggleSection('filter')}>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filter Kolom
              {activeCustomCount > 0 && <span className="h-4 px-1.5 text-[10px] bg-emerald-500 text-white rounded-full">{activeCustomCount}</span>}
            </div>
            {expandedSections.filter ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandedSections.filter && (
            <div>
              {columns.length === 0 ? (
                <p className="text-[11px] text-slate-400 px-1">Upload Excel dulu untuk melihat filter kolom</p>
              ) : (
                <div className="space-y-3">
                  {customFilters.map((slot, i) => (
                    <ColumnFilterSlot
                      key={i}
                      index={i}
                      slot={slot}
                      columns={columns}
                      onSlotChange={handleSlotChange}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

        <hr className="border-slate-100" />

        {/* AUTO-DETECT INFO + OVERRIDE */}
        <div>
          <button className="flex items-center justify-between w-full text-sm font-semibold text-slate-700 mb-2" onClick={() => toggleSection('display')}>
            <div className="flex items-center gap-2"><Eye className="w-4 h-4" /> Warna & Nama Marker</div>
            {expandedSections.display ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandedSections.display && (
            <div className="space-y-2.5">
              {/* Auto-detect status */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">Auto-Detected</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  {markerConfig.capacityCol && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Kapasitas:</span>
                      <span className="font-semibold text-slate-700">{markerConfig.capacityCol}</span>
                    </div>
                  )}
                  {markerConfig.activeCol && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Status:</span>
                      <span className="font-semibold text-slate-700">{markerConfig.activeCol}</span>
                    </div>
                  )}
                  {markerConfig.nameCol1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Nama:</span>
                      <span className="font-semibold text-slate-700 truncate max-w-[140px]">{markerConfig.nameCol1}{markerConfig.nameCol2 ? ` - ${markerConfig.nameCol2}` : ''}</span>
                    </div>
                  )}
                  {!markerConfig.capacityCol && !markerConfig.activeCol && !markerConfig.nameCol1 && (
                    <p className="text-slate-400 italic">Tidak ada kolom yang terdeteksi otomatis</p>
                  )}
                </div>
              </div>
              {/* Color legend */}
              <div>
                <div className="text-[10px] text-slate-400 font-medium mb-1">Warna Kapasitas</div>
                <div className="grid grid-cols-2 gap-1">
                  {[{c:'#22c55e',l:'0-25%'},{c:'#3b82f6',l:'26-50%'},{c:'#eab308',l:'51-75%'},{c:'#ef4444',l:'76-100%'}].map(x => (
                    <div key={x.l} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{backgroundColor:x.c, boxShadow:`0 0 6px ${x.c}40`}} />{x.l}
                    </div>
                  ))}
                </div>
              </div>
              {/* Override dropdowns (collapsed by default feel) */}
              <details className="group">
                <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600 transition-colors flex items-center gap-1">
                  <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                  Override kolom manual
                </summary>
                <div className="mt-2 space-y-2 pl-1">
                  <div>
                    <label className="text-[10px] text-slate-500 mb-0.5 block">Kapasitas (warna)</label>
                    <select className="w-full h-7 px-2 text-[11px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                      value={markerConfig.capacityCol} onChange={e => onMarkerConfigChange({ ...markerConfig, capacityCol: e.target.value })}>
                      <option value="">-- Pilih --</option>
                      {columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500 mb-0.5 block">Status</label>
                      <select className="w-full h-7 px-2 text-[11px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                        value={markerConfig.activeCol} onChange={e => onMarkerConfigChange({ ...markerConfig, activeCol: e.target.value })}>
                        <option value="">-- Pilih --</option>
                        {columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 mb-0.5 block">Ketersediaan</label>
                      <select className="w-full h-7 px-2 text-[11px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                        value={markerConfig.availCol} onChange={e => onMarkerConfigChange({ ...markerConfig, availCol: e.target.value })}>
                        <option value="">-- Pilih --</option>
                        {columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-0.5 block">Nama Marker (2 kolom)</label>
                    <div className="flex gap-1 items-center">
                      <select className="flex-1 h-7 px-2 text-[11px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                        value={markerConfig.nameCol1} onChange={e => onMarkerConfigChange({ ...markerConfig, nameCol1: e.target.value })}>
                        <option value="">Kolom 1</option>
                        {columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <span className="text-slate-300 text-xs">-</span>
                      <select className="flex-1 h-7 px-2 text-[11px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                        value={markerConfig.nameCol2} onChange={e => onMarkerConfigChange({ ...markerConfig, nameCol2: e.target.value })}>
                        <option value="">Kolom 2</option>
                        {columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-0.5 flex items-center gap-1">
                      Label Teks di Peta
                      <span className="text-[9px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-semibold">NEW</span>
                    </label>
                    <select className="w-full h-7 px-2 text-[11px] border border-violet-200 rounded bg-violet-50/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30 text-violet-800 font-medium"
                      value={markerConfig.labelCol} onChange={e => onMarkerConfigChange({ ...markerConfig, labelCol: e.target.value })}>
                      <option value="">-- Tidak tampilkan --</option>
                      {columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <p className="text-[9px] text-slate-400 mt-0.5">Kolom yang ditampilkan sebagai label teks di setiap titik marker</p>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>

      {/* Footer */}
      {totalFilterCount > 0 && (
        <div className="p-4 border-t border-slate-200">
          <button className="w-full py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2" onClick={clearFilters}>
            <X className="w-3 h-3" /> Hapus Semua Filter ({totalFilterCount})
          </button>
        </div>
      )}
    </div>
  )
}
