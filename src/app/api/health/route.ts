import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * GET /api/health
 *
 * Lightweight health-check endpoint. Runs a minimal Supabase query
 * (SELECT 1) to verify database connectivity, then returns a JSON
 * payload with the current status and timestamp.
 *
 * Possible responses:
 *  200 { status: 'ok',    timestamp: string }
 *  503 { status: 'error', timestamp: string, error: string }
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Minimal round-trip query — no table scan, no auth required.
    const { error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          status: 'error',
          timestamp: new Date().toISOString(),
          error: error.message,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: message,
      },
      { status: 503 }
    );
  }
}
