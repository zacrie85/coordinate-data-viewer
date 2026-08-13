'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

let L: typeof import('leaflet') | null = null

async function loadLeaflet() {
  if (L) return L
  const leaflet = await import('leaflet')
  L = leaflet.default
  L.Icon.Default.mergeOptions({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  })
  return L
}

interface DataPoint {
  id: string
  latitude: number
  longitude: number
  metadata: Record<string, any>
  createdAt: string
}

export interface MarkerConfig {
  activeCol: string
  capacityCol: string
  labelCol1: string
  labelCol2: string
  labelCol: string
}

interface MapViewProps {
  points: DataPoint[]
  loading: boolean
  selectedPoint: DataPoint | null
  onSelectPoint: (p: DataPoint | null) => void
  columns: string[]
  markerConfig: MarkerConfig | null
}

function getColorByPercentage(pct: number): string {
  if (pct <= 25) return '#22c55e'
  if (pct <= 50) return '#3b82f6'
  if (pct <= 75) return '#eab308'
  return '#ef4444'
}

function getColorBorder(pct: number): string {
  if (pct <= 25) return '#16a34a'
  if (pct <= 50) return '#2563eb'
  if (pct <= 75) return '#ca8a04'
  return '#dc2626'
}

export default function ODPMap({ points, loading, selectedPoint, onSelectPoint, columns, markerConfig }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const layerGroupRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const pointsRef = useRef(points)
  useEffect(() => { pointsRef.current = points }, [points])
  const stableSelect = useCallback((p: DataPoint | null) => onSelectPoint(p), [onSelectPoint])

  // ── Drag Zoom State ──
  const [dragZoomActive, setDragZoomActive] = useState(false)
  const dragZoomRef = useRef(false)
  const dragBoxRef = useRef<any>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const dragDivRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { dragZoomRef.current = dragZoomActive }, [dragZoomActive])

  const toggleDragZoom = useCallback(() => {
    const next = !dragZoomRef.current
    setDragZoomActive(next)
    if (!next) {
      // Nonaktifkan: hapus kotak drag jika ada
      if (dragBoxRef.current && mapRef.current) {
        mapRef.current.removeLayer(dragBoxRef.current)
        dragBoxRef.current = null
      }
      if (dragDivRef.current) {
        dragDivRef.current.remove()
        dragDivRef.current = null
      }
      dragStartRef.current = null
    }
  }, [])

  // ── Drag Zoom Handlers ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !L) return

    if (dragZoomActive) {
      // Nonaktifkan dragging & doubleClickZoom biasa
      map.dragging.disable()
      map.doubleClickZoom.disable()
      map.getContainer().style.cursor = 'crosshair'

      // Buat overlay div untuk menggambar kotak drag
      let overlayDiv = document.createElement('div')
      overlayDiv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1000;pointer-events:none;'
      map.getContainer().appendChild(overlayDiv)
      dragDivRef.current = overlayDiv

      // Buat rectangle element
      let boxDiv = document.createElement('div')
      boxDiv.style.cssText = 'position:absolute;border:2px dashed #7c3aed;background:rgba(124,58,237,0.1);display:none;pointer-events:none;z-index:1001;'
      overlayDiv.appendChild(boxDiv)

      const onMouseDown = (e: MouseEvent) => {
        const rect = map.getContainer().getBoundingClientRect()
        dragStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        boxDiv.style.display = 'block'
        boxDiv.style.left = dragStartRef.current.x + 'px'
        boxDiv.style.top = dragStartRef.current.y + 'px'
        boxDiv.style.width = '0px'
        boxDiv.style.height = '0px'
      }

      const onMouseMove = (e: MouseEvent) => {
        if (!dragStartRef.current) return
        const rect = map.getContainer().getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const sx = dragStartRef.current.x
        const sy = dragStartRef.current.y
        boxDiv.style.left = Math.min(sx, cx) + 'px'
        boxDiv.style.top = Math.min(sy, cy) + 'px'
        boxDiv.style.width = Math.abs(cx - sx) + 'px'
        boxDiv.style.height = Math.abs(cy - sy) + 'px'
      }

      const onMouseUp = (e: MouseEvent) => {
        if (!dragStartRef.current) return
        const rect = map.getContainer().getBoundingClientRect()
        const ex = e.clientX - rect.left
        const ey = e.clientY - rect.top
        const sx = dragStartRef.current.x
        const sy = dragStartRef.current.y

        // Minimal drag size (10px)
        if (Math.abs(ex - sx) > 10 && Math.abs(ey - sy) > 10) {
          const p1 = map.containerPointToLatLng([Math.min(sx, ex), Math.min(sy, ey)])
          const p2 = map.containerPointToLatLng([Math.max(sx, ex), Math.max(sy, ey)])
          const bounds = L!.latLngBounds(p1, p2)
          map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 })
          // Auto-exit drag zoom setelah zoom
          setDragZoomActive(false)
          if (dragDivRef.current) { dragDivRef.current.remove(); dragDivRef.current = null }
          map.dragging.enable()
          map.doubleClickZoom.enable()
          map.getContainer().style.cursor = ''
        } else {
          // Terlalu kecil, reset
          boxDiv.style.display = 'none'
        }
        dragStartRef.current = null
      }

      const container = map.getContainer()
      container.addEventListener('mousedown', onMouseDown)
      container.addEventListener('mousemove', onMouseMove)
      container.addEventListener('mouseup', onMouseUp)

      return () => {
        container.removeEventListener('mousedown', onMouseDown)
        container.removeEventListener('mousemove', onMouseMove)
        container.removeEventListener('mouseup', onMouseUp)
        if (overlayDiv.parentNode) overlayDiv.parentNode.removeChild(overlayDiv)
        dragDivRef.current = null
        map.dragging.enable()
        map.doubleClickZoom.enable()
        map.getContainer().style.cursor = ''
      }
    } else {
      // Pastikan dragging aktif saat mode drag zoom off
      if (map.dragging && !map.dragging.enabled()) map.dragging.enable()
      if (map.doubleClickZoom && !map.doubleClickZoom.enabled()) map.doubleClickZoom.enable()
      map.getContainer().style.cursor = ''
      if (dragDivRef.current) { dragDivRef.current.remove(); dragDivRef.current = null }
    }
  }, [dragZoomActive])

  // Esc untuk keluar dari drag zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragZoomRef.current) toggleDragZoom()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleDragZoom])

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let destroyed = false
    async function init() {
      try {
        const leaflet = await loadLeaflet()
        if (destroyed || !containerRef.current) return
        if (!document.querySelector('link[data-leaflet-css]')) {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
          link.setAttribute('data-leaflet-css', 'true')
          document.head.appendChild(link)
          await new Promise(r => setTimeout(r, 100))
        }
        if (destroyed || !containerRef.current) return
        const map = leaflet.map(containerRef.current, {
          center: [-2.5, 118], zoom: 5, zoomControl: false, preferCanvas: true,
        })
        // Zoom default Leaflet dihapus — pakai tombol custom di bawah
        leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
          maxZoom: 19,
        }).addTo(map)
        const layerGroup = leaflet.layerGroup().addTo(map)
        map.fitBounds([[-8, 95], [6, 141]])

        // Inject CSS untuk permanent marker label
        if (!document.querySelector('#odp-label-style')) {
          const style = document.createElement('style')
          style.id = 'odp-label-style'
          style.textContent = `
            .odp-marker-label {
              background: none !important;
              border: none !important;
              box-shadow: none !important;
              color: #facc15 !important;
              font-size: 17px !important;
              font-weight: 600 !important;
              font-family: system-ui, -apple-system, sans-serif !important;
              padding: 1px 3px !important;
              white-space: nowrap !important;
              text-shadow: 1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8), 1px -1px 2px rgba(0,0,0,0.8), -1px 1px 2px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.6) !important;
            }
            .odp-marker-label::before { display: none !important; }
          `
          document.head.appendChild(style)
        }

        if (!destroyed) { mapRef.current = map; layerGroupRef.current = layerGroup; setMapReady(true) }
      } catch (err) {
        console.error('Map init error:', err)
        if (!destroyed) setMapError('Gagal memuat peta')
      }
    }
    init()
    return () => {
      destroyed = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerGroupRef.current = null; markersRef.current.clear() }
    }
  }, [])

  // Extract code label from point
    const getCodeLabel = (point: DataPoint): string => {
    const meta = point.metadata || {}
    if (markerConfig?.labelCol && meta[markerConfig.labelCol]) {
      return String(meta[markerConfig.labelCol]).substring(0, 25)
    }
    return ''
  }

  // Build popup: CODE - ACTIVE/CAPACITY
  const buildPopup = (point: DataPoint): string => {
    const meta = point.metadata || {}
    const code = getCodeLabel(point)
    const active = markerConfig?.activeCol ? meta[markerConfig.activeCol] : ''
    const capacity = markerConfig?.capacityCol ? meta[markerConfig.capacityCol] : ''
    const title = code ? `<div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:6px;">${code}</div>` : ''
    const ratio = (active !== '' && capacity !== '') ? `<div style="font-size:14px;font-weight:600;color:#334155;">${active} / ${capacity}</div>` : ''
    const coord = `<div style="margin-top:6px;font-size:10px;color:#94a3b8;">${point.latitude}, ${point.longitude}</div>`
    return `<div style="min-width:160px;font-family:system-ui,sans-serif;">${title}${ratio}${coord}</div>`
  }

  // Update markers
  useEffect(() => {
    if (!mapReady || !layerGroupRef.current || !L) return
    const layer = layerGroupRef.current
    layer.clearLayers()
    markersRef.current.clear()
    let hasValid = false
    for (const point of pointsRef.current) {
      if (point.latitude === 0 && point.longitude === 0) continue
      const isSelected = selectedPoint?.id === point.id

      let fillColor = '#94a3b8'
      let strokeColor = '#64748b'
      if (markerConfig?.activeCol && markerConfig?.capacityCol) {
        const meta = point.metadata || {}
        const active = parseFloat(meta[markerConfig.activeCol])
        const capacity = parseFloat(meta[markerConfig.capacityCol])
        if (!isNaN(active) && !isNaN(capacity) && capacity > 0) {
          const pct = (active / capacity) * 100
          fillColor = getColorByPercentage(pct)
          strokeColor = getColorBorder(pct)
        }
      }

      const marker = L!.circleMarker([point.latitude, point.longitude], {
        radius: isSelected ? 7 : 4,
        fillColor: isSelected ? '#ffffff' : fillColor,
        color: isSelected ? '#1e293b' : strokeColor,
        weight: isSelected ? 3 : 1,
        opacity: 1,
        fillOpacity: isSelected ? 1 : 0.75,
      })
      marker.bindPopup(buildPopup(point), { maxWidth: 300 })
      marker.on('click', () => stableSelect(point))

      const code = getCodeLabel(point)
      if (code) {
        marker.bindTooltip(code, {
          permanent: true,
          direction: 'right',
          offset: [6, 0],
          className: 'odp-marker-label',
        })
      }

      layer.addLayer(marker)
      markersRef.current.set(point.id, marker)
      hasValid = true
    }
    if (hasValid && pointsRef.current.length > 0 && !selectedPoint) {
      const valid = pointsRef.current.filter(p => p.latitude !== 0 && p.longitude !== 0)
      if (valid.length > 0) {
        const bounds = L!.latLngBounds(valid.map(p => [p.latitude, p.longitude] as [number, number]))
        mapRef.current?.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
      }
    }
  }, [mapReady, selectedPoint, stableSelect, points.length, columns, markerConfig])

  // Highlight selected
  useEffect(() => {
    if (!mapRef.current || !selectedPoint) return
    if (selectedPoint.latitude === 0 && selectedPoint.longitude === 0) return
    const marker = markersRef.current.get(selectedPoint.id)
    if (marker) {
      mapRef.current.setView([selectedPoint.latitude, selectedPoint.longitude], 16, { animate: true })
      setTimeout(() => marker.openPopup(), 300)
    }
  }, [selectedPoint])

  if (mapError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
        <div className="text-center p-8">
          <p className="text-slate-500">{mapError}</p>
          <button className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700" onClick={() => window.location.reload()}>Muat Ulang</button>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />

      {/* Zoom Controls — Bottom Right */}
      <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-1.5">
        <button
          onClick={() => mapRef.current?.zoomIn()}
          className="h-9 w-9 bg-white rounded-lg shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors"
          title="Zoom In"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut()}
          className="h-9 w-9 bg-white rounded-lg shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors"
          title="Zoom Out"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <div className="w-full h-px bg-slate-200 my-0.5" />
        <button
          onClick={toggleDragZoom}
          className={`h-9 w-9 rounded-lg shadow-lg flex items-center justify-center transition-colors ${
            dragZoomActive
              ? 'bg-violet-500 text-white hover:bg-violet-600'
              : 'bg-white text-slate-700 hover:bg-violet-50 hover:text-violet-600'
          }`}
          title={dragZoomActive ? 'Keluar mode Drag Zoom (Esc)' : 'Drag Zoom'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2v6H2" /><path d="M2 6h16a4 4 0 0 1 0 8H6" /><path d="M18 22v-6h4" /><path d="M22 18H6a4 4 0 0 1 0-8h16" />
          </svg>
        </button>
      </div>

      {/* Drag Zoom Info Banner */}
      {dragZoomActive && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1002] bg-violet-500 text-white px-4 py-2 rounded-full shadow-lg text-xs font-semibold flex items-center gap-2 animate-pulse">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2v6H2"/><path d="M2 6h16a4 4 0 0 1 0 8H6"/><path d="M18 22v-6h4"/><path d="M22 18H6a4 4 0 0 1 0-8h16"/></svg>
          Drag di peta untuk zoom ke area. Tekan Esc untuk keluar.
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 text-xs">
        <div className="font-semibold text-slate-700 mb-1.5">Kapasitas Terpakai</div>
        {markerConfig?.activeCol && markerConfig?.capacityCol ? (
          <>
            <div className="space-y-1 mb-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: '#22c55e' }} />
                <span className="text-slate-600">0 – 25%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: '#3b82f6' }} />
                <span className="text-slate-600">26 – 50%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: '#eab308' }} />
                <span className="text-slate-600">51 – 75%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: '#ef4444' }} />
                <span className="text-slate-600">76 – 100%</span>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">
              {points.filter(p => p.latitude !== 0 && p.longitude !== 0).length.toLocaleString()} titik
              <span className="ml-1">({markerConfig.activeCol}/{markerConfig.capacityCol})</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm" />
            <span className="text-slate-600">{points.filter(p => p.latitude !== 0 && p.longitude !== 0).length.toLocaleString()} titik</span>
          </div>
        )}
      </div>
      {/* Loading */}
      {loading && !mapReady && (
        <div className="absolute inset-0 z-[1001] bg-white/60 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-slate-600 font-medium">Memuat data...</span>
          </div>
        </div>
      )}
    </div>
  )
}
