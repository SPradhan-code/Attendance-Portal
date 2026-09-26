# 🎓 Attendance Portal

A next-generation, biometric-secured student attendance system built with **Next.js 15**, **Supabase**, and **WebAuthn**. It combines fingerprint authentication, 3D geofencing, rotating QR codes, and a live professor control panel into a single production-ready platform.

---

## ✨ Features

### 🔐 WebAuthn Biometric Authentication
- **Admin/Professor login** via device passkey (fingerprint, Face ID, Windows Hello)
- **Student attendance verification** requires on-device biometric confirmation
- Zero-password architecture — credentials never leave the device
- Built with `@simplewebauthn/browser` + `@simplewebauthn/server`

### 📍 3D Geofenced Check-In
- Captures student **latitude, longitude, and altitude** at check-in
- **Haversine formula** validates horizontal distance ≤ 15 meters from the classroom
- **Altitude delta** validation (≤ 3 metres) blocks students on different floors
- Professor's live location is automatically captured when a session starts

### 🔄 Rotating QR Codes
- QR code regenerates every **3 seconds** using an HMAC-SHA256 token
- Tokens are cryptographically signed and time-windowed — replaying an old QR fails
- QR is projected by the professor and scanned by students on their phones

### ⏰ Time-Lock Validation
- Server enforces attendance only within the class `start_time` → `end_time` window
- Requests outside the window receive a `403 Forbidden` with a clear error message
- No client-side clock trust — all validation is server-side

### 🖥️ Professor Active Session Control Panel
- **Real-time roster** showing each student's check-in status (Present / Absent / Late)
- **Manual override** — toggle any student's attendance with one click
- Live updates via polling — no page refresh needed
- Session can be ended manually or automatically by the time lock

### 👥 Bulk Student Management
- CSV import UI for batch student enrollment
- Seed script (`npm run seed:students`) for development data
- Roll number support and section-level grouping

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Database / Auth | Supabase (PostgreSQL + Row Level Security) |
| Biometrics | WebAuthn (`@simplewebauthn`) |
| QR Code | `qrcode.react` |
| Geolocation | Browser `navigator.geolocation` API |
| Styling | Tailwind CSS |
| Deployment | Vercel (recommended) |

---

## 📂 Project Structure

```
attendance-portal/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Landing / home page
│   │   ├── login/                    # Professor WebAuthn login
│   │   ├── dashboard/                # Professor class-schedule dashboard
│   │   ├── admin/                    # Bulk student management UI
│   │   ├── check-in/                 # Student QR scan → biometric check-in
│   │   ├── settings/                 # Profile & passkey settings
│   │   └── api/
│   │       ├── webauthn/             # Registration & authentication challenge routes
│   │       ├── attendance/
│   │       │   ├── check-in/         # Student check-in (geofence + time-lock + biometric)
│   │       │   └── mark/             # Manual mark route (professor override)
│   │       ├── classes/
│   │       │   └── [id]/
│   │       │       ├── session/      # Start / stop a class session
│   │       │       └── attendance/   # Roster feed & status toggle
│   │       └── admin/                # Student import & management
│   ├── components/
│   │   ├── AdminSessionManager.tsx   # QR projector + session controls
│   │   ├── ActiveSessionControl.tsx  # Live roster + manual overrides
│   │   ├── AttendanceWebAuthn.tsx    # Student biometric check-in widget
│   │   └── WebAuthnButton.tsx        # Reusable passkey button
│   ├── hooks/                        # Custom React hooks
│   ├── lib/
│   │   ├── crypto/session-token.ts   # HMAC rotating QR token
│   │   ├── geo/geofence.ts           # Haversine + altitude validation
│   │   ├── supabase/                 # Supabase client helpers
│   │   └── webauthn/                 # Server-side WebAuthn helpers
│   ├── types/database.ts             # Supabase table type definitions
│   └── middleware.ts                 # Route protection
├── supabase/
│   └── migrations/
│       ├── 001_schema.sql            # Core tables (professors, classes, students, attendance)
│       ├── 002_webauthn.sql          # Passkey credential storage
│       └── 003_session_geofence_and_students.sql  # 3D coords, session state, roll numbers
├── scripts/
│   └── seed-students.ts             # Bulk student seeding script
└── public/
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- HTTPS (required for WebAuthn) — use `ngrok` or Vercel for local testing

### 1. Clone the Repository

```bash
git clone https://github.com/SPradhan-code/Attendance-Portal.git
cd Attendance-Portal/attendance-portal
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# WebAuthn — must match your domain exactly
NEXT_PUBLIC_APP_URL=https://your-domain.com
WEBAUTHN_RP_ID=your-domain.com
WEBAUTHN_RP_NAME=Attendance Portal

# QR Token signing secret (generate with: openssl rand -hex 32)
SESSION_SECRET=your-32-byte-hex-secret
```

### 3. Run Database Migrations

Using the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref your-project-ref
supabase db push
```

Or paste each file in `supabase/migrations/` into the Supabase SQL Editor in order:
1. `001_schema.sql`
2. `002_webauthn.sql`
3. `003_session_geofence_and_students.sql`

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For WebAuthn to work locally, tunnel via HTTPS:

```bash
npx ngrok http 3000
# Then update NEXT_PUBLIC_APP_URL and WEBAUTHN_RP_ID in .env.local
```

### 5. (Optional) Seed Student Data

```bash
npm run seed:students
```

---

## 🔄 Workflows

### Professor Flow

```
1. Navigate to /login
2. Authenticate with device passkey (fingerprint / Face ID)
3. Select a class from the dashboard
4. Click "Start Session" → browser captures GPS location automatically
5. Rotating QR code appears on screen (refreshes every 3 seconds)
6. Monitor live check-ins on the Active Session Control panel
7. Manually override any student's status if needed
8. Session auto-locks when class end_time is reached
```

### Student Flow

```
1. Scan the professor's QR code with phone camera
2. Browser opens /check-in?token=<rotating-token>
3. App captures student's GPS (lat, lng, altitude)
4. Server validates:
   a. Token is fresh (≤ 3s window)
   b. Horizontal distance ≤ 15 m (Haversine formula)
   c. Altitude delta ≤ 3 m (same floor check)
   d. Current time is within class start_time → end_time
5. Biometric prompt appears (fingerprint / passkey)
6. On success, attendance is recorded in Supabase
```

---

## 🗃️ Database Schema Overview

### `professors`
Stores professor accounts linked to Supabase Auth users.

### `classes`
Each row is a scheduled class with `start_time`, `end_time`, geolocation columns (`session_lat`, `session_lng`, `session_altitude`), and `session_active` flag.

### `students`
Student roster with roll number, section, and enrollment info.

### `attendance`
Records per-student, per-class attendance with status (`present` / `late` / `absent`), check-in timestamp, and captured coordinates for audit.

### `webauthn_credentials`
Stores WebAuthn public keys and counters for passkey holders (professors and students).

---

## 🛡️ Security Model

| Threat | Mitigation |
|---|---|
| Static QR screenshot replay | HMAC token rotates every 3 s; server rejects expired tokens |
| Out-of-building check-in | Haversine distance + altitude validation |
| Wrong floor check-in | Altitude delta ≤ 3 m enforced server-side |
| Proxy / friend check-in | WebAuthn biometric must match registered device credential |
| After-class submission | Server-side time-lock rejects requests outside window |
| Stolen session token | Short-lived HMAC window + single-use enforcement |
| Password attacks | Zero-password — WebAuthn only |

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/webauthn/register/options` | Begin passkey registration |
| `POST` | `/api/webauthn/register/verify` | Complete passkey registration |
| `POST` | `/api/webauthn/authenticate/options` | Begin passkey login challenge |
| `POST` | `/api/webauthn/authenticate/verify` | Verify passkey & issue session |
| `POST` | `/api/attendance/check-in` | Student check-in (geofence + time-lock + biometric) |
| `POST` | `/api/attendance/mark` | Professor manual attendance mark |
| `POST` | `/api/classes/[id]/session` | Start / stop a class session |
| `GET` | `/api/classes/[id]/attendance` | Fetch live attendance roster |
| `PATCH` | `/api/classes/[id]/attendance/status` | Toggle student attendance status |
| `POST` | `/api/admin/students` | Bulk import students |

---

## 🧪 Scripts

```bash
npm run dev            # Start development server
npm run build          # Production build
npm run lint           # ESLint check
npm run seed:students  # Seed sample student data into Supabase
```

---

## 🚢 Deployment (Vercel)

1. Push to GitHub (this repo)
2. Import project in [Vercel Dashboard](https://vercel.com/new)
3. Add all environment variables from `.env.local`
4. Deploy — Vercel handles HTTPS automatically

> **Important**: Update `WEBAUTHN_RP_ID` and `NEXT_PUBLIC_APP_URL` to your Vercel production domain before deploying.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgements

- [SimpleWebAuthn](https://simplewebauthn.dev/) — WebAuthn library
- [Supabase](https://supabase.com/) — Backend as a Service
- [Next.js](https://nextjs.org/) — React framework
- [qrcode.react](https://github.com/zpao/qrcode.react) — QR code rendering
