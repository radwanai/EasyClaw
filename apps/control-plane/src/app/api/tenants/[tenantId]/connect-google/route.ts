import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

function getOAuth2Client(tenantId: string) {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${baseUrl}/api/tenants/${tenantId}/connect-google/callback`
  );
}

/**
 * GET: Redirect to Google OAuth consent screen
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const oauth2 = getOAuth2Client(params.tenantId);
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: params.tenantId,
  });

  return NextResponse.redirect(url);
}
