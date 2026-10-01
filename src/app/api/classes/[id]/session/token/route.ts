import { createAdminClient } from '@/lib/supabase/admin';
import { generateRotatingToken, ROTATING_WINDOW_MS } from '@/lib/crypto/session-token';
import { NextResponse } from 'next/server';

/**
 * GET /api/classes/[id]/session/token
 *
 * Returns the current 3-second rotating cryptographic token
 * and check-in target URL for the active class session.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: classId } = await params;
    const admin = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: classRow, error: fetchErr } = await (admin.from('classes') as any)
      .select('id, name, session_token_secret, is_session_active, session_latitude, session_longitude, session_floor')
      .eq('id', classId)
      .single();

    if (fetchErr || !classRow) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 });
    }

    if (!classRow.is_session_active) {
      return NextResponse.json(
        { error: 'Session is not currently active.' },
        { status: 400 },
      );
    }

    const secret =
      classRow.session_token_secret ||
      process.env.SESSION_SECRET ||
      'attendance-default-secret-key-32b';

    const now = Date.now();
    const { token, timeStep, expiresAt } = generateRotatingToken(
      classId,
      secret,
      now,
    );

    const host =
      request.headers.get('x-forwarded-host') ||
      request.headers.get('host') ||
      process.env.VERCEL_URL ||
      new URL(request.url).host;
    const proto =
      request.headers.get('x-forwarded-proto') ||
      new URL(request.url).protocol.replace(':', '');
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;

    const checkInUrl = `${baseUrl}/check-in?classId=${classId}&token=${token}&step=${timeStep}`;

    return NextResponse.json({
      token,
      timeStep,
      expiresAt,
      timeRemainingMs: Math.max(0, expiresAt - now),
      intervalMs: ROTATING_WINDOW_MS,
      checkInUrl,
      classInfo: {
        id: classRow.id,
        name: classRow.name,
        floor: classRow.session_floor,
      },
    });
  } catch (err) {
    console.error('[session/token]', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
