import { NextResponse } from "next/server";

type ProfileRole = "admin" | "teacher";
type ApprovalStatus = "pending" | "approved";

type ProfileRow = {
  id: string;
  full_name: string;
  role: ProfileRole;
  approval_status: ApprovalStatus;
};

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token." }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase approval environment variables are missing." },
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
      return NextResponse.json({ error: "Only approved admins can approve accounts." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as
      | { profileId?: string; role?: ProfileRole }
      | null;

    const profileId = body?.profileId?.trim() ?? "";
    const role = body?.role === "admin" ? "admin" : "teacher";

    if (!profileId) {
      return NextResponse.json({ error: "Missing profile id." }, { status: 400 });
    }

    const updatedRows = await updateProfileApproval(supabaseUrl, serviceRoleKey, profileId, role);
    if (!updatedRows[0]) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    return NextResponse.json({ profile: mapProfile(updatedRows[0]) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not approve account." },
      { status: 500 },
    );
  }
}

async function updateProfileApproval(
  supabaseUrl: string,
  serviceRoleKey: string,
  profileId: string,
  role: ProfileRole,
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/hd_profiles?id=eq.${profileId}`, {
    body: JSON.stringify({
      approval_status: "approved",
      role,
    }),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    method: "PATCH",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Could not update approval.");
  }

  return (await response.json()) as ProfileRow[];
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

function mapProfile(row: ProfileRow) {
  return {
    approvalStatus: row.approval_status,
    fullName: row.full_name,
    id: row.id,
    role: row.role,
  };
}
