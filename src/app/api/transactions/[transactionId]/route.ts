import { NextResponse } from "next/server";

type ProfileRole = "admin" | "teacher";
type ApprovalStatus = "pending" | "approved";
type HouseName = "Red" | "Blue" | "Yellow" | "Green";

type ProfileRow = {
  id: string;
  full_name: string;
  role: ProfileRole;
  approval_status: ApprovalStatus;
};

type TransactionRow = {
  id: string;
  student_id: string | null;
  house: HouseName | null;
  points: number;
  category: string;
  reason: string;
  teacher_name: string;
  created_at: string;
};

type StudentRow = {
  id: string;
  points: number;
};

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/transactions/[transactionId]">,
) {
  try {
    const authHeader = request.headers.get("authorization");
    const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token." }, { status: 401 });
    }

    const { transactionId } = await context.params;
    if (!transactionId) {
      return NextResponse.json({ error: "Missing transaction id." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase transaction environment variables are missing." },
        { status: 500 },
      );
    }

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
    }

    const user = (await userResponse.json()) as { id: string };
    const adminRows = await restAdminFetch<ProfileRow[]>(
      supabaseUrl,
      serviceRoleKey,
      `/rest/v1/hd_profiles?id=eq.${user.id}&select=id,full_name,role,approval_status`,
    );
    const adminProfile = adminRows[0];

    if (!adminProfile || adminProfile.role !== "admin" || adminProfile.approval_status !== "approved") {
      return NextResponse.json({ error: "Only approved admins can undo transactions." }, { status: 403 });
    }

    const transactionRows = await restAdminFetch<TransactionRow[]>(
      supabaseUrl,
      serviceRoleKey,
      `/rest/v1/hd_point_transactions?id=eq.${encodeURIComponent(transactionId)}&select=id,student_id,house,points,category,reason,teacher_name,created_at`,
    );
    const transaction = transactionRows[0];

    if (!transaction) {
      return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }

    if (transaction.student_id) {
      const studentRows = await restAdminFetch<StudentRow[]>(
        supabaseUrl,
        serviceRoleKey,
        `/rest/v1/hd_students?id=eq.${encodeURIComponent(transaction.student_id)}&select=id,points`,
      );
      const student = studentRows[0];

      if (!student) {
        return NextResponse.json({ error: "Student not found for this transaction." }, { status: 404 });
      }

      await restAdminMutate(
        `${supabaseUrl}/rest/v1/hd_students?id=eq.${encodeURIComponent(transaction.student_id)}`,
        serviceRoleKey,
        "PATCH",
        { points: student.points - transaction.points },
      );
    }

    await restAdminMutate(
      `${supabaseUrl}/rest/v1/hd_point_transactions?id=eq.${encodeURIComponent(transactionId)}`,
      serviceRoleKey,
      "DELETE",
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not undo transaction." },
      { status: 500 },
    );
  }
}

async function restAdminFetch<T>(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Supabase admin request failed.");
  }

  return (await response.json()) as T;
}

async function restAdminMutate(
  url: string,
  serviceRoleKey: string,
  method: "PATCH" | "DELETE",
  body?: Record<string, unknown>,
) {
  const response = await fetch(url, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    method,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Supabase admin update failed.");
  }
}
