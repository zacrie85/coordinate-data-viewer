'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { MarkerConfig } from '@/app/page'

let L: typeof import('leaflet') | null = null
let ClusterGroup: any = null

async function loadLeaflet() {
  if (L && ClusterGroup) return { L, ClusterGroup }
  const leaflet = await import('leaflet')
  L = leaflet.default
  L.Icon.Default.mergeOptions({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  })
  const mc = await import('leaflet.markercluster')
  ClusterGroup = mc.MarkerClusterGroup || mc.default?.MarkerClusterGroup
  return { L, ClusterGroup }
}

interface DataPoint {
  id: string; latitude: number; longitude: number; metadata: Record<string, any>; createdAt: string
}

interface MapViewProps {
  points: DataPoint[]; loading: boolean; selectedPoint: DataPoint | null
  onSelectPoint: (p: DataPoint | null) => void; columns: string[]; markerConfig: MarkerConfig
  drawMode?: boolean
  onAreaSelected?: (ids: Set<string>) => void
  selectedAreaIds?: Set<string> | null
}

// ── Point-in-polygon (ray casting) — FIX: lat/lng sudah benar ──
// polygon: [[lat, lng], ...]  →  x = lng, y = lat
function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0]  // x=lng, y=lat
    const xj = polygon[j][1], yj = polygon[j][0]  // x=lng, y=lat
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// ── Hitung persentase: Active / Capacity x 100 ──
function calcPct(meta: Record<string, any>, mc: MarkerConfig): { pct: number; activeRaw: string; capRaw: string } {
  if (mc.activeCol && mc.capacityCol) {
    const aRaw = String(meta[mc.activeCol] ?? '').trim()
    const cRaw = String(meta[mc.capacityCol] ?? '').trim()
    const aNum = parseFloat(aRaw.replace(/,/g, ''))
    const cNum = parseFloat(cRaw.replace(/,/g, ''))
    if (!isNaN(aNum) && !isNaN(cNum) && cNum > 0) {
      return { pct: (aNum / cNum) * 100, activeRaw: aRaw, capRaw: cRaw }
    }
  }
  if (mc.capacityCol) {
    const raw = String(meta[mc.capacityCol] ?? '').trim()
    const m = raw.match(/^(\d+)\s*[\/\-]\s*(\d+)$/)
    if (m) { const a = parseInt(m[1]), c = parseInt(m[2]); if (c > 0) return { pct: (a / c) * 100, activeRaw: m[1], capRaw: m[2] } }
    const p = raw.match(/^(\d+(?:\.\d+)?)\s*%?$/)
    if (p) return { pct: parseFloat(p[1]), activeRaw: raw, capRaw: '' }
  }
  return { pct: -1, activeRaw: '', capRaw: '' }
}

const CAP_COLORS = [
  { min: 0, max: 25, color: '#22c55e', label: '0-25%' },
  { min: 26, max: 50, color: '#3b82f6', label: '26-50%' },
  { min: 51, max: 75, color: '#eab308', label: '51-75%' },
  { min: 76, max: 100, color: '#ef4444', label: '76-100%' },
]

function getColor(pct: number): string {
  if (pct < 0) return '#10b981'
  for (const c of CAP_COLORS) { if (pct >= c.min && pct <= c.max) return c.color }
  return '#10b981'
}

function statusColor(val: string): string {
  if (!val) return ''
  const v = val.toUpperCase().trim()
  if (v === 'ENABLE' || v === 'ACTIVE' || v === 'AVAILABLE' || v === 'UP') return '#22c55e'
  if (v === 'DISABLE' || v === 'INACTIVE' || v === 'DOWN') return '#ef4444'
  if (v === 'FULL') return '#ef4444'
  return '#64748b'
}

function getPointLabel(meta: Record<string, any>, mc: MarkerConfig): string {
  // Pakai labelCol jika dipilih manual
  if (mc.labelCol) {
    const v = String(meta[mc.labelCol] || '').trim()
    if (v) return v
  }
  return ''
}

export default function ODPMap({ points, loading, selectedPoint, onSelectPoint, columns, markerConfig, drawMode, onAreaSelected, selectedAreaIds }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const clusterRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [drawing, setDrawing] = useState(false)          // FIX: state untuk tombol Finish
  const [vertexCount, setVertexCount] = useState(0)      // FIX: jumlah vertex untuk UI
  const pointsRef = useRef(points)
  useEffect(() => { pointsRef.current = points }, [points])
  const stableSelect = useCallback((p: DataPoint | null) => onSelectPoint(p), [onSelectPoint])
  const mcRef = useRef(markerConfig)
  useEffect(() => { mcRef.current = markerConfig }, [markerConfig])
  const buildPopupRef = useRef<(p: DataPoint) => string>(() => '')

  // Drawing state
  const drawingRef = useRef<any>(null) // L.polyline for in-progress drawing
  const drawVerticesRef = useRef<[number, number][]>([])
  const drawLayerRef = useRef<any>(null) // L.layerGroup for polygon
  const vertexMarkersRef = useRef<any[]>([]) // FIX: simpan vertex markers agar bisa dihapus
  const drawModeRef = useRef(drawMode)
  const onAreaSelectedRef = useRef(onAreaSelected) // FIX: ref untuk callback
  useEffect(() => { drawModeRef.current = drawMode }, [drawMode])
  useEffect(() => { onAreaSelectedRef.current = onAreaSelected }, [onAreaSelected])

  // Init map with clustering
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let destroyed = false
    async function init() {
      try {
        const { L: leaflet, ClusterGroup: CG } = await loadLeaflet()
        if (destroyed || !containerRef.current) return
        if (!document.querySelector('link[data-leaflet-css]')) {
          const link = document.createElement('link'); link.rel = 'stylesheet'
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
          link.setAttribute('data-leaflet-css', 'true'); document.head.appendChild(link)
          await new Promise(r => setTimeout(r, 100))
        }
        if (!document.querySelector('link[data-cluster-css]')) {
          const link = document.createElement('link'); link.rel = 'stylesheet'
          link.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'
          link.setAttribute('data-cluster-css', 'true'); document.head.appendChild(link)
          const link2 = document.createElement('link'); link2.rel = 'stylesheet'
          link2.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
          link2.setAttribute('data-cluster-css', 'true'); document.head.appendChild(link2)
          await new Promise(r => setTimeout(r, 50))
        }
        // Inject CSS for permanent map labels
        if (!document.querySelector('style[data-odp-label]')) {
          const style = document.createElement('style')
          style.setAttribute('data-odp-label', 'true')
          style.textContent = `
            .odp-map-label {
              background: transparent !important;
              border: none !important;
              box-shadow: none !important;
              color: #facc15 !important;
              font-size: 14px !important;
              font-weight: 700 !important;
              font-family: ui-monospace, monospace !important;
              padding: 1px 3px !important;
              text-shadow: 1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8), 1px -1px 2px rgba(0,0,0,0.8), -1px 1px 2px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.6) !important;
              white-space: nowrap !important;
            }
            .odp-map-label::before { display: none !important; }
          `
          document.head.appendChild(style)
        }
        if (destroyed || !containerRef.current) return

        const renderer = leaflet.canvas({ padding: 0.5 })

        const map = leaflet.map(containerRef.current, {
          center: [-2.5, 118], zoom: 5, zoomControl: false,
          preferCanvas: true, renderer,
        })
        leaflet.control.zoom({ position: 'topright' }).addTo(map)
        leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>', maxZoom: 19,
        }).addTo(map)

        // Drawing layer group
        const drawLayer = leaflet.layerGroup().addTo(map)
        drawLayerRef.current = drawLayer

        const cluster = new CG({
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          disableClusteringAtZoom: 9,
          iconCreateFunction: (cluster: any) => {
            const count = cluster.getChildCount()
            let dim = 36
            if (count > 1000) dim = 50
            else if (count > 100) dim = 42
            return leaflet.divIcon({
              html: `<div style="background:rgba(16,185,129,0.9);color:white;width:${dim}px;height:${dim}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${dim > 42 ? 13 : 11}px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white;">${count.toLocaleString()}</div>`,
              className: '', iconSize: [dim, dim], iconAnchor: [dim/2, dim/2],
            })
          },
        })
        cluster.addTo(map)
        map.fitBounds([[-8, 95], [6, 141]])
        if (!destroyed) { mapRef.current = map; clusterRef.current = cluster; setMapReady(true) }
      } catch (err) {
        console.error('Map init error:', err)
        if (!destroyed) setMapError('Gagal memuat peta')
      }
    }
    init()
    return () => { destroyed = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; clusterRef.current = null; markersRef.current.clear() } }
  }, [])

  // Build popup
  const buildPopup = useCallback((point: DataPoint): string => {
    const mc = mcRef.current
    const meta = point.metadata || {}
    const { pct, activeRaw, capRaw } = calcPct(meta, mc)
    const pctRound = pct >= 0 ? Math.round(pct) : -1
    const pctColor = getColor(pct)

    const name1 = mc.nameCol1 ? String(meta[mc.nameCol1] || '') : ''
    const name2 = mc.nameCol2 ? String(meta[mc.nameCol2] || '') : ''
    const combinedName = [name1, name2].filter(Boolean).join(' - ') || Object.entries(meta).find(([, v]) => v && v !== '')?.[0] || 'Point'

    const activeVal = mc.activeCol ? String(meta[mc.activeCol] || '') : ''
    const aColor = statusColor(activeVal)

    const skipCols = new Set<string>([mc.nameCol1, mc.nameCol2, mc.capacityCol, mc.activeCol, mc.availCol].filter(Boolean))
    const otherCols = columns.filter(c => !skipCols.has(c) && meta[c] && meta[c] !== '').slice(0, 6)

    let html = `<div style="min-width:260px;max-width:320px;font-family:system-ui,-apple-system,sans-serif;">`
    html += `<div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:4px;line-height:1.3;">${combinedName}</div>`
    html += `<div style="display:flex;align-items:center;gap:6px;font-size:11px;margin-bottom:4px;">`
    if (activeVal) html += `<span style="color:${aColor};font-weight:700;">${activeVal}</span>`
    if (pct >= 0) {
      html += `<span style="color:#64748b;">/</span>`
      html += `<span style="font-weight:700;color:#334155;">${capRaw || activeRaw}</span>`
      html += `<span style="margin-left:auto;font-weight:800;color:${pctColor};font-size:12px;">${pctRound}%</span>`
    }
    html += `</div>`
    if (pct >= 0) {
      html += `<div style="background:#e2e8f0;border-radius:4px;height:6px;overflow:hidden;margin-bottom:6px;"><div style="background:${pctColor};height:100%;width:${Math.min(pctRound, 100)}%;border-radius:4px;"></div></div>`
    }
    if (otherCols.length > 0) {
      html += `<div style="border-top:1px solid #f1f5f9;margin-top:4px;padding-top:6px;">`
      for (const c of otherCols) {
        html += `<div style="font-size:11px;color:#64748b;margin-bottom:2px;"><span style="color:#94a3b8;">${c}:</span> ${String(meta[c]).substring(0, 60)}</div>`
      }
      html += `</div>`
    }
    html += `<div style="font-size:10px;color:#94a3b8;margin-top:6px;">${point.latitude}, ${point.longitude}</div>`
    html += `</div>`
    return html
  }, [columns])

  buildPopupRef.current = buildPopup

  // Capacity stats
  const capStats = useMemo(() => {
    if (!markerConfig.activeCol || !markerConfig.capacityCol) return null
    let g = 0, b = 0, y = 0, r = 0, na = 0
    for (const p of points) {
      const { pct } = calcPct(p.metadata || {}, markerConfig)
      if (pct < 0) { na++; continue }
      if (pct <= 25) g++
      else if (pct <= 50) b++
      else if (pct <= 75) y++
      else r++
    }
    return { green: g, blue: b, yellow: y, red: r, na }
  }, [points, markerConfig.activeCol, markerConfig.capacityCol])

  // Update markers (debounced)
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!mapReady || !clusterRef.current || !L || !ClusterGroup) return

    if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    updateTimerRef.current = setTimeout(() => {
      const cluster = clusterRef.current
      if (!cluster) return
      cluster.clearLayers()
      markersRef.current.clear()

      const mc = mcRef.current
      const popupFn = buildPopupRef.current
      const isInArea = selectedAreaIds

      for (const point of pointsRef.current) {
        if (point.latitude === 0 && point.longitude === 0) continue
        const { pct } = calcPct(point.metadata || {}, mc)
        const isSelected = isInArea ? isInArea.has(point.id) : false
        const fillColor = isSelected ? '#8b5cf6' : getColor(pct)

        const marker = L!.circleMarker([point.latitude, point.longitude], {
          radius: isSelected ? 7 : 5,
          fillColor,
          color: isSelected ? '#7c3aed' : fillColor,
          weight: isSelected ? 2.5 : 1.5,
          opacity: isSelected ? 1 : (isInArea ? 0.3 : 1),
          fillOpacity: isSelected ? 0.9 : (isInArea ? 0.2 : 0.75),
        })
        marker.bindPopup(popupFn(point), { maxWidth: 340, minWidth: 260 })
        // Simpan metadata di marker untuk label dinamis (bind hanya saat zoom dekat)
        ;(marker as any)._pointMeta = point.metadata || {}
        marker.on('click', () => stableSelect(point))
        cluster.addLayer(marker)
        markersRef.current.set(point.id, marker)
      }
    }, 100)

    return () => { if (updateTimerRef.current) clearTimeout(updateTimerRef.current) }
  }, [mapReady, points, columns, stableSelect, selectedAreaIds])

  // ── Label dinamis: hanya tampil saat zoom >= 13 ──
  useEffect(() => {
    const map = mapRef.current
    const cluster = clusterRef.current
    if (!map || !cluster) return

    const LABEL_ZOOM = 13

    const syncLabels = () => {
      const zoom = map.getZoom()
      const show = zoom >= LABEL_ZOOM
      const mc = mcRef.current

      cluster.eachLayer((layer: any) => {
        const hasTooltip = !!layer.getTooltip()
        if (show && !hasTooltip) {
          const meta = layer._pointMeta
          if (meta) {
            const label = getPointLabel(meta, mc)
            if (label) {
              layer.bindTooltip(label.substring(0, 25), {
                permanent: true, direction: 'right', className: 'odp-map-label', offset: [6, -1],
              })
            }
          }
        } else if (!show && hasTooltip) {
          layer.unbindTooltip()
        }
      })
    }

    map.on('zoomend', syncLabels)
    // Initial sync setelah marker selesai dibuat
    const initTimer = setTimeout(syncLabels, 300)

    return () => { map.off('zoomend', syncLabels); clearTimeout(initTimer) }
  }, [mapReady])

  // Highlight selected point
  useEffect(() => {
    if (!mapRef.current || !selectedPoint) return
    if (selectedPoint.latitude === 0 && selectedPoint.longitude === 0) return
    const marker = markersRef.current.get(selectedPoint.id)
    if (marker) {
      mapRef.current.setView([selectedPoint.latitude, selectedPoint.longitude], 16, { animate: true })
      setTimeout(() => {
        if (marker.isPopupOpen) return
        try { marker.openPopup() } catch(e) {
          const cluster = clusterRef.current
          if (cluster && cluster.zoomToShowLayer) {
            cluster.zoomToShowLayer(marker, () => { marker.openPopup() })
          }
        }
      }, 400)
    }
  }, [selectedPoint])

  // Fit bounds on first load
  const initialFitRef = useRef(false)
  useEffect(() => {
    if (!mapRef.current || !L || initialFitRef.current || points.length === 0 || selectedPoint) return
    const valid = points.filter(p => p.latitude !== 0 && p.longitude !== 0)
    if (valid.length > 0) {
      const bounds = L!.latLngBounds(valid.map(p => [p.latitude, p.longitude] as [number, number]))
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
      initialFitRef.current = true
    }
  }, [points, selectedPoint])

  // ── Finish drawing polygon (dipanggil dari tombol Finish atau dblclick) ──
  const finishDrawing = useCallback(() => {
    const map = mapRef.current
    if (!map || !L) return

    const vertices = drawVerticesRef.current
    if (vertices.length < 3) return

    // Remove drawing line
    if (drawingRef.current) { map.removeLayer(drawingRef.current); drawingRef.current = null }

    // Clear vertex markers
    for (const vm of vertexMarkersRef.current) {
      if (drawLayerRef.current) drawLayerRef.current.removeLayer(vm)
    }
    vertexMarkersRef.current = []

    // Draw filled polygon
    const polygon = L!.polygon(vertices, {
      color: '#7c3aed', weight: 2, fillColor: '#8b5cf6', fillOpacity: 0.15,
    }).addTo(drawLayerRef.current)

    // Find points inside polygon using ray casting (FIXED)
    const ids = new Set<string>()
    for (const p of pointsRef.current) {
      if (p.latitude === 0 && p.longitude === 0) continue
      if (pointInPolygon(p.latitude, p.longitude, vertices)) {
        ids.add(p.id)
      }
    }

    onAreaSelectedRef.current?.(ids)

    // Reset drawing state
    drawVerticesRef.current = []
    setDrawing(false)
    setVertexCount(0)
  }, [])

  // Store finishDrawing in ref for use inside event handler
  const finishDrawingRef = useRef(finishDrawing)
  useEffect(() => { finishDrawingRef.current = finishDrawing }, [finishDrawing])

  // ── Polygon drawing ── FIX: dblclick disabled, pakai tombol Finish ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !L) return

    if (drawMode) {
      // FIX: disable dblclick zoom saat draw mode
      map.doubleClickZoom.disable()
      map.getContainer().style.cursor = 'crosshair'

      const onClick = (e: any) => {
        const latlng = e.latlng
        const vertex: [number, number] = [latlng.lat, latlng.lng]
        drawVerticesRef.current.push(vertex)

        // Remove old drawing line
        if (drawingRef.current) map.removeLayer(drawingRef.current)

        // Draw line through all vertices + back to first
        if (drawVerticesRef.current.length >= 2) {
          const previewVerts = [...drawVerticesRef.current, drawVerticesRef.current[0]]
          drawingRef.current = L!.polyline(previewVerts, {
            color: '#8b5cf6', weight: 3, dashArray: '8, 6', opacity: 0.9,
          }).addTo(map)
        }

        // Add vertex marker
        const vertexMarker = L!.circleMarker(vertex, {
          radius: 5, fillColor: '#8b5cf6', color: '#fff', weight: 2, fillOpacity: 1,
        }).addTo(drawLayerRef.current)
        vertexMarkersRef.current.push(vertexMarker)

        setDrawing(true)
        setVertexCount(drawVerticesRef.current.length)
      }

      // FIX: dblclick hanya untuk finish, tidak zoom
      const onDblClick = (e: any) => {
        L!.DomEvent.stopPropagation(e)
        L!.DomEvent.preventDefault(e)
        // Hapus vertex terakhir yang ke-duplicate dari click kedua
        if (drawVerticesRef.current.length > 3) {
          drawVerticesRef.current.pop()
          const lastVm = vertexMarkersRef.current.pop()
          if (lastVm && drawLayerRef.current) drawLayerRef.current.removeLayer(lastVm)
          setVertexCount(drawVerticesRef.current.length)
        }
        finishDrawingRef.current()
      }

      map.on('click', onClick)
      map.on('dblclick', onDblClick)

      return () => {
        map.off('click', onClick)
        map.off('dblclick', onDblClick)
        map.doubleClickZoom.enable() // FIX: restore dblclick zoom
        map.getContainer().style.cursor = ''
        if (drawingRef.current) { map.removeLayer(drawingRef.current); drawingRef.current = null }
        for (const vm of vertexMarkersRef.current) {
          if (drawLayerRef.current) drawLayerRef.current.removeLayer(vm)
        }
        vertexMarkersRef.current = []
        drawVerticesRef.current = []
        setDrawing(false)
        setVertexCount(0)
      }
    } else {
      map.getContainer().style.cursor = ''
      if (drawingRef.current) { map.removeLayer(drawingRef.current); drawingRef.current = null }
      for (const vm of vertexMarkersRef.current) {
        if (drawLayerRef.current) drawLayerRef.current.removeLayer(vm)
      }
      vertexMarkersRef.current = []
      drawVerticesRef.current = []
      setDrawing(false)
      setVertexCount(0)
    }
  }, [drawMode])

  // Clear polygon when selectedAreaIds is nullified
  useEffect(() => {
    if (selectedAreaIds === null && drawLayerRef.current) {
      drawLayerRef.current.clearLayers()
      vertexMarkersRef.current = []
    }
  }, [selectedAreaIds])

  if (mapError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
        <div className="text-center p-8"><p className="text-slate-500">{mapError}</p>
          <button className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700" onClick={() => window.location.reload()}>Muat Ulang</button></div>
      </div>
    )
  }

  const totalCoord = points.filter(p => p.latitude !== 0 && p.longitude !== 0).length

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />

      {/* Draw mode overlay */}
      {drawMode && !selectedAreaIds && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1001] bg-violet-500 text-white px-4 py-2 rounded-full shadow-lg text-xs font-semibold flex items-center gap-2">
          Klik untuk menambah titik. {drawing ? `${vertexCount} titik` : 'Mulai klik pada peta.'}
        </div>
      )}

      {/* FIX: Tombol Finish polygon */}
      {drawMode && drawing && vertexCount >= 3 && !selectedAreaIds && (
        <button
          onClick={finishDrawing}
          className="absolute top-16 right-16 z-[1001] bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm font-bold flex items-center gap-2 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Finish ({vertexCount} titik)
        </button>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 text-xs space-y-1.5">
        <div className="font-semibold text-slate-700">Titik Data: {totalCoord.toLocaleString()}{selectedAreaIds && <span className="text-violet-600"> ({selectedAreaIds.size.toLocaleString()} dipilih)</span>}</div>
        {capStats && markerConfig.activeCol && markerConfig.capacityCol ? (
          <div className="space-y-1 pt-1 border-t border-slate-100">
            <div className="text-[10px] text-slate-400 font-medium">{markerConfig.activeCol} / {markerConfig.capacityCol}</div>
            {CAP_COLORS.map(c => {
              const count = c.label === '0-25%' ? capStats.green : c.label === '26-50%' ? capStats.blue : c.label === '51-75%' ? capStats.yellow : capStats.red
              return (
                <div key={c.label} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color, boxShadow: `0 0 4px ${c.color}40` }} />
                  <span className="text-slate-600">{c.label}</span>
                  <span className="text-slate-400 ml-auto tabular-nums">{count.toLocaleString()}</span>
                </div>
              )
            })}
            {capStats.na > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gray-300 shrink-0" />
                <span className="text-slate-400">N/A</span>
                <span className="text-slate-300 ml-auto tabular-nums">{capStats.na.toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm" />
            <span className="text-slate-600">{totalCoord.toLocaleString()} titik</span>
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
