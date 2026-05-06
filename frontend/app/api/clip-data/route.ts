import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const resp = await fetch(`${API_URL}/clip-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const contentType = resp.headers.get('content-type') || ''

    if (!resp.ok) {
      const err = await resp.text()
      return NextResponse.json({ error: err }, { status: resp.status })
    }

    if (contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
      const arrayBuffer = await resp.arrayBuffer()
      return new NextResponse(arrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="geodata_clip.zip"',
        },
      })
    }

    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
