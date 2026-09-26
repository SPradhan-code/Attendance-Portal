'use client';

import { useState, useEffect, useRef } from 'react';

interface ParsedStudent {
  name: string;
  rollNumber: string;
  email: string;
  isValid: boolean;
  error?: string;
}

interface EnrolledStudent {
  id: string;
  name: string;
  email: string;
  rollNumber: string;
  hasPasskey: boolean;
  createdAt: string;
}

export default function AdminStudentsPage() {
  const [activeTab, setActiveTab] = useState<'import' | 'roster'>('import');
  const [csvText, setCsvText] = useState<string>('');
  const [parsedStudents, setParsedStudents] = useState<ParsedStudent[]>([]);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    imported: number;
    updated: number;
    errors: Array<{ email: string; error: string }>;
  } | null>(null);

  // Roster state
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [isLoadingRoster, setIsLoadingRoster] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Parse CSV text into student records
  const handleParseCsv = (raw: string) => {
    setCsvText(raw);
    setImportSummary(null);

    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      setParsedStudents([]);
      return;
    }

    // Parse header
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const nameIdx = headers.findIndex((h) => h.includes('name'));
    const rollIdx = headers.findIndex((h) => h.includes('roll') || h.includes('id') || h.includes('number'));
    const emailIdx = headers.findIndex((h) => h.includes('email') || h.includes('mail'));

    if (nameIdx === -1 || rollIdx === -1 || emailIdx === -1) {
      setParsedStudents([]);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const parsed: ParsedStudent[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
      const name = cols[nameIdx] || '';
      const rollNumber = cols[rollIdx] || '';
      const email = cols[emailIdx] || '';

      let isValid = true;
      let error = '';

      if (!name) {
        isValid = false;
        error = 'Missing name';
      } else if (!rollNumber) {
        isValid = false;
        error = 'Missing roll number';
      } else if (!email || !emailRegex.test(email)) {
        isValid = false;
        error = 'Invalid email syntax';
      }

      parsed.push({ name, rollNumber, email, isValid, error });
    }

    setParsedStudents(parsed);
  };

  // Handle file drop / upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleParseCsv(content);
    };
    reader.readAsText(file);
  };

  // Sample CSV generator
  const downloadSampleCsv = () => {
    const sample =
      'Name,Roll Number,Email\n' +
      'Aarav Sharma,2024BCS001,aarav.sharma@campus.edu\n' +
      'Aditi Patel,2024BCS002,aditi.patel@campus.edu\n' +
      'Rohan Mehta,2024BCS003,rohan.mehta@campus.edu\n' +
      'Priya Nair,2024BCS004,priya.nair@campus.edu';

    const blob = new Blob([sample], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_students.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Submit bulk import to Supabase API
  const handleImportSubmit = async () => {
    const validOnes = parsedStudents.filter((s) => s.isValid);
    if (validOnes.length === 0) return;

    setIsImporting(true);
    setImportSummary(null);

    try {
      const res = await fetch('/api/admin/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: validOnes.map((s) => ({
            name: s.name,
            rollNumber: s.rollNumber,
            email: s.email,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to import students.');
      }

      setImportSummary(data.summary);
      setParsedStudents([]);
      setCsvText('');
      fetchRoster();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  // Fetch roster
  const fetchRoster = async () => {
    setIsLoadingRoster(true);
    try {
      const res = await fetch('/api/admin/students');
      const data = await res.json();
      if (res.ok && data.students) {
        setStudents(data.students);
      }
    } catch (err) {
      console.error('Failed to load roster:', err);
    } finally {
      setIsLoadingRoster(false);
    }
  };

  useEffect(() => {
    fetchRoster();
  }, []);

  const filteredStudents = students.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.rollNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8 max-w-6xl mx-auto">
      {/* Header */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a
              href="/dashboard"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition"
            >
              ← Back to Dashboard
            </a>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            👥 Bulk Student Management
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Import student cohorts via CSV, assign Roll Numbers, and monitor Passkey biometric onboarding.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('import')}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
              activeTab === 'import'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            📥 CSV Bulk Import
          </button>
          <button
            onClick={() => {
              setActiveTab('roster');
              fetchRoster();
            }}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
              activeTab === 'roster'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            📋 Student Directory ({students.length})
          </button>
        </div>
      </header>

      {/* TAB 1: CSV BULK IMPORT */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* Import summary alert */}
          {importSummary && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 backdrop-blur-md">
              <h3 className="text-sm font-bold text-emerald-300 mb-1">
                ✓ Bulk Import Completed!
              </h3>
              <p className="text-xs text-emerald-400">
                Processed {importSummary.total} records: {importSummary.imported} newly created,{' '}
                {importSummary.updated} updated, {importSummary.errors.length} errors.
              </p>
              {importSummary.errors.length > 0 && (
                <div className="mt-3 text-xs text-rose-300">
                  <span className="font-semibold">Errors:</span>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {importSummary.errors.map((e, idx) => (
                      <li key={idx}>
                        {e.email}: {e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Upload card */}
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-gray-900 to-black p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Upload Student CSV</h2>
                <p className="text-xs text-gray-400">
                  Required columns: <span className="text-indigo-300 font-mono">Name</span>,{' '}
                  <span className="text-indigo-300 font-mono">Roll Number</span>,{' '}
                  <span className="text-indigo-300 font-mono">Email</span>
                </p>
              </div>

              <button
                onClick={downloadSampleCsv}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-indigo-300 hover:bg-white/10 transition"
              >
                <span>📄</span> Download Sample CSV
              </button>
            </div>

            {/* Drag & drop / click zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="group mb-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.02] p-8 text-center transition hover:border-indigo-500 hover:bg-indigo-500/[0.05] cursor-pointer"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 text-2xl group-hover:scale-110 transition duration-200">
                📁
              </div>
              <p className="text-sm font-semibold text-white">
                Drop your CSV file here, or <span className="text-indigo-400 underline">browse</span>
              </p>
              <p className="text-xs text-gray-500 mt-1">Accepts standard .csv format</p>
            </div>

            {/* Paste alternative */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Or paste CSV text directly:
              </label>
              <textarea
                rows={4}
                value={csvText}
                onChange={(e) => handleParseCsv(e.target.value)}
                placeholder="Name,Roll Number,Email&#10;Aarav Sharma,2024BCS001,aarav.sharma@campus.edu"
                className="w-full rounded-2xl border border-white/10 bg-black/40 p-3 text-xs font-mono text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Preview table */}
            {parsedStudents.length > 0 && (
              <div className="mt-6 border-t border-white/10 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white">
                    Parsed Preview ({parsedStudents.filter((s) => s.isValid).length} valid rows)
                  </h3>
                  <button
                    onClick={handleImportSubmit}
                    disabled={isImporting || parsedStudents.filter((s) => s.isValid).length === 0}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2 text-xs font-semibold text-white shadow-lg transition hover:scale-[1.02] disabled:opacity-50"
                  >
                    {isImporting ? 'Importing to Supabase...' : `Import ${parsedStudents.filter((s) => s.isValid).length} Students`}
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/30">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-gray-400">
                        <th className="p-3">#</th>
                        <th className="p-3">Name</th>
                        <th className="p-3">Roll Number</th>
                        <th className="p-3">Email</th>
                        <th className="p-3">Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedStudents.slice(0, 15).map((row, idx) => (
                        <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="p-3 text-gray-500">{idx + 1}</td>
                          <td className="p-3 font-medium text-white">{row.name}</td>
                          <td className="p-3 font-mono text-indigo-300">{row.rollNumber}</td>
                          <td className="p-3 text-gray-400">{row.email}</td>
                          <td className="p-3">
                            {row.isValid ? (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/20">
                                Ready
                              </span>
                            ) : (
                              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-400 border border-rose-500/20">
                                {row.error}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedStudents.length > 15 && (
                    <p className="p-2 text-center text-[11px] text-gray-500">
                      ...and {parsedStudents.length - 15} more rows
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ROSTER DIRECTORY */}
      {activeTab === 'roster' && (
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-gray-900 to-black p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white">Student Roster</h2>
              <p className="text-xs text-gray-400">
                List of registered students with roll numbers and passkey registration status.
              </p>
            </div>

            <input
              type="text"
              placeholder="Search by name, roll #, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {isLoadingRoster ? (
            <div className="py-12 text-center text-xs text-gray-500">Loading student roster...</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-gray-400 bg-white/5">
                    <th className="p-3">Roll Number</th>
                    <th className="p-3">Student Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Passkey Status</th>
                    <th className="p-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="p-3 font-mono font-semibold text-indigo-300">{s.rollNumber}</td>
                      <td className="p-3 font-medium text-white">{s.name}</td>
                      <td className="p-3 text-gray-400">{s.email}</td>
                      <td className="p-3">
                        {s.hasPasskey ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/20">
                            🔐 Passkey Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/20">
                            ⚠️ Pending Passkey
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-gray-500">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {filteredStudents.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-gray-500">
                        No students found. Use the CSV bulk import tab to enroll students.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
