import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

interface StudentRecordInput {
  name: string;
  rollNumber: string;
  email: string;
}

/**
 * POST /api/admin/students/import
 *
 * Bulk imports students from parsed CSV into Supabase.
 * Creates auth accounts (if needed) and upserts profiles with roll numbers.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // ── 1. Admin authorization check ──────────────────────────────
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: adminProfile } = await (supabase.from('profiles') as any)
      .select('role')
      .eq('id', user.id)
      .single();

    if (adminProfile?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden. Admin privileges required.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const students: StudentRecordInput[] = body.students;

    if (!Array.isArray(students) || students.length === 0) {
      return NextResponse.json(
        { error: 'An array of students is required.' },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const results = {
      total: students.length,
      imported: 0,
      updated: 0,
      errors: [] as Array<{ email: string; error: string }>,
    };

    for (const item of students) {
      const name = item.name?.trim();
      const rollNumber = item.rollNumber?.trim().toUpperCase();
      const email = item.email?.trim().toLowerCase();

      if (!name || !email || !rollNumber) {
        results.errors.push({
          email: email || 'unknown',
          error: 'Missing name, roll number, or email.',
        });
        continue;
      }

      try {
        // 1. Check if user already exists in profiles
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingProfile } = await (admin.from('profiles') as any)
          .select('id, email, roll_number')
          .or(`email.eq.${email},roll_number.eq.${rollNumber}`)
          .maybeSingle();

        let userId = existingProfile?.id;

        if (!userId) {
          // Create in auth.users
          const { data: createdAuth, error: createAuthErr } =
            await admin.auth.admin.createUser({
              email,
              password: `StudentPass!${rollNumber.slice(-4) || '2024'}`,
              email_confirm: true,
              user_metadata: {
                full_name: name,
                roll_number: rollNumber,
              },
            });

          if (createAuthErr) {
            // If already exists in auth but not profile, try searching auth
            if (createAuthErr.message.includes('already exists') || createAuthErr.message.includes('unique')) {
              // Try finding the user
              const { data: listData } = await admin.auth.admin.listUsers();
              const found = listData?.users?.find(
                (u) => u.email?.toLowerCase() === email,
              );
              if (found) {
                userId = found.id;
              } else {
                results.errors.push({ email, error: createAuthErr.message });
                continue;
              }
            } else {
              results.errors.push({ email, error: createAuthErr.message });
              continue;
            }
          } else if (createdAuth?.user) {
            userId = createdAuth.user.id;
          }
        }

        if (userId) {
          // Upsert into public.profiles
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: upsertErr } = await (admin.from('profiles') as any).upsert(
            {
              id: userId,
              name,
              email,
              roll_number: rollNumber,
              role: 'student',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' },
          );

          if (upsertErr) {
            results.errors.push({ email, error: upsertErr.message });
          } else {
            if (existingProfile) {
              results.updated++;
            } else {
              results.imported++;
            }
          }
        }
      } catch (err: unknown) {
        results.errors.push({
          email,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      summary: results,
    });
  } catch (err) {
    console.error('[admin/students/import]', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
