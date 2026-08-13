import { NextRequest, NextResponse } from 'next/server'

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const host = searchParams.get('host') || ''
  const protocol = searchParams.get('protocol') || 'http'
  const refreshMinutes = parseInt(searchParams.get('refresh') || '5')

  // Forward SEMUA params kecuali host/protocol/refresh
  const skipParams = new Set(['host', 'protocol', 'refresh'])
  const paramsParts: string[] = []
  for (const [key, value] of searchParams.entries()) {
    if (!skipParams.has(key) && value) {
      paramsParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    }
  }
  const filterStr = paramsParts.length > 0 ? '?' + paramsParts.join('&') : ''

  let kmlDataUrl: string
  if (host) {
    kmlDataUrl = `${protocol}://${host}/api/kml${filterStr}`
  } else {
    const reqHost = req.headers.get('host') || 'localhost:3000'
    const reqProto = req.headers.get('x-forwarded-proto') || 'http'
    kmlDataUrl = `${reqProto}://${reqHost}/api/kml${filterStr}`
  }

  // FIX: escape URL untuk XML (<href> tidak boleh ada & mentah)
  const safeUrl = escapeXml(kmlDataUrl)

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <NetworkLink>
    <name>ODP Map Viewer - Real-time</name>
    <description>Data realtime. Auto-refresh setiap ${refreshMinutes} menit.</description>
    <refreshVisibility>0</refreshVisibility>
    <flyToView>0</flyToView>
    <Link>
      <href>${safeUrl}</href>
      <refreshMode>onInterval</refreshMode>
      <refreshInterval>${refreshMinutes * 60}</refreshInterval>
      <viewRefreshMode>never</viewRefreshMode>
    </Link>
  </NetworkLink>
</kml>`

  return new NextResponse(kml, {
    headers: {
      'Content-Type': 'application/vnd.google-earth.kml+xml',
      'Content-Disposition': 'attachment; filename="odp-realtime.kml"',
    },
  })
}
