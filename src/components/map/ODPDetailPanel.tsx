'use client'

import { X, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { MarkerConfig } from '@/app/page'
import dynamic from 'next/dynamic'

const PhotoSection = dynamic(() => import('./PhotoSection'), { ssr: false })

interface DetailPanelProps {
  point: { id: string; latitude: number; longitude: number; metadata: Record<string, any>; createdAt: string }
  columns: string[]
  markerConfig: MarkerConfig
  onClose: () => void
}

// ── Hitung persentase: Active / Capacity × 100 ──
function calcPct(meta: Record<string, any>, mc: MarkerConfig): { pct: number; activeRaw: string; capRaw: string; activeNum: number; capNum: number } {
  if (mc.activeCol && mc.capacityCol) {
    const aRaw = String(meta[mc.activeCol] ?? '').trim()
    const cRaw = String(meta[mc.capacityCol] ?? '').trim()
    const aNum = parseFloat(aRaw.replace(/,/g, ''))
    const cNum = parseFloat(cRaw.replace(/,/g, ''))
    if (!isNaN(aNum) && !isNaN(cNum) && cNum > 0) {
      return { pct: (aNum / cNum) * 100, activeRaw: aRaw, capRaw: cRaw, activeNum: aNum, capNum: cNum }
    }
  }
  if (mc.capacityCol) {
    const raw = String(meta[mc.capacityCol] ?? '').trim()
    const m = raw.match(/^(\d+)\s*[\/\-]\s*(\d+)$/)
    if (m) {
      const a = parseInt(m[1]), c = parseInt(m[2])
      if (c > 0) return { pct: (a / c) * 100, activeRaw: m[1], capRaw: m[2], activeNum: a, capNum: c }
    }
    const p = raw.match(/^(\d+(?:\.\d+)?)\s*%?$/)
    if (p) return { pct: parseFloat(p[1]), activeRaw: raw, capRaw: '', activeNum: NaN, capNum: NaN }
  }
  return { pct: -1, activeRaw: '', capRaw: '', activeNum: NaN, capNum: NaN }
}

function statusColor(val: string): string {
  if (!val) return ''
  const v = val.toUpperCase().trim()
  if (v === 'ENABLE' || v === 'ACTIVE' || v === 'AVAILABLE' || v === 'UP') return 'text-green-600 bg-green-50 border-green-200'
  if (v === 'DISABLE' || v === 'INACTIVE' || v === 'DOWN') return 'text-red-600 bg-red-50 border-red-200'
  if (v === 'FULL') return 'text-red-600 bg-red-50 border-red-200'
  if (v === 'NOT AVAILABLE') return 'text-slate-500 bg-slate-50 border-slate-200'
  return 'text-slate-600 bg-slate-50 border-slate-200'
}

function capBarColor(pct: number): string {
  if (pct <= 25) return 'bg-green-500'
  if (pct <= 50) return 'bg-blue-500'
  if (pct <= 75) return 'bg-yellow-500'
  return 'bg-red-500'
}

export default function ODPDetailPanel({ point, columns, markerConfig, onClose }: DetailPanelProps) {
  const meta = point.metadata || {}
  const hasCoord = point.latitude !== 0 && point.longitude !== 0
  const copy = (text: string) => { navigator.clipboard.writeText(text); toast.success('Disalin') }
  const openMaps = () => { if (hasCoord) window.open(`https://www.google.com/maps?q=${point.latitude},${point.longitude}`, '_blank') }

  // Combined name
  const name1 = markerConfig.nameCol1 ? String(meta[markerConfig.nameCol1] || '') : ''
  const name2 = markerConfig.nameCol2 ? String(meta[markerConfig.nameCol2] || '') : ''
  const combinedName = [name1, name2].filter(Boolean).join(' - ')

  // Capacity calculation
  const cap = calcPct(meta, markerConfig)
  const hasCapacity = cap.pct >= 0

  // Status
  const activeVal = markerConfig.activeCol ? String(meta[markerConfig.activeCol] || '') : ''
  const availVal = markerConfig.availCol ? String(meta[markerConfig.availCol] || '') : ''

  // Skip columns from metadata list — nameCol2 (Code) tetap ditampilkan
  const skipCols = new Set<string>([markerConfig.nameCol1, markerConfig.capacityCol, markerConfig.activeCol, markerConfig.availCol].filter(Boolean))
  const otherCols = columns.filter(c => !skipCols.has(c))

  return (
    <div className="w-80 bg-white border-l border-slate-200 h-full flex flex-col shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-800 truncate">{combinedName || 'Detail Data'}</h3>
        <div className="flex items-center gap-1">
          {hasCoord && (
            <button onClick={openMaps} className="w-7 h-7 rounded hover:bg-blue-50 flex items-center justify-center" title="Google Maps">
              <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
            </button>
          )}
          <button onClick={onClose} className="w-7 h-7 rounded hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Status & Availability badges */}
      {(activeVal || availVal) && (
        <div className="p-4 border-b border-slate-100">
          <div className="flex gap-2">
            {activeVal && (
              <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${statusColor(activeVal)}`}>
                {activeVal}
              </span>
            )}
            {availVal && (
              <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${statusColor(availVal)}`}>
                {availVal}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Capacity bar: Active / Capacity */}
      {hasCapacity && (
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-600">
              {markerConfig.activeCol && markerConfig.capacityCol
                ? <>{markerConfig.activeCol} / {markerConfig.capacityCol}</>
                : 'Kapasitas'}
            </span>
            <span className="text-sm font-bold text-slate-800">
              {cap.activeRaw}{cap.capRaw ? ` / ${cap.capRaw}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${capBarColor(cap.pct)}`} style={{ width: `${Math.min(Math.round(cap.pct), 100)}%` }} />
            </div>
            <span className="text-sm font-bold text-slate-700 w-10 text-right">{Math.round(cap.pct)}%</span>
          </div>
        </div>
      )}

      {/* Coordinates */}
      {hasCoord && (
        <div className="p-4 bg-emerald-50 border-b border-emerald-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-emerald-500 uppercase tracking-wide font-medium">Koordinat</span>
            <button onClick={() => copy(`${point.latitude}, ${point.longitude}`)} className="text-emerald-500 hover:text-emerald-700">
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <div className="text-sm font-mono font-semibold text-emerald-800">{point.latitude}, {point.longitude}</div>
        </div>
      )}

      {/* Photo Section */}
      <PhotoSection pointId={point.id} />

      {/* All metadata */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-2.5">
          {otherCols.length === 0 ? (
            <p className="text-xs text-slate-400">Tidak ada metadata lainnya</p>
          ) : (
            otherCols.map(col => {
              const val = meta[col]
              if (val === undefined || val === null || val === '') return null
              return (
                <div key={col} className="group">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide font-medium">{col}</div>
                  <div className="text-sm text-slate-700 mt-0.5 flex items-start gap-1">
                    <span className="flex-1 break-all">{String(val)}</span>
                    <button onClick={() => copy(String(val))} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-slate-500 shrink-0 mt-0.5">
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}