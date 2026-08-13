import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const datasets = await db.dataset.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return NextResponse.json(datasets)
  } catch (error) {
    console.error('Datasets error:', error)
    return NextResponse.json({ error: 'Gagal mengambil dataset' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID wajib' }, { status: 400 })

    // Cascade delete will remove all DataPoints
    await db.dataset.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error('Delete dataset error:', error)
    return NextResponse.json({ error: 'Gagal menghapus dataset' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { datasetId } = await req.json()
    if (!datasetId) return NextResponse.json({ error: 'datasetId wajib' }, { status: 400 })

    // Activate this dataset, deactivate others
    await db.$transaction([
      db.dataset.updateMany({ where: { id: { not: datasetId } }, data: { isActive: false } }),
      db.dataset.update({ where: { id: datasetId }, data: { isActive: true } }),
    ])

    return NextResponse.json({ activated: true })
  } catch (error) {
    console.error('Activate dataset error:', error)
    return NextResponse.json({ error: 'Gagal mengaktifkan dataset' }, { status: 500 })
  }
}
