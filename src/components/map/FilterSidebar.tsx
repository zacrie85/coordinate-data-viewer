'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Search, X, ChevronDown, ChevronUp, MapPin, Database, Upload,
  Trash2, Crosshair, Filter, ArrowUpFromLine, Layers, Eye, Tag,
} from 'lucide-react'
import { toast } from 'sonner'

type MarkerConfig = import('@/app/page').MarkerConfig
type CustomFilterSlot = import('@/app/page').CustomFilterSlot

interface StatsData {
  total: number
  withCoord: number
  withoutCoord: number
  datasetName: string
  rowCount: number
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
  onFiltersChange: (f: { search: string; hasCoord: string; customFilters: CustomFilterSlot[] }) => void
  onUploadClick: () => void
  onDatasetSwitch: () => void
  onExportCsv?: () => void
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

export default function FilterSidebar({
  stats, columns, datasetName, coordInfo, totalResults,
  searchQuery, hasCoord, customFilters,
  markerConfig, onMarkerConfigChange,
  onFiltersChange, onUploadClick, onDatasetSwitch,
  onExportCsv, onExportExcel, onClose
}: FilterSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    datasets: true, search: true, coordinate: true, filter: true, label: true,
  })
  const [sectionSearch, setSectionSearch] = useState('')
  const [fieldValues, setFieldValues] = useState<{ value: string; count: number }[]>([])
  const [fieldLoading, setFieldLoading] = useState(false)
  const [datasets, setDatasets] = useState<DatasetItem[]>([])

  // Use first custom filter slot for sidebar UI
  const activeSlot = customFilters[0] || { field: '', values: [] }
  const activeValues = activeSlot.values

  const toggleSection = (s: string) => setExpandedSections(p => ({ ...p, [s]: !p[s] }))

  // Load datasets list
  useEffect(() => {
    fetch('/api/datasets').then(r => r.json()).then(setDatasets).catch(() => {})
  }, [])

  // Load field values when active slot field changes
  useEffect(() => {
    if (!activeSlot.field) { setFieldValues([]); return }
    setFieldLoading(true)
    fetch(`/api/data/field-values?field=${encodeURIComponent(activeSlot.field)}`)
      .then(r => r.json())
      .then(data => { setFieldValues(Array.isArray(data) ? data : []); setFieldLoading(false) })
      .catch(() => setFieldLoading(false))
  }, [activeSlot.field])

  const activeFilterCount = useMemo(() => {
    let c = 0
    if (searchQuery) c++
    if (hasCoord) c++
    let valCount = 0
    for (const cf of customFilters) valCount += cf.values.length
    if (valCount > 0) c++
    return c
  }, [searchQuery, hasCoord, customFilters])

  const toggleValue = (val: string) => {
    const updated = activeValues.includes(val)
      ? activeValues.filter(v => v !== val)
      : [...activeValues, val]
    const newFilters = [...customFilters]
    newFilters[0] = { field: activeSlot.field, values: updated }
    onFiltersChange({ search: searchQuery, hasCoord, customFilters: newFilters })
  }

  const clearFilters = () => {
    setSectionSearch('')
    onFiltersChange({ search: '', hasCoord: '', customFilters: [{ field: '', values: [] }, { field: '', values: [] }, { field: '', values: [] }] })
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

  const filteredValues = useMemo(() => {
    if (!sectionSearch) return fieldValues
    const q = sectionSearch.toLowerCase()
    return fieldValues.filter(v => v.value.toLowerCase().includes(q))
  }, [fieldValues, sectionSearch])

  const handleLabelColChange = (col: string) => {
    onMarkerConfigChange({ ...markerConfig, labelCol: col })
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
            {activeFilterCount > 0 && <span className="h-5 px-1.5 text-[10px] bg-emerald-500 text-white rounded-full font-medium">{activeFilterCount}</span>}
            {onClose && <button className="lg:hidden h-8 w-8 flex items-center justify-center rounded hover:bg-slate-100" onClick={onClose}><X className="w-4 h-4" /></button>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={onUploadClick} className="flex-1 flex items-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors text-left">
            <div className="w-6 h-6 rounded bg-emerald-500 flex items-center justify-center shrink-0"><ArrowUpFromLine className="w-3.5 h-3.5 text-white" /></div>
            <div className="min-w-0"><div className="text-xs font-semibold text-emerald-800">Upload</div><div className="text-[10px] text-emerald-500">Excel</div></div>
          </button>
          <button onClick={onUploadClick} className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors text-left">
            <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center shrink-0"><Layers className="w-3.5 h-3.5 text-white" /></div>
            <div className="min-w-0"><div className="text-xs font-semibold text-blue-800">Dataset</div><div className="text-[10px] text-blue-500">Switch</div></div>
          </button>
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

        {/* ★★★ LABEL TEKS DI PETA ★★★ */}
        <div>
          <button className="flex items-center justify-between w-full text-sm font-semibold text-slate-700 mb-2" onClick={() => toggleSection('label')}>
            <div className="flex items-center gap-2"><Tag className="w-4 h-4 text-amber-500" /> Label Teks di Peta</div>
            {expandedSections.label ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandedSections.label && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400">Pilih kolom yang akan ditampilkan sebagai label teks pada titik di peta. Label muncul saat zoom level 13 ke atas.</p>
              <select
                className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
                value={markerConfig.labelCol || ''}
                onChange={(e) => handleLabelColChange(e.target.value)}
              >
                <option value="">-- Tidak ada label --</option>
                {columns.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {markerConfig.labelCol && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-[11px] text-amber-700">Label aktif: <b>{markerConfig.labelCol}</b></span>
                </div>
              )}
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

        {/* DYNAMIC COLUMN FILTER */}
        <div>
          <button className="flex items-center justify-between w-full text-sm font-semibold text-slate-700 mb-2" onClick={() => toggleSection('filter')}>
            <div className="flex items-center gap-2"><Filter className="w-4 h-4" /> Filter Kolom {activeValues.length > 0 && <span className="h-4 px-1.5 text-[10px] bg-emerald-500 text-white rounded-full">{activeValues.length}</span>}</div>
            {expandedSections.filter ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandedSections.filter && (
            <div>
              {columns.length === 0 ? (
                <p className="text-[11px] text-slate-400 px-1">Upload Excel dulu untuk melihat filter kolom</p>
              ) : (
                <>
                  <select
                    className="w-full h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 mb-2"
                    value={activeSlot.field}
                    onChange={(e) => {
                      const newFilters = [...customFilters]
                      newFilters[0] = { field: e.target.value, values: [] }
                      onFiltersChange({ search: searchQuery, hasCoord, customFilters: newFilters })
                    }}
                  >
                    <option value="">-- Pilih Kolom --</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>

                  {activeSlot.field && (
                    fieldLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        <span className="ml-2 text-xs text-slate-400">Memuat...</span>
                      </div>
                    ) : (
                      <>
                        <div className="relative mb-2">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                          <input placeholder="Cari nilai..." className="w-full pl-8 h-7 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30" value={sectionSearch} onChange={(e) => setSectionSearch(e.target.value)} />
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {filteredValues.slice(0, 50).map(v => (
                            <FilterItem key={v.value} value={v.value} count={v.count} checked={activeValues.includes(v.value)} onToggle={() => toggleValue(v.value)} />
                          ))}
                          {filteredValues.length > 50 && <p className="px-3 py-1 text-[10px] text-slate-400 italic">+ {filteredValues.length - 50} lainnya...</p>}
                          {filteredValues.length === 0 && !fieldLoading && <p className="px-3 py-2 text-xs text-slate-400">Tidak ada data</p>}
                        </div>
                      </>
                    )
                  )}

                  {!activeSlot.field && <p className="text-[10px] text-slate-400 px-1">Pilih kolom di atas untuk memfilter</p>}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {activeFilterCount > 0 && (
        <div className="p-4 border-t border-slate-200">
          <button className="w-full py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2" onClick={clearFilters}>
            <X className="w-3 h-3" /> Hapus Semua Filter
          </button>
        </div>
      )}
    </div>
  )
}
