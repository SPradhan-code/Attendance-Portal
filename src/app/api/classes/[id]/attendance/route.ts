import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

/**
 * GET /api/classes/[id]/attendance
 *
 * Retrieves real-time check-ins for the active class session,
 * joined with student profile information (name, roll number, email).
 * Accessible only to the class professor or admin.
 */
export async function GET(
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

    // Verify user owns the class or is admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: classRow } = await (admin.from('classes') as any)
      .select('id, name, professor_id, is_session_active, session_floor')
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

    // 1. Fetch all attendance records for this class
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: attendanceList, error: attErr } = await (admin.from('attendance') as any)
      .select(`
        id,
        class_id,
        student_id,
        timestamp,
        status,
        verified_latitude,
        verified_longitude,
        verified_altitude,
        distance_meters,
        altitude_diff_meters,
        verification_method,
        profiles (
          id,
          name,
          email,
          roll_number
        )
      `)
      .eq('class_id', classId)
      .order('timestamp', { ascending: false });

    if (attErr) {
      console.error('[classes/attendance] Error fetching attendance:', attErr);
      return NextResponse.json(
        { error: 'Failed to fetch attendance.' },
        { status: 500 },
      );
    }

    // 2. Fetch all registered students to show complete cohort
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allStudents } = await (admin.from('profiles') as any)
      .select('id, name, email, roll_number')
      .eq('role', 'student')
      .order('roll_number', { ascending: true, nullsFirst: false });

    const attendanceMap = new Map<string, any>();
    (attendanceList || []).forEach((att: any) => {
      attendanceMap.set(att.student_id, att);
    });

    // Merge into complete roster
    const roster = (allStudents || []).map((student: any) => {
      const record = attendanceMap.get(student.id);
      if (record) {
        return {
          studentId: student.id,
          name: student.name,
          email: student.email,
          rollNumber: student.roll_number || 'N/A',
          isCheckedIn: true,
          attendanceId: record.id,
          status: record.status,
          timestamp: record.timestamp,
          distanceMeters: record.distance_meters,
          altitudeDiffMeters: record.altitude_diff_meters,
          verificationMethod: record.verification_method || 'webauthn_geofence_3d',
        };
      }
      return {
        studentId: student.id,
        name: student.name,
        email: student.email,
        rollNumber: student.roll_number || 'N/A',
        isCheckedIn: false,
        attendanceId: null,
        status: 'absent' as const,
        timestamp: null,
        distanceMeters: null,
        altitudeDiffMeters: null,
        verificationMethod: null,
      };
    });

    const presentCount = roster.filter((r: any) => r.status === 'present').length;
    const lateCount = roster.filter((r: any) => r.status === 'late').length;
    const absentCount = roster.filter((r: any) => r.status === 'absent').length;

    return NextResponse.json({
      classId,
      className: classRow.name,
      isSessionActive: classRow.is_session_active,
      summary: {
        totalStudents: roster.length,
        checkedInCount: presentCount + lateCount,
        presentCount,
        lateCount,
        absentCount,
      },
      roster,
    });
  } catch (err) {
    console.error('[classes/attendance]', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
