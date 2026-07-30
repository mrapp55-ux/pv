export interface SidecarGroup {
  id: string;
  name: string;
  created_at: number;
}

export interface SecurityQuestion {
  question: string;
  answer: string;
}

export interface PasswordHistoryEntry {
  password: string;
  changed_at: number;
}

export interface SidecarEntry {
  id: string;
  title: string;
  username: string | null;
  password: string;
  url: string | null;
  notes: string | null;
  security_questions: SecurityQuestion[] | null;
  group_id: string | null;
  modified_at: number;
  password_history: PasswordHistoryEntry[];
}

export interface SidecarPayload {
  version: number;
  groups: SidecarGroup[];
  entries: SidecarEntry[];
}
