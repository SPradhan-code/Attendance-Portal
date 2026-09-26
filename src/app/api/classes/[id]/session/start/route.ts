import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

interface SessionStartPayload {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  floor?: number | null;
}

/**
 * POST /api/classes/[id]/session/start
 *
 * Saves the professor's live 3D coordinates (latitude, longitude, altitude)
 * and floor indicator to the class record, generates a session token secret,
 * and marks the class session active.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: classId } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    // Verify user is an admin/professor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase.from('profiles') as any)
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only professors/admins can initialize a class session.' },
        { status: 403 },
      );
    }

    const body: SessionStartPayload = await request.json();
    const { latitude, longitude, altitude = null, floor = 1 } = body;

    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      isNaN(latitude) ||
      isNaN(longitude)
    ) {
      return NextResponse.json(
        { error: 'Valid latitude and longitude are required.' },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // Verify class exists and belongs to professor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: classRow, error: fetchErr } = await (admin.from('classes') as any)
      .select('id, professor_id, session_token_secret')
      .eq('id', classId)
      .single();

    if (fetchErr || !classRow) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 });
    }

    if (classRow.professor_id !== user.id) {
      return NextResponse.json(
        { error: 'You do not have permission to manage this class.' },
        { status: 403 },
      );
    }

    // Generate or retain rotating token secret
    const secret =
      classRow.session_token_secret ||
      crypto.randomBytes(32).toString('hex');

    const updatePayload = {
      session_latitude: latitude,
      session_longitude: longitude,
      session_altitude: altitude,
      session_floor: floor ?? 1,
      session_token_secret: secret,
      is_session_active: true,
      session_started_at: new Date().toISOString(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (admin.from('classes') as any)
      .update(updatePayload)
      .eq('id', classId);

    if (updateErr) {
      console.error('[session/start] DB error:', updateErr);
      return NextResponse.json(
        { error: 'Failed to start class session.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      session: {
        classId,
        latitude,
        longitude,
        altitude,
        floor: floor ?? 1,
        startedAt: updatePayload.session_started_at,
      },
    });
  } catch (err) {
    console.error('[session/start]', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
