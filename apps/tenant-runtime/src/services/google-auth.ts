import { google } from "googleapis";
import { getSecrets, updateSecrets, TenantSecrets } from "./secrets";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

export function getOAuth2Client() {
  const oauth2 = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  const secrets = getSecrets();
  if (secrets.google) {
    oauth2.setCredentials({
      access_token: secrets.google.access_token,
      refresh_token: secrets.google.refresh_token,
      expiry_date: secrets.google.expires_at,
      token_type: secrets.google.token_type,
      scope: secrets.google.scope,
    });
  }

  return oauth2;
}

export async function ensureValidToken(): Promise<boolean> {
  const secrets = getSecrets();
  if (!secrets.google?.refresh_token) {
    return false;
  }

  const now = Date.now();
  // Refresh if token expires within 5 minutes
  if (secrets.google.expires_at && secrets.google.expires_at > now + 5 * 60 * 1000) {
    return true; // token is still valid
  }

  try {
    const oauth2 = getOAuth2Client();
    const { credentials } = await oauth2.refreshAccessToken();

    const updatedGoogle: TenantSecrets["google"] = {
      access_token: credentials.access_token || "",
      refresh_token: credentials.refresh_token || secrets.google.refresh_token,
      expires_at: credentials.expiry_date || 0,
      scope: secrets.google.scope,
      token_type: credentials.token_type || "Bearer",
    };

    await updateSecrets({ google: updatedGoogle });
    console.log("[google-auth] Token refreshed and saved to Secrets Manager");
    return true;
  } catch (err: any) {
    console.error("[google-auth] Token refresh failed:", err.message);
    return false;
  }
}
