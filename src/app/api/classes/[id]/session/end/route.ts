import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

/**
 * POST /api/classes/[id]/session/end
 *
 * Marks the class session as inactive.
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

    const admin = createAdminClient();

    // Verify class ownership
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: classRow } = await (admin.from('classes') as any)
      .select('id, professor_id')
      .eq('id', classId)
      .single();

    if (!classRow || classRow.professor_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from('classes') as any)
      .update({
        is_session_active: false,
      })
      .eq('id', classId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[session/end]', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
