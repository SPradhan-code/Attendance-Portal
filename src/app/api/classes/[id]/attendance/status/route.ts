import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import type { AttendanceStatus } from '@/types/database';

interface StatusTogglePayload {
  studentId: string;
  status: AttendanceStatus;
}

/**
 * PATCH /api/classes/[id]/attendance/status
 *
 * Allows the professor to manually toggle or override the attendance status
 * ('present', 'late', 'absent') for any student during or after the active session.
 */
export async function PATCH(
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

    const admin = createAdminClient();

    // Verify class ownership or admin role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: classRow } = await (admin.from('classes') as any)
      .select('id, professor_id')
      .eq('id', classId)
      .single();

    if (!classRow) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: userProfile } = await (admin.from('profiles') as any)
      .select('role')
      .eq('id', user.id)
      .single();

    if (classRow.professor_id !== user.id && userProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const body: StatusTogglePayload = await request.json();
    const { studentId, status } = body;

    if (!studentId || !status) {
      return NextResponse.json(
        { error: 'studentId and status are required.' },
        { status: 400 },
      );
    }

    if (!['present', 'late', 'absent'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be present, late, or absent.' },
        { status: 400 },
      );
    }

    // Check if attendance record already exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingRecord } = await (admin.from('attendance') as any)
      .select('id, status')
      .eq('class_id', classId)
      .eq('student_id', studentId)
      .maybeSingle();

    let resultRecord: any;

    if (existingRecord) {
      // Update existing record
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error: updateErr } = await (admin.from('attendance') as any)
        .update({
          status,
          verification_method: 'professor_manual_override',
        })
        .eq('id', existingRecord.id)
        .select()
        .single();

      if (updateErr) {
        console.error('[attendance/status] Update failed:', updateErr);
        return NextResponse.json(
          { error: 'Failed to update attendance status.' },
          { status: 500 },
        );
      }
      resultRecord = updated;
    } else {
      // Create new attendance record with professor manual override
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inserted, error: insertErr } = await (admin.from('attendance') as any)
        .insert({
          class_id: classId,
          student_id: studentId,
          status,
          verification_method: 'professor_manual_override',
          timestamp: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertErr) {
        console.error('[attendance/status] Insert failed:', insertErr);
        return NextResponse.json(
          { error: 'Failed to insert attendance override.' },
          { status: 500 },
        );
      }
      resultRecord = inserted;
    }

    return NextResponse.json({
      success: true,
      message: `Student status updated to ${status}.`,
      record: resultRecord,
    });
  } catch (err) {
    console.error('[attendance/status]', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
