import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; redirectTo?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  // Always use the public production callback. This prevents reset emails
  // requested from a local development tab from containing localhost links.
  const redirectTo = "https://bbgzhouses.vercel.app";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address first." }, { status: 400 });
  }

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: "Supabase environment variables are missing." }, { status: 500 });
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    body: JSON.stringify({ email, redirect_to: redirectTo }),
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error_description?: string; msg?: string } | null;
    return NextResponse.json(
      { error: payload?.error_description || payload?.msg || "Password reset request failed." },
      { status: response.status },
    );
  }

  return NextResponse.json({ ok: true });
}
