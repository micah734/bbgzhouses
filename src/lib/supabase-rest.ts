import { HouseName, Student, Transaction } from "@/lib/sample-data";

type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
  };
};

export type SupabaseSession = {
  access_token: string;
  refresh_token?: string;
  user: SupabaseUser;
};

export type SupabaseRole = "admin" | "teacher";

export type SupabaseProfile = {
  id: string;
  fullName: string;
  role: SupabaseRole;
};

export type SupabaseInvite = {
  email: string;
  role: SupabaseRole;
  invitedBy: string | null;
  invitedUserId: string | null;
  acceptedAt: string | null;
  createdAt: string;
};

type HouseDeckData = {
  invites: SupabaseInvite[];
  profile: SupabaseProfile | null;
  students: Student[];
  transactions: Transaction[];
};

type SupabaseStudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  grade: number;
  family_id: string | null;
  house: HouseName;
  points: number;
};

type SupabaseTransactionRow = {
  id: string;
  student_id: string;
  points: number;
  category: string;
  reason: string;
  teacher_name: string;
  created_at: string;
};

type SupabaseProfileRow = {
  id: string;
  full_name: string;
  role: SupabaseRole;
};

type SupabaseInviteRow = {
  email: string;
  role: SupabaseRole;
  invited_by: string | null;
  invited_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
};

const sessionKey = "housedeck.supabase.session";

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getStoredSession() {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(sessionKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SupabaseSession;
  } catch {
    window.localStorage.removeItem(sessionKey);
    return null;
  }
}

export function storeSession(session: SupabaseSession | null) {
  if (typeof window === "undefined") return;

  if (!session) {
    window.localStorage.removeItem(sessionKey);
    return;
  }

  window.localStorage.setItem(sessionKey, JSON.stringify(session));
}

export async function signInWithPassword(email: string, password: string) {
  const response = await supabaseFetch("/auth/v1/token?grant_type=password", {
    body: JSON.stringify({ email, password }),
    method: "POST",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error_description || payload.msg || "Sign in failed.");
  }

  return payload as SupabaseSession;
}

export async function signUpWithPassword(email: string, password: string, fullName: string) {
  const response = await supabaseFetch("/auth/v1/signup", {
    body: JSON.stringify({
      email,
      password,
      data: { full_name: fullName },
    }),
    method: "POST",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error_description || payload.msg || "Sign up failed.");
  }

  const session = payload.session ?? payload;
  if (!session.access_token || !session.user) {
    throw new Error("Account created. Check email confirmation before signing in.");
  }

  return session as SupabaseSession;
}

export async function ensureProfile(session: SupabaseSession, fullName?: string) {
  const name =
    fullName ||
    session.user.user_metadata?.full_name ||
    session.user.email ||
    "HouseDeck User";

  const existingProfile = await fetchProfile(session.access_token, session.user.id);
  const existingInvite = session.user.email
    ? await fetchInviteForEmail(session.access_token, session.user.email)
    : null;
  const fallbackRole = existingProfile
    ? existingProfile.role
    : (await shouldBootstrapAdmin(session.access_token))
      ? "admin"
      : "teacher";
  const nextRole = existingInvite?.role ?? fallbackRole;

  await restFetch(
    "/hd_profiles?on_conflict=id",
    session.access_token,
    {
      body: JSON.stringify({
        id: session.user.id,
        full_name: name,
        role: nextRole,
      }),
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      method: "POST",
    },
  );

  if (existingInvite && !existingInvite.acceptedAt) {
    await restFetch(`/hd_user_invites?email=eq.${encodeURIComponent(existingInvite.email)}`, session.access_token, {
      body: JSON.stringify({
        accepted_at: new Date().toISOString(),
        invited_user_id: session.user.id,
      }),
      method: "PATCH",
    });
  }
}

export async function loadHouseDeckData(accessToken: string, userId: string) {
  const profile = await fetchProfile(accessToken, userId);
  const [studentsResponse, transactionsResponse, invitesResponse] = await Promise.all([
    restFetch("/hd_students?active=eq.true&order=last_name.asc", accessToken),
    restFetch("/hd_point_transactions?order=created_at.desc&limit=100", accessToken),
    profile?.role === "admin"
      ? restFetch("/hd_user_invites?order=created_at.desc", accessToken)
      : Promise.resolve(null),
  ]);

  const [studentRows, transactionRows, inviteRows] = await Promise.all([
    studentsResponse.json() as Promise<SupabaseStudentRow[]>,
    transactionsResponse.json() as Promise<SupabaseTransactionRow[]>,
    invitesResponse
      ? (invitesResponse.json() as Promise<SupabaseInviteRow[]>)
      : Promise.resolve([]),
  ]);

  return {
    invites: inviteRows.map(mapInvite),
    profile,
    students: studentRows.map(mapStudent),
    transactions: transactionRows.map(mapTransaction),
  } satisfies HouseDeckData;
}

export async function createTeacherInvite(
  accessToken: string,
  input: { email: string; role: SupabaseRole },
) {
  const response = await fetch("/api/invitations", {
    body: JSON.stringify(input),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload && typeof payload.error === "string" && payload.error) ||
        "Could not send invite.",
    );
  }

  return payload as { invite: SupabaseInvite };
}

export async function createSupabaseStudent(
  accessToken: string,
  student: Omit<Student, "id">,
) {
  const response = await restFetch("/hd_students", accessToken, {
    body: JSON.stringify({
      first_name: student.firstName,
      last_name: student.lastName,
      grade: student.grade,
      family_id: student.familyId || null,
      house: student.house,
      points: student.points,
    }),
    headers: {
      Prefer: "return=representation",
    },
    method: "POST",
  });
  const rows = (await response.json()) as SupabaseStudentRow[];
  return mapStudent(rows[0]);
}

export async function updateSupabaseStudent(
  accessToken: string,
  student: Student,
) {
  const response = await restFetch(`/hd_students?id=eq.${student.id}`, accessToken, {
    body: JSON.stringify({
      first_name: student.firstName,
      last_name: student.lastName,
      grade: student.grade,
      family_id: student.familyId || null,
      house: student.house,
    }),
    headers: {
      Prefer: "return=representation",
    },
    method: "PATCH",
  });
  const rows = (await response.json()) as SupabaseStudentRow[];
  if (!rows[0]) return student;

  return mapStudent(rows[0]);
}

export async function importSupabaseStudents(
  accessToken: string,
  students: Array<Omit<Student, "id">>,
) {
  const response = await restFetch("/hd_students", accessToken, {
    body: JSON.stringify(
      students.map((student) => ({
        first_name: student.firstName,
        last_name: student.lastName,
        grade: student.grade,
        family_id: student.familyId || null,
        house: student.house,
        points: student.points,
      })),
    ),
    headers: {
      Prefer: "return=representation",
    },
    method: "POST",
  });
  const rows = (await response.json()) as SupabaseStudentRow[];
  return rows.map(mapStudent);
}

export async function awardSupabasePoints({
  accessToken,
  category,
  points,
  reason,
  student,
  teacherName,
}: {
  accessToken: string;
  category: string;
  points: number;
  reason: string;
  student: Student;
  teacherName: string;
}) {
  const updatedPoints = student.points + points;

  const transactionResponse = await restFetch("/hd_point_transactions", accessToken, {
    body: JSON.stringify({
      student_id: student.id,
      points,
      category,
      reason,
      teacher_name: teacherName,
    }),
    headers: {
      Prefer: "return=representation",
    },
    method: "POST",
  });

  const updateResponse = await restFetch(`/hd_students?id=eq.${student.id}`, accessToken, {
    body: JSON.stringify({ points: updatedPoints }),
    headers: {
      Prefer: "return=representation",
    },
    method: "PATCH",
  });

  const [transactionRows, studentRows] = await Promise.all([
    transactionResponse.json() as Promise<SupabaseTransactionRow[]>,
    updateResponse.json() as Promise<SupabaseStudentRow[]>,
  ]);

  return {
    student: mapStudent(studentRows[0]),
    transaction: mapTransaction(transactionRows[0]),
  };
}

export async function resetSupabasePoints(accessToken: string) {
  await restFetch("/hd_students?active=eq.true", accessToken, {
    body: JSON.stringify({ points: 0 }),
    method: "PATCH",
  });
}

export async function archiveSupabaseTerm(
  accessToken: string,
  name: string,
  snapshot: unknown,
) {
  await restFetch("/hd_term_archives", accessToken, {
    body: JSON.stringify({ name, snapshot }),
    method: "POST",
  });
}

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    throw new Error("Supabase environment variables are missing.");
  }

  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function restFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await supabaseFetch(`/rest/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Supabase request failed.");
  }

  return response;
}

function mapStudent(row: SupabaseStudentRow): Student {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    grade: row.grade,
    familyId: row.family_id ?? undefined,
    house: row.house,
    points: row.points,
  };
}

function mapTransaction(row: SupabaseTransactionRow): Transaction {
  return {
    id: row.id,
    studentId: row.student_id,
    points: row.points,
    category: row.category,
    reason: row.reason,
    teacher: row.teacher_name || "Teacher",
    date: row.created_at.slice(0, 10),
  };
}

function mapProfile(row: SupabaseProfileRow): SupabaseProfile {
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
  };
}

function mapInvite(row: SupabaseInviteRow): SupabaseInvite {
  return {
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    email: row.email,
    invitedBy: row.invited_by,
    invitedUserId: row.invited_user_id,
    role: row.role,
  };
}

async function fetchProfile(accessToken: string, profileId?: string) {
  const query = profileId ? `/hd_profiles?id=eq.${profileId}` : "/hd_profiles?select=id,full_name,role";
  const response = await restFetch(query, accessToken, {
    headers: {
      Prefer: "return=representation",
    },
  });
  const rows = (await response.json()) as SupabaseProfileRow[];
  return rows[0] ? mapProfile(rows[0]) : null;
}

async function fetchInviteForEmail(accessToken: string, email: string) {
  const response = await restFetch(`/hd_user_invites?email=eq.${encodeURIComponent(email.toLowerCase())}`, accessToken);
  const rows = (await response.json()) as SupabaseInviteRow[];
  return rows[0] ? mapInvite(rows[0]) : null;
}

async function shouldBootstrapAdmin(accessToken: string) {
  const response = await restFetch("/hd_profiles?select=id&limit=1", accessToken);
  const rows = (await response.json()) as Array<{ id: string }>;
  return rows.length === 0;
}
