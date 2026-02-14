import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { upsertTenantSecret, ensureTenantSecret } from "@/lib/provisioner";
import { google } from "googleapis";

function getOAuth2Client(tenantId: string) {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${baseUrl}/api/tenants/${tenantId}/connect-google/callback`
  );
}

/**
 * GET: Google OAuth callback — exchange code for tokens, store in Secrets Manager
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.redirect(
      new URL("/auth/signin", process.env.NEXTAUTH_URL || "http://localhost:3000")
    );
  }

  const { tenantId } = params;
  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL(
        `/dashboard/tenants/${tenantId}?error=no_code`,
        process.env.NEXTAUTH_URL || "http://localhost:3000"
      )
    );
  }

  try {
    const oauth2 = getOAuth2Client(tenantId);
    const { tokens } = await oauth2.getToken(code);

    // Get user email for display
    oauth2.setCredentials(tokens);
    const people = google.people({ version: "v1", auth: oauth2 });
    const me = await people.people.get({
      resourceName: "people/me",
      personFields: "emailAddresses",
    });
    const email =
      me.data.emailAddresses?.[0]?.value || "unknown@example.com";

    // Ensure secret exists in Secrets Manager
    await ensureTenantSecret(tenantId);

    // Write tokens to Secrets Manager (source of truth for runtime)
    await upsertTenantSecret(tenantId, {
      google: {
        access_token: tokens.access_token || "",
        refresh_token: tokens.refresh_token || "",
        expires_at: tokens.expiry_date || 0,
        scope: tokens.scope || "",
        token_type: tokens.token_type || "Bearer",
      },
    });

    // Store connection metadata in DB (not tokens — Secrets Manager is source of truth)
    await prisma.googleConnection.upsert({
      where: { tenantId },
      create: {
        tenantId,
        email,
        scope: tokens.scope || "",
      },
      update: {
        email,
        scope: tokens.scope || "",
      },
    });

    return NextResponse.redirect(
      new URL(
        `/dashboard/tenants/${tenantId}?google=connected`,
        process.env.NEXTAUTH_URL || "http://localhost:3000"
      )
    );
  } catch (err: any) {
    console.error("[google-callback] Error:", err);
    return NextResponse.redirect(
      new URL(
        `/dashboard/tenants/${tenantId}?error=google_auth_failed`,
        process.env.NEXTAUTH_URL || "http://localhost:3000"
      )
    );
  }
}
