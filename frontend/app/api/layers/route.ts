import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function GET() {
  try {
    const resp = await fetch(`${API_URL}/layers`, {
      next: { revalidate: 300 }, // cache 5 min
    })
    if (!resp.ok) {
      return NextResponse.json({ error: await resp.text() }, { status: resp.status })
    }
    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
