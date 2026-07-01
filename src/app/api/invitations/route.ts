import { NextResponse } from "next/server";

type InviteRole = "admin" | "teacher";

type ProfileRow = {
  full_name: string;
  role: InviteRole;
};

type InviteRow = {
  accepted_at: string | null;
  created_at: string;
  email: string;
  invited_by: string | null;
  invited_user_id: string | null;
  role: InviteRole;
};

type InviteEmailDelivery =
  | { status: "sent" }
  | { status: "pending"; message: string };

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
        { error: "Supabase invite environment variables are missing." },
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
    const profileRows = await restAdminFetch<ProfileRow[]>(
      supabaseUrl,
      serviceRoleKey,
      `/rest/v1/hd_profiles?id=eq.${user.id}&select=role,full_name`,
    );
    const profile = profileRows[0];

    if (!profile || profile.role !== "admin") {
      return NextResponse.json({ error: "Only admins can invite teachers." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as
      | { email?: string; role?: InviteRole }
      | null;
    const normalizedEmail = body?.email?.trim().toLowerCase() ?? "";
    const role = body?.role === "admin" ? "admin" : "teacher";

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const inviteRows = await writeAdminInvite(supabaseUrl, serviceRoleKey, {
      email: normalizedEmail,
      invited_by: user.id,
      role,
    });

    const redirectTo = new URL("/", request.url).toString();
    const emailDelivery = await sendAuthInviteEmail(
      supabaseUrl,
      serviceRoleKey,
      normalizedEmail,
      {
        app_name: "HouseDeck",
        invited_by: profile.full_name || "HouseDeck Admin",
        role,
      },
      redirectTo,
    );

    return NextResponse.json({
      emailDelivery,
      invite: mapInvite(inviteRows[0]),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save invite." },
      { status: 500 },
    );
  }
}

async function writeAdminInvite(
  supabaseUrl: string,
  serviceRoleKey: string,
  invite: { email: string; invited_by: string; role: InviteRole },
) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/hd_user_invites?on_conflict=email`,
    {
      body: JSON.stringify({
        ...invite,
        accepted_at: null,
        invited_user_id: null,
      }),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Could not store invite.");
  }

  return (await response.json()) as InviteRow[];
}

async function sendAuthInviteEmail(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string,
  data?: Record<string, string>,
  redirectTo?: string,
): Promise<InviteEmailDelivery> {
  const response = await fetch(`${supabaseUrl}/auth/v1/invite`, {
    body: JSON.stringify({
      data,
      email,
      redirect_to: redirectTo,
    }),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const message = await response.text();
    if (
      response.status === 429 ||
      /email rate limit exceeded|over_email_send_rate_limit/i.test(message)
    ) {
      return {
        status: "pending",
        message:
          "Invite saved, but Supabase is temporarily rate-limiting emails. The email may arrive shortly, or you can try again in a bit.",
      };
    }

    if (response.status === 504 || /request timed out|deadline exceeded/i.test(message)) {
      return {
        status: "pending",
        message:
          "Invite saved, but Supabase email delivery timed out. The email may still arrive shortly.",
      };
    }

    throw new Error(message || "Could not send invite email.");
  }

  return { status: "sent" };
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

function mapInvite(row: InviteRow) {
  return {
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    email: row.email,
    invitedBy: row.invited_by,
    invitedUserId: row.invited_user_id,
    role: row.role,
  };
}
