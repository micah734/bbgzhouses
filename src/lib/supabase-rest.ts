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
export type SupabaseApprovalStatus = "pending" | "approved";

export type SupabaseProfile = {
  id: string;
  fullName: string;
  role: SupabaseRole;
  approvalStatus: SupabaseApprovalStatus;
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
  pendingProfiles: SupabaseProfile[];
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
  student_id: string | null;
  house: HouseName | null;
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
  approval_status: SupabaseApprovalStatus;
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

export function isSupabaseSessionExpiredError(error: unknown) {
  if (!(error instanceof Error)) return false;

  return (
    error.message.includes("JWT expired") ||
    error.message.includes("PGRST303") ||
    error.message.includes("SESSION_EXPIRED")
  );
}

export async function signInWithPassword(email: string, password: string) {
  const response = await supabaseFetch("/auth/v1/token?grant_type=password", {
    body: JSON.stringify({ email, password }),
    method: "POST",
  });
  const payload = await readJsonResponse<{
    error_description?: string;
    msg?: string;
  }>(response);

  if (!response.ok) {
    throw new Error(payload.error_description || payload.msg || "Sign in failed.");
  }

  return payload as SupabaseSession;
}

export async function signUpWithPassword(email: string, password: string, fullName: string) {
  const response = await fetch("/api/auth/signup", {
    body: JSON.stringify({
      email,
      password,
      fullName,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await readJsonResponse<{
    error?: string;
    session?: SupabaseSession;
  }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "Sign up failed.");
  }

  const session = payload.session;
  if (!session?.access_token || !session.user) {
    throw new Error("Account created, but sign-in did not finish automatically.");
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
  const fallbackRole = existingProfile?.role ?? "teacher";
  const nextRole = existingInvite?.role ?? fallbackRole;
  const nextApprovalStatus = existingProfile?.approvalStatus ?? "pending";

  await restFetch(
    "/hd_profiles?on_conflict=id",
    session.access_token,
    {
      body: JSON.stringify({
        id: session.user.id,
        full_name: name,
        role: nextRole,
        approval_status: nextApprovalStatus,
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
  const canAccessSchoolData = profile?.approvalStatus === "approved";
  const isAdmin = profile?.role === "admin" && canAccessSchoolData;
  const [studentsResponse, transactionsResponse, invitesResponse, pendingProfilesResponse] = await Promise.all([
    canAccessSchoolData
      ? restFetch("/hd_students?active=eq.true&order=last_name.asc", accessToken)
      : Promise.resolve(null),
    canAccessSchoolData
      ? restFetch("/hd_point_transactions?order=created_at.desc&limit=100", accessToken)
      : Promise.resolve(null),
    isAdmin
      ? restFetch("/hd_user_invites?order=created_at.desc", accessToken)
      : Promise.resolve(null),
    isAdmin
      ? restFetch("/hd_profiles?approval_status=eq.pending&order=created_at.asc", accessToken)
      : Promise.resolve(null),
  ]);

  const [studentRows, transactionRows, inviteRows, pendingProfileRows] = await Promise.all([
    studentsResponse
      ? (studentsResponse.json() as Promise<SupabaseStudentRow[]>)
      : Promise.resolve([]),
    transactionsResponse
      ? (transactionsResponse.json() as Promise<SupabaseTransactionRow[]>)
      : Promise.resolve([]),
    invitesResponse
      ? (invitesResponse.json() as Promise<SupabaseInviteRow[]>)
      : Promise.resolve([]),
    pendingProfilesResponse
      ? (pendingProfilesResponse.json() as Promise<SupabaseProfileRow[]>)
      : Promise.resolve([]),
  ]);

  return {
    invites: inviteRows.map(mapInvite),
    pendingProfiles: pendingProfileRows.map(mapProfile),
    profile,
    students: studentRows.map(mapStudent),
    transactions: transactionRows.map(mapTransaction),
  } satisfies HouseDeckData;
}

export async function approveSupabaseProfile(
  accessToken: string,
  input: { profileId: string; role: SupabaseRole },
) {
  const response = await fetch("/api/profile-approvals", {
    body: JSON.stringify(input),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = await readOptionalJsonResponse<{ error?: string; profile: SupabaseProfile }>(response);
  if (!response.ok) {
    throw new Error(
      (payload && typeof payload.error === "string" && payload.error) ||
        "Could not approve account.",
    );
  }

  return payload as { profile: SupabaseProfile };
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

  const payload = await readOptionalJsonResponse<{
    error?: string;
    emailDelivery?: { status: "sent" } | { status: "pending"; message: string };
    invite: SupabaseInvite;
    inviteLink?: string | null;
  }>(response);
  if (!response.ok) {
    throw new Error(
      (payload && typeof payload.error === "string" && payload.error) ||
        "Could not send invite.",
    );
  }

  return payload as {
    emailDelivery?: { status: "sent" } | { status: "pending"; message: string };
    invite: SupabaseInvite;
    inviteLink?: string | null;
  };
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

export async function awardSupabaseHousePoints({
  accessToken,
  category,
  house,
  points,
  reason,
  teacherName,
}: {
  accessToken: string;
  category: string;
  house: HouseName;
  points: number;
  reason: string;
  teacherName: string;
}) {
  const response = await restFetch("/hd_point_transactions", accessToken, {
    body: JSON.stringify({
      student_id: null,
      house,
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

  const rows = (await response.json()) as SupabaseTransactionRow[];
  return mapTransaction(rows[0]);
}

export async function undoSupabaseTransaction(accessToken: string, transactionId: string) {
  const response = await fetch(`/api/transactions/${transactionId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    method: "DELETE",
  });
  const payload = await readOptionalJsonResponse<{ error?: string }>(response);

  if (!response.ok) {
    const message =
      payload && typeof payload.error === "string" ? payload.error : "Could not undo that transaction.";
    if (
      response.status === 401 ||
      message.includes("JWT expired") ||
      message.includes("PGRST303")
    ) {
      throw new Error("SESSION_EXPIRED");
    }
    throw new Error(message);
  }
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

async function readJsonResponse<T>(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("Received an empty response from Supabase.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Received an unexpected response while contacting Supabase: ${text.slice(0, 120)}`);
  }
}

async function readOptionalJsonResponse<T>(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Received an unexpected response from the app server: ${text.slice(0, 120)}`);
  }
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
    if (
      response.status === 401 ||
      message.includes("JWT expired") ||
      message.includes("PGRST303")
    ) {
      throw new Error("SESSION_EXPIRED");
    }
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
    studentId: row.student_id ?? undefined,
    house: row.house ?? undefined,
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
    approvalStatus: row.approval_status,
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
  const query = profileId
    ? `/hd_profiles?id=eq.${profileId}`
    : "/hd_profiles?select=id,full_name,role,approval_status";
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
