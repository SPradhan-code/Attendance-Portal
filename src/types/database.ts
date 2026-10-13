// ── Primitive types ──────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'student';
export type AttendanceStatus = 'present' | 'late' | 'absent';
export type AuthenticatorTransportFuture =
  | 'ble'
  | 'cable'
  | 'hybrid'
  | 'internal'
  | 'nfc'
  | 'smart-card'
  | 'usb';

// ── Domain interfaces ────────────────────────────────────────────────────────

/**
 * Shape stored in `profiles.webauthn_credential` JSONB column.
 * All Uint8Arrays are serialised as base64url strings.
 */
export type WebAuthnCredential = {
  /** base64url-encoded credential ID */
  id: string;
  /** base64url-encoded COSE public key */
  publicKey: string;
  /** Signature counter — incremented on every assertion */
  counter: number;
  /** Transport hints */
  transports?: AuthenticatorTransportFuture[];
  /** Authenticator AAGUID (device model identifier) */
  aaguid?: string;
  /** ISO timestamp when the credential was registered */
  registeredAt: string;
};

export type Profile = {
  id: string;
  role: UserRole;
  name: string;
  email?: string | null;
  roll_number?: string | null;
  webauthn_credential: WebAuthnCredential | null;
  created_at: string;
  updated_at: string;
};

export type Class = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  start_time: string;
  end_time: string;
  professor_id: string;
  created_at: string;
  session_latitude?: number | null;
  session_longitude?: number | null;
  session_altitude?: number | null;
  session_floor?: number | null;
  session_token_secret?: string | null;
  is_session_active?: boolean | null;
  session_started_at?: string | null;
};

export type Attendance = {
  id: string;
  class_id: string;
  student_id: string;
  timestamp: string;
  status: AttendanceStatus;
  verified_latitude?: number | null;
  verified_longitude?: number | null;
  verified_altitude?: number | null;
  distance_meters?: number | null;
  altitude_diff_meters?: number | null;
  verification_method?: string | null;
};

// ── Supabase Database generic ────────────────────────────────────────────────
//
// This must satisfy the shape expected by @supabase/supabase-js v2.
// Each table needs Row, Insert, Update, and Relationships.
// Views need Row and Relationships.
//
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          role?: UserRole;
          name: string;
          email?: string | null;
          roll_number?: string | null;
          webauthn_credential?: WebAuthnCredential | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          role?: UserRole;
          name?: string;
          email?: string | null;
          roll_number?: string | null;
          webauthn_credential?: WebAuthnCredential | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      classes: {
        Row: Class;
        Insert: {
          id?: string;
          name: string;
          latitude: number;
          longitude: number;
          radius_meters?: number;
          start_time: string;
          end_time: string;
          professor_id: string;
          created_at?: string;
          session_latitude?: number | null;
          session_longitude?: number | null;
          session_altitude?: number | null;
          session_floor?: number | null;
          session_token_secret?: string | null;
          is_session_active?: boolean | null;
          session_started_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          latitude?: number;
          longitude?: number;
          radius_meters?: number;
          start_time?: string;
          end_time?: string;
          professor_id?: string;
          session_latitude?: number | null;
          session_longitude?: number | null;
          session_altitude?: number | null;
          session_floor?: number | null;
          session_token_secret?: string | null;
          is_session_active?: boolean | null;
          session_started_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'classes_professor_id_fkey';
            columns: ['professor_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      attendance: {
        Row: Attendance;
        Insert: {
          id?: string;
          class_id: string;
          student_id: string;
          timestamp?: string;
          status?: AttendanceStatus;
          verified_latitude?: number | null;
          verified_longitude?: number | null;
          verified_altitude?: number | null;
          distance_meters?: number | null;
          altitude_diff_meters?: number | null;
          verification_method?: string | null;
        };
        Update: {
          status?: AttendanceStatus;
          verified_latitude?: number | null;
          verified_longitude?: number | null;
          verified_altitude?: number | null;
          distance_meters?: number | null;
          altitude_diff_meters?: number | null;
          verification_method?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'attendance_class_id_fkey';
            columns: ['class_id'];
            referencedRelation: 'classes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attendance_student_id_fkey';
            columns: ['student_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      passkeys: {
        Row: {
          id: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter: number;
          created_at?: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          credential_id?: string;
          public_key?: string;
          counter?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'passkeys_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_passkeys: {
        Row: {
          id: string;
          user_id: string;
          credential_id?: string;
          public_key?: string;
          counter?: number;
          transports?: AuthenticatorTransportFuture[] | string[] | null;
          aaguid?: string | null;
          created_at?: string;
        };
        Insert: {
          id: string;
          user_id: string;
          credential_id?: string;
          public_key?: string;
          counter?: number;
          transports?: AuthenticatorTransportFuture[] | string[] | null;
          aaguid?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          credential_id?: string;
          public_key?: string;
          counter?: number;
          transports?: AuthenticatorTransportFuture[] | string[] | null;
          aaguid?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_passkeys_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      webauthn_challenges: {
        Row: {
          id?: string;
          user_id: string;
          challenge: string;
          expires_at: string;
          created_at?: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          challenge: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          challenge?: string;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      active_classes: {
        Row: Class;
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      attendance_status: AttendanceStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
