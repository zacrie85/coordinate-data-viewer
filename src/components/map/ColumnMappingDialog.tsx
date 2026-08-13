'use client'

import { useState, useEffect } from 'react'
import { Settings2, X, Save, Wand2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

interface ColumnMappingDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  columns: string[]
  datasetId: string
  currentMapping: {
    activeCol: string | null
    capacityCol: string | null
    labelCol1: string | null
    labelCol2: string | null
  }
  onMappingSaved: () => void
}

const FIELD_CONFIG = [
  { key: 'labelCol2' as const, label: 'Code / Kode', desc: 'Kode unik ODP (contoh: K-BKT1.01-A04)', patterns: [/^(code|kode|odp_name|odp|id_odp|nama_odp|odpcode|odp_code)$/i], color: 'violet' },
  { key: 'labelCol1' as const, label: 'Name / Nama', desc: 'Nama atau label utama', patterns: [/^(nama|name|label|description|keterangan|alamat|address)$/i], color: 'blue' },
  { key: 'activeCol' as const, label: 'Active / Terpakai', desc: 'Jumlah port yang aktif/terpakai', patterns: [/^(active|terpakai|used|pakai|total_assigned|assigned)$/i], color: 'orange' },
  { key: 'capacityCol' as const, label: 'Capacity / Kapasitas', desc: 'Total kapasitas port', patterns: [/^(capacit|kapasitas|total_port|totalport|port|total)$/i], color: 'emerald' },
]

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  violet: { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', badge: 'bg-violet-100 text-violet-700' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
}

export default function ColumnMappingDialog({ open, onOpenChange, columns, datasetId, currentMapping, onMappingSaved }: ColumnMappingDialogProps) {
  const [mapping, setMapping] = useState({
    activeCol: '' as string,
    capacityCol: '' as string,
    labelCol1: '' as string,
    labelCol2: '' as string,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setMapping({
        activeCol: currentMapping.activeCol || '',
        capacityCol: currentMapping.capacityCol || '',
        labelCol1: currentMapping.labelCol1 || '',
        labelCol2: currentMapping.labelCol2 || '',
      })
    }
  }, [open, currentMapping])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const autoDetect = () => {
    const lower = columns.map(c => c.toLowerCase())
    const find = (patterns: RegExp[]) => {
      for (const p of patterns) { const i = lower.findIndex(c => p.test(c)); if (i >= 0) return columns[i] }
      return ''
    }
    setMapping({
      labelCol2: find(FIELD_CONFIG[0].patterns),
      labelCol1: find(FIELD_CONFIG[1].patterns),
      activeCol: find(FIELD_CONFIG[2].patterns),
      capacityCol: find(FIELD_CONFIG[3].patterns),
    })
    toast.success('Auto-detect diterapkan')
  }

  const reset = () => {
    setMapping({ activeCol: '', capacityCol: '', labelCol1: '', labelCol2: '' })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/data/save-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId, ...mapping }),
      })
      if (!res.ok) throw new Error('Gagal menyimpan')
      toast.success('Konfigurasi kolom tersimpan!')
      onMappingSaved()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan')
    } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ zIndex: 10000 }}>
        <div className="flex items-center justify-between p-4 pb-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center">
              <Settings2 className="w-4 h-4 text-slate-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Konfigurasi Kolom</h2>
              <p className="text-[11px] text-slate-400">Pilih kolom untuk setiap fungsi</p>
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <button onClick={autoDetect} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 rounded-lg text-xs font-medium text-violet-700 transition-colors">
              <Wand2 className="w-3.5 h-3.5" /> Auto-detect
            </button>
            <button onClick={reset} className="flex items-center justify-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-xs font-medium text-slate-600 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>

          {FIELD_CONFIG.map(field => {
            const c = COLOR_MAP[field.color]
            const value = mapping[field.key]
            return (
              <div key={field.key} className={`${c.bg} rounded-lg p-3 border ${c.border}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs font-bold ${c.text}`}>{field.label}</span>
                  {value && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.badge} font-medium`}>{value}</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mb-2">{field.desc}</p>
                <select
                  className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                  value={value}
                  onChange={(e) => setMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                >
                  <option value="">-- Tidak dipilih --</option>
                  {columns.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>
            )
          })}

          <div className="text-[10px] text-slate-400 space-y-0.5">
            <p><b>Code/Kode</b> diprioritaskan untuk label peta dan popup. <b>Name/Nama</b> sebagai fallback.</p>
            <p><b>Active</b> dan <b>Capacity</b> digunakan untuk hitung persentase kapasitas & warna marker.</p>
          </div>

          <button
            className="w-full py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Menyimpan...</span>
            ) : (
              <><Save className="w-4 h-4" /> Simpan Konfigurasi</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}