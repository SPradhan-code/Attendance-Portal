import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

/**
 * GET /api/admin/students
 *
 * Lists all student profiles with roll numbers and passkey registration status.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const admin = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: students, error } = await (admin.from('profiles') as any)
      .select('id, name, email, roll_number, role, webauthn_credential, created_at')
      .eq('role', 'student')
      .order('roll_number', { ascending: true, nullsFirst: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formatted = (students || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      rollNumber: s.roll_number || 'N/A',
      hasPasskey: !!s.webauthn_credential,
      registeredAt: s.webauthn_credential?.registeredAt || null,
      createdAt: s.created_at,
    }));

    return NextResponse.json({ students: formatted });
  } catch (err) {
    console.error('[admin/students]', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
