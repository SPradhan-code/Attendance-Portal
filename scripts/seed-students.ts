/**
 * Mock Student Seeding Script
 * Run with: npm run seed:students
 *
 * Generates and seeds realistic student records (Name, Roll Number, Email)
 * into Supabase Auth and Profiles tables in bulk.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// ── 1. Load .env.local if present ──────────────────────────────
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 2. Mock Student Dataset ────────────────────────────────────
const MOCK_STUDENTS = [
  { name: 'Aarav Sharma', rollNumber: '2024BCS001', email: 'aarav.sharma@campus.edu' },
  { name: 'Aditi Patel', rollNumber: '2024BCS002', email: 'aditi.patel@campus.edu' },
  { name: 'Rohan Mehta', rollNumber: '2024BCS003', email: 'rohan.mehta@campus.edu' },
  { name: 'Priya Nair', rollNumber: '2024BCS004', email: 'priya.nair@campus.edu' },
  { name: 'Vikram Singh', rollNumber: '2024BCS005', email: 'vikram.singh@campus.edu' },
  { name: 'Ananya Verma', rollNumber: '2024BCS006', email: 'ananya.verma@campus.edu' },
  { name: 'Rahul Gupta', rollNumber: '2024BCS007', email: 'rahul.gupta@campus.edu' },
  { name: 'Sneha Iyer', rollNumber: '2024BCS008', email: 'sneha.iyer@campus.edu' },
  { name: 'Arjun Reddy', rollNumber: '2024BCS009', email: 'arjun.reddy@campus.edu' },
  { name: 'Kavya Deshmukh', rollNumber: '2024BCS010', email: 'kavya.deshmukh@campus.edu' },
  { name: 'Devansh Joshi', rollNumber: '2024BCS011', email: 'devansh.joshi@campus.edu' },
  { name: 'Ishita Roy', rollNumber: '2024BCS012', email: 'ishita.roy@campus.edu' },
  { name: 'Siddharth Sen', rollNumber: '2024BCS013', email: 'siddharth.sen@campus.edu' },
  { name: 'Riya Banerjee', rollNumber: '2024BCS014', email: 'riya.banerjee@campus.edu' },
  { name: 'Manish Choudhary', rollNumber: '2024BCS015', email: 'manish.choudhary@campus.edu' },
  { name: 'Tanvi Kapoor', rollNumber: '2024BCS016', email: 'tanvi.kapoor@campus.edu' },
  { name: 'Kabir Bhattacharya', rollNumber: '2024BCS017', email: 'kabir.bhatt@campus.edu' },
  { name: 'Diya Kulkarni', rollNumber: '2024BCS018', email: 'diya.kulkarni@campus.edu' },
  { name: 'Yash Vardhan', rollNumber: '2024BCS019', email: 'yash.vardhan@campus.edu' },
  { name: 'Meera Pillai', rollNumber: '2024BCS020', email: 'meera.pillai@campus.edu' },
];

async function seedStudents() {
  console.log('\n🚀 Starting Bulk Student Seeding...');
  console.log(`📡 Supabase Endpoint: ${SUPABASE_URL}`);
  console.log(`📋 Total students to seed: ${MOCK_STUDENTS.length}\n`);

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const student of MOCK_STUDENTS) {
    try {
      // 1. Check if auth user exists
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
      let user = listData?.users?.find((u) => u.email?.toLowerCase() === student.email.toLowerCase());

      if (!user) {
        // Create user in Supabase Auth
        const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: student.email,
          password: `StudentPass!${student.rollNumber.slice(-3)}`,
          email_confirm: true,
          user_metadata: {
            full_name: student.name,
            roll_number: student.rollNumber,
          },
        });

        if (createErr) {
          console.error(`  ❌ Failed to create auth for ${student.email}: ${createErr.message}`);
          errorCount++;
          continue;
        }
        user = createData.user;
        createdCount++;
      } else {
        updatedCount++;
      }

      // 2. Upsert profile record
      const { error: profileErr } = await (supabaseAdmin.from('profiles') as any).upsert(
        {
          id: user.id,
          name: student.name,
          email: student.email,
          roll_number: student.rollNumber,
          role: 'student',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

      if (profileErr) {
        console.error(`  ❌ Failed to upsert profile for ${student.rollNumber}: ${profileErr.message}`);
        errorCount++;
      } else {
        console.log(`  ✓ [${student.rollNumber}] ${student.name.padEnd(20)} (${student.email})`);
      }
    } catch (err: unknown) {
      console.error(`  ❌ Error processing ${student.rollNumber}:`, err);
      errorCount++;
    }
  }

  console.log('\n========================================');
  console.log('🎉 Student Seeding Completed!');
  console.log(`   - New Students Created: ${createdCount}`);
  console.log(`   - Profiles Updated:     ${updatedCount}`);
  console.log(`   - Errors:               ${errorCount}`);
  console.log('========================================\n');
}

seedStudents().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});
