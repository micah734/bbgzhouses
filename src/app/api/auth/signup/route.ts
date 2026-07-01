import { NextResponse } from "next/server";

type SessionResponse = {
  access_token: string;
  refresh_token?: string;
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      full_name?: string;
    };
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { email?: string; password?: string; fullName?: string }
      | null;

    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";
    const fullName = body?.fullName?.trim() ?? "";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return NextResponse.json({ error: "Supabase environment variables are missing." }, { status: 500 });
    }

    const existingProfilesResponse = await fetch(`${supabaseUrl}/rest/v1/hd_profiles?select=id&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    const existingProfilesPayload = await readOptionalJson(existingProfilesResponse);
    if (!existingProfilesResponse.ok) {
      return NextResponse.json({ error: "Could not verify HouseDeck staff setup." }, { status: 500 });
    }

    const hasExistingProfiles =
      Array.isArray(existingProfilesPayload) && existingProfilesPayload.length > 0;
    const nextRole = hasExistingProfiles ? "teacher" : "admin";
    const nextApprovalStatus = hasExistingProfiles ? "pending" : "approved";

    const createUserResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
        },
      }),
    });

    const createUserPayload = await readOptionalJson(createUserResponse);

    if (!createUserResponse.ok) {
      const message =
        (createUserPayload && typeof createUserPayload.msg === "string" && createUserPayload.msg) ||
        (createUserPayload &&
          typeof createUserPayload.error_description === "string" &&
          createUserPayload.error_description) ||
        (createUserPayload && typeof createUserPayload.error === "string" && createUserPayload.error) ||
        "Could not create account.";

      return NextResponse.json({ error: message }, { status: createUserResponse.status });
    }

    const createdUserId =
      createUserPayload && typeof createUserPayload.id === "string" ? createUserPayload.id : null;

    if (!createdUserId) {
      return NextResponse.json({ error: "Supabase created the account without a user id." }, { status: 502 });
    }

    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/hd_profiles`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: createdUserId,
        full_name: fullName || email,
        role: nextRole,
        approval_status: nextApprovalStatus,
      }),
    });

    if (!profileResponse.ok) {
      const profileMessage = await profileResponse.text();
      return NextResponse.json(
        { error: profileMessage || "Could not finish setting up the HouseDeck profile." },
        { status: 500 },
      );
    }

    const sessionResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const sessionPayload = await readOptionalJson(sessionResponse);

    if (!sessionResponse.ok) {
      const message =
        (sessionPayload &&
          typeof sessionPayload.error_description === "string" &&
          sessionPayload.error_description) ||
        (sessionPayload && typeof sessionPayload.msg === "string" && sessionPayload.msg) ||
        "Account created, but automatic sign-in failed.";

      return NextResponse.json({ error: message }, { status: sessionResponse.status });
    }

    const session = sessionPayload as SessionResponse;
    if (!session.access_token || !session.user?.id) {
      return NextResponse.json(
        { error: "Account created, but Supabase did not return a session." },
        { status: 502 },
      );
    }

    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create account." },
      { status: 500 },
    );
  }
}

async function readOptionalJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Unexpected response from Supabase: ${text.slice(0, 160)}`);
  }
}
