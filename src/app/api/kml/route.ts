import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

function escapeXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function calcPct(meta: Record<string, any>, activeCol: string, capacityCol: string): { pct: number; activeRaw: string; capRaw: string } {
  if (activeCol && capacityCol) {
    const aRaw = String(meta[activeCol] ?? '').trim()
    const cRaw = String(meta[capacityCol] ?? '').trim()
    const aNum = parseFloat(aRaw.replace(/,/g, ''))
    const cNum = parseFloat(cRaw.replace(/,/g, ''))
    if (!isNaN(aNum) && !isNaN(cNum) && cNum > 0) {
      return { pct: (aNum / cNum) * 100, activeRaw: aRaw, capRaw: cRaw }
    }
  }
  if (capacityCol) {
    const raw = String(meta[capacityCol] ?? '').trim()
    const m = raw.match(/^(\d+)\s*[\/\-]\s*(\d+)$/)
    if (m) { const a = parseInt(m[1]), c = parseInt(m[2]); if (c > 0) return { pct: (a / c) * 100, activeRaw: m[1], capRaw: m[2] } }
    const p = raw.match(/^(\d+(?:\.\d+)?)\s*%?$/)
    if (p) return { pct: parseFloat(p[1]), activeRaw: raw, capRaw: '' }
  }
  return { pct: -1, activeRaw: '', capRaw: '' }
}

function pctColor(pct: number): string {
  if (pct < 0) return '#64748b'
  if (pct <= 25) return '#22c55e'
  if (pct <= 50) return '#3b82f6'
  if (pct <= 75) return '#eab308'
  return '#ef4444'
}

const PCT_RANGES = [
  { label: 'Capacity 0-25%', min: 0, max: 25, color: '#22c55e' },
  { label: 'Capacity 26-50%', min: 26, max: 50, color: '#3b82f6' },
  { label: 'Capacity 51-75%', min: 51, max: 75, color: '#eab308' },
  { label: 'Capacity 76-100%', min: 76, max: 100, color: '#ef4444' },
]

function getPctLabel(pct: number): string {
  if (pct < 0) return 'Capacity 0-25%'
  if (pct <= 25) return 'Capacity 0-25%'
  if (pct <= 50) return 'Capacity 26-50%'
  if (pct <= 75) return 'Capacity 51-75%'
  return 'Capacity 76-100%'
}

/// Type untuk photo yang sudah di-preload
interface PointPhoto {
  thumbUrl: string | null
  url: string
  fileName: string
}

function buildPlacemark(
  p: any,
  mc: { nameCol1: string; nameCol2: string; capacityCol: string; activeCol: string; availCol: string; labelCols?: string[] },
  meta: Record<string, any>,
  photos: PointPhoto[]
): string {
  const { pct, activeRaw, capRaw } = calcPct(meta, mc.activeCol, mc.capacityCol)
  const color = pctColor(pct)
  const rows: string[] = []

  if (mc.availCol && meta[mc.availCol] && mc.availCol !== mc.activeCol) {
    rows.push(`<tr><td class="l">${escapeXml(mc.availCol)}</td><td class="v">${escapeXml(String(meta[mc.availCol]))}</td></tr>`)
  }
  const skipCols = new Set([mc.nameCol1, mc.nameCol2, mc.capacityCol, mc.activeCol, mc.availCol].filter(Boolean))
  for (const [k, v] of Object.entries(meta)) {
    if (skipCols.has(k) || !v || v === '') continue
    rows.push(`<tr><td class="l">${escapeXml(k)}</td><td class="v">${escapeXml(String(v))}</td></tr>`)
  }

  let name = ''
  if (mc.labelCols && mc.labelCols.length > 0) {
    name = mc.labelCols.map(c => String(meta[c] || '')).filter(Boolean).join(' - ')
  }
  if (!name) {
    name = mc.nameCol1 && meta[mc.nameCol1]
      ? [meta[mc.nameCol1], mc.nameCol2 ? meta[mc.nameCol2] : ''].filter(Boolean).join(' - ')
      : meta['name'] || meta['Name'] || meta['NAMA'] || meta['nama'] || meta['KODE'] || meta['kode'] || 'Point'
  }

  const barHtml = pct >= 0 ? `
        <div style="padding:10px 14px;background:rgba(255,255,255,0.15);border-radius:0 0 6px 6px;border:1px solid rgba(255,255,255,0.1);border-top:1px solid rgba(255,255,255,0.2);margin:0 2px 10px 2px;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:15px;margin-bottom:6px;color:#e0e8f0;">
            <span style="font-weight:600;">${escapeXml(mc.activeCol || 'Active')}: <b style="color:#ffffff;">${escapeXml(activeRaw)}</b> / ${escapeXml(capRaw)}</span>
            <span style="font-size:20px;font-weight:800;color:${color};text-shadow:0 1px 3px rgba(0,0,0,0.4);">${Math.round(pct)}%</span>
          </div>
          <div style="background:rgba(0,0,0,0.35);border-radius:5px;height:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.12);">
            <div style="background:linear-gradient(to bottom,${color}cc,${color});height:100%;width:${Math.min(pct, 100)}%;border-radius:4px;"></div>
          </div>
        </div>` : ''

  // ── PHOTO THUMBNAIL SECTION untuk Google Earth popup ──
  let photoHtml = ''
  if (photos.length > 0) {
    const maxPhotos = Math.min(photos.length, 6)
    const thumbs = photos.slice(0, maxPhotos).map(ph => {
      const imgUrl = escapeXml(ph.thumbUrl || ph.url)
      return `<a href="${escapeXml(ph.url)}" style="display:inline-block;margin:2px;border-radius:6px;overflow:hidden;border:2px solid rgba(255,255,255,0.3);box-shadow:0 2px 8px rgba(0,0,0,0.3);"><img src="${imgUrl}" style="width:110px;height:82px;object-fit:cover;display:block;" /></a>`
    }).join('')
    const moreLabel = photos.length > maxPhotos ? `<span style="color:rgba(255,255,255,0.6);font-size:11px;margin-left:6px;">+${photos.length - maxPhotos} foto</span>` : ''
    photoHtml = `
        <div style="margin:8px 2px 10px 2px;padding:8px 10px;background:rgba(255,255,255,0.1);border-radius:6px;border:1px solid rgba(255,255,255,0.08);">
          <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.7);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">${escapeXml(String(photos.length))} Foto</div>
          <div style="display:flex;flex-wrap:wrap;align-items:center;">${thumbs}${moreLabel}</div>
        </div>`
  }

  const styleUrl = pct >= 0 ? `#s-${pct <= 25 ? 'g' : pct <= 50 ? 'b' : pct <= 75 ? 'y' : 'r'}` : '#s-default'
  return `      <Placemark>
        <name>${escapeXml(String(name))}</name>
        <description><![CDATA[<div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:16px;color:#ffffff;min-width:405px;max-height:450px;overflow-y:auto;line-height:1.5;">
  <div style="background:linear-gradient(180deg,rgba(80,120,180,0.78) 0%,rgba(40,65,110,0.82) 40%,rgba(20,40,80,0.88) 100%);border:1px solid rgba(160,200,255,0.45);border-radius:8px;padding:0;margin:0;-webkit-box-shadow:0 4px 20px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.25);box-shadow:0 4px 20px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.25);">
    <div style="height:4px;background:linear-gradient(90deg,${color},${color});border-radius:8px 8px 0 0;opacity:0.9;"></div>
    <div style="position:relative;">
      <div style="position:absolute;top:0;left:0;right:0;height:50%;background:linear-gradient(180deg,rgba(255,255,255,0.18) 0%,rgba(255,255,255,0.04) 100%);pointer-events:none;border-radius:0 0 8px 8px;"></div>
      <div style="padding:14px 16px 4px 16px;position:relative;">
        <div style="font-size:18px;font-weight:700;color:#ffffff;text-shadow:0 1px 4px rgba(0,0,0,0.4);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.15);letter-spacing:0.3px;">${escapeXml(String(name))}</div>
 ${barHtml}
${photoHtml}
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <style>td.l{color:rgba(200,220,255,0.8);padding:4px 12px 4px 0;white-space:nowrap;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;width:40%;}td.v{color:#ffffff;padding:4px 0;font-weight:500;text-shadow:0 1px 2px rgba(0,0,0,0.3);font-size:14px;}tr+tr td{border-top:1px solid rgba(255,255,255,0.06);}</style>
          ${rows.join('\n          ')}
        </table>
      </div>
    </div>
    <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent);"></div>
  </div>
</div>]]></description>
        <styleUrl>${styleUrl}</styleUrl>
        <Point><coordinates>${p.longitude},${p.latitude},0</coordinates></Point>
      </Placemark>`
}

// ── Bangun folder persentase (level paling dalam) ──
function buildPctFolders(items: any[], mc: any, photoMap: Map<string, PointPhoto[]>, indent: string): string {
  const pctGroups: Record<string, any[]> = {}
  for (const item of items) {
    const meta = (item.metadata as Record<string, any>) || {}
    const { pct } = calcPct(meta, mc.activeCol, mc.capacityCol)
    const label = getPctLabel(pct)
    if (!pctGroups[label]) pctGroups[label] = []
    pctGroups[label].push(item)
  }
  let xml = ''
  for (const pr of PCT_RANGES) {
    const group = pctGroups[pr.label]
    if (!group || group.length === 0) continue
    xml += `${indent}<Folder>
 ${indent}  <name>${pr.label} (${group.length})</name>
`
    for (const item of group) {
      xml += buildPlacemark(item, mc, (item.metadata as Record<string, any>) || {}, photoMap.get(item.id) || [])
    }
    xml += `${indent}</Folder>\n`
  }
  return xml
}

// ── Bangun folder filter secara rekursif ──
function buildGroupFolders(items: any[], fields: string[], mc: any, photoMap: Map<string, PointPhoto[]>, indent: string): string {
  if (fields.length === 0) {
    return buildPctFolders(items, mc, photoMap, indent)
  }
  const field = fields[0]
  const remaining = fields.slice(1)
  const groups = new Map<string, any[]>()
  for (const item of items) {
    const meta = (item.metadata as Record<string, any>) || {}
    const key = String(meta[field] || '(kosong)')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))
  let xml = ''
  for (const key of sortedKeys) {
    const groupItems = groups.get(key)!
    xml += `${indent}<Folder>
 ${indent}  <name>${escapeXml(key)} (${groupItems.length})</name>
`
    xml += buildGroupFolders(groupItems, remaining, mc, photoMap, indent + '  ')
    xml += `${indent}</Folder>\n`
  }
  return xml
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') || ''
  const hasCoord = searchParams.get('hasCoord') || ''
  const nameCol1 = searchParams.get('nameCol1') || ''
  const nameCol2 = searchParams.get('nameCol2') || ''
  const capacityCol = searchParams.get('capacityCol') || ''
  const activeCol = searchParams.get('activeCol') || ''
  const availCol = searchParams.get('availCol') || ''
  const groupByRaw = searchParams.get('groupBy') || ''
  const labelColsRaw = searchParams.get('labelCols') || ''
  const labelCols = labelColsRaw ? labelColsRaw.split(',').map(s => s.trim()).filter(Boolean) : []
  const idsRaw = searchParams.get('ids') || ''
  const includePhotos = searchParams.get('photos') !== 'false' // default: include photos
  const mc = { nameCol1, nameCol2, capacityCol, activeCol, availCol, labelCols }

  const columnFilters: { field: string; values: string[] }[] = []
  for (let i = 0; i < 3; i++) {
    const field = searchParams.get(`cf${i}`) || ''
    const vals = searchParams.get(`cv${i}`) || ''
    if (field && vals) {
      const parsed = vals.split(',').map(v => v.trim()).filter(Boolean)
      if (parsed.length > 0) columnFilters.push({ field, values: parsed })
    }
  }

  const areaIds = idsRaw ? new Set(idsRaw.split(',').map(s => s.trim()).filter(Boolean)) : null

  let groupFields: string[] = []
  if (groupByRaw) {
    groupFields = groupByRaw.split(',').map(s => s.trim()).filter(Boolean)
  } else {
    for (const cf of columnFilters) {
      groupFields.push(cf.field)
    }
  }

  try {
    const active = await db.dataset.findFirst({ where: { isActive: true } })
    if (!active) {
      return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Belum Ada Data</name><description>Upload file Excel terlebih dahulu.</description></Document></kml>`,
        { headers: { 'Content-Type': 'application/vnd.google-earth.kml+xml', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' } })
    }

    const where: Prisma.DataPointWhereInput = { datasetId: active.id, latitude: { not: 0 }, longitude: { not: 0 } }
    const ands: Prisma.DataPointWhereInput[] = []

    if (areaIds && areaIds.size > 0) {
      ands.push({ id: { in: Array.from(areaIds) } })
    }
    if (hasCoord === 'true') { ands.push({ latitude: { not: 0 } }); ands.push({ longitude: { not: 0 } }) }
    else if (hasCoord === 'false') { ands.push({ OR: [{ latitude: 0 }, { longitude: 0 }] }) }
    if (search) ands.push({ metadata: { path: [], string_contains: search } })
    for (const cf of columnFilters) ands.push({ OR: cf.values.map(v => ({ metadata: { path: [cf.field], string_contains: v } })) })
    if (ands.length > 0) where.AND = ands

    const points = await db.dataPoint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50000,
      include: includePhotos ? {
        photos: {
          select: { thumbUrl: true, url: true, fileName: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      } : false,
    })

    // Build photo lookup map: pointId → Photo[]
    const photoMap = new Map<string, PointPhoto[]>()
  if (includePhotos) {
    for (const p of points) {
      if (p.photos && p.photos.length > 0) {
        photoMap.set(p.id, p.photos as unknown as PointPhoto[])
      }
    }
  }

    const IC = 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png'
    const styles = `
    <Style id="s-default"><IconStyle><scale>1.8</scale></IconStyle><LabelStyle><scale>0.95</scale><color>ff00ffff</color></LabelStyle><BalloonStyle><bgColor>00000000</bgColor></BalloonStyle></Style>
    <Style id="s-g"><IconStyle><color>ff00ff00</color><scale>1.8</scale><Icon><href>${IC}</href><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></Icon></IconStyle><LabelStyle><scale>0.95</scale><color>ff00ffff</color></LabelStyle><BalloonStyle><bgColor>00000000</bgColor></BalloonStyle></Style>
    <Style id="s-b"><IconStyle><color>ffff0000</color><scale>1.8</scale><Icon><href>${IC}</href><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></Icon></IconStyle><LabelStyle><scale>0.95</scale><color>ff00ffff</color></LabelStyle><BalloonStyle><bgColor>00000000</bgColor></BalloonStyle></Style>
    <Style id="s-y"><IconStyle><color>ff00ffff</color><scale>1.8</scale><Icon><href>${IC}</href><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></Icon></IconStyle><LabelStyle><scale>0.95</scale><color>ff00ffff</color></LabelStyle><BalloonStyle><bgColor>00000000</bgColor></BalloonStyle></Style>
    <Style id="s-r"><IconStyle><color>ff0000ff</color><scale>1.8</scale><Icon><href>${IC}</href><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></Icon></IconStyle><LabelStyle><scale>0.95</scale><color>ff00ffff</color></LabelStyle><BalloonStyle><bgColor>00000000</bgColor></BalloonStyle></Style>`

    // Bangun folder hierarki: filter1 > filter2 > ... > Capacity %
    let foldersXml = ''
    if (groupFields.length > 0) {
      foldersXml = buildGroupFolders(points, groupFields, mc, photoMap, '    ')
    } else {
      foldersXml = buildPctFolders(points, mc, photoMap, '    ')
    }

    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(active.name)}</name><description>${escapeXml(active.name)} - ${points.length} titik</description>${styles}${foldersXml}</Document></kml>`

    return new NextResponse(kml, {
      headers: {
        'Content-Type': 'application/vnd.google-earth.kml+xml',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    })
  } catch (error) {
    console.error('KML error:', error)
    return NextResponse.json({ error: 'Gagal generate KML' }, { status: 500 })
  }
}