import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * POST /api/attendance/mark
 *
 * Body: { class_id: string }
 *
 * Inserts an attendance record. RLS on the `attendance` table enforces:
 *  - student_id = auth.uid()
 *  - student role + registered passkey
 *  - now() strictly between class start_time and end_time
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { class_id } = await request.json();
    if (!class_id) {
      return NextResponse.json({ error: 'class_id is required.' }, { status: 400 });
    }

    // ── Server Time-Lock Validation Safeguard ───────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: classRow, error: classLookupErr } = await (supabase.from('classes') as any)
      .select('name, start_time, end_time')
      .eq('id', class_id)
      .single();

    if (classLookupErr || !classRow) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 });
    }

    const serverNow = new Date();
    const startTime = new Date(classRow.start_time);
    const endTime = new Date(classRow.end_time);

    if (serverNow < startTime) {
      return NextResponse.json(
        {
          error: `Class attendance has not opened yet. Scheduled start: ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Server clock: ${serverNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
          code: 'TIME_LOCK_PRE_CLASS',
        },
        { status: 403 },
      );
    }

    if (serverNow > endTime) {
      return NextResponse.json(
        {
          error: `Attendance window has closed. The class concluded at ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Server clock: ${serverNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
          code: 'TIME_LOCK_EXPIRED',
        },
        { status: 403 },
      );
    }

    // RLS will reject if outside the time window or missing passkey.
    // Cast to any because the Supabase typed insert type for 'attendance'
    // requires student_id to be provided explicitly in Insert shape,
    // but we supply it here while the RLS also enforces auth.uid() equality.
    const { data, error: insertErr } = await supabase
      .from('attendance')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        class_id,
        student_id: user.id,
        status: 'present',
      } as any)
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === '42501') {
        return NextResponse.json(
          {
            error:
              'Attendance window is closed. You can only mark attendance during an active class.',
          },
          { status: 403 },
        );
      }
      if (insertErr.code === '23505') {
        return NextResponse.json(
          { error: 'You have already marked attendance for this class.' },
          { status: 409 },
        );
      }
      console.error('[attendance/mark]', insertErr);
      return NextResponse.json({ error: 'Failed to record attendance.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, attendance: data });
  } catch (err) {
    console.error('[attendance/mark]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
