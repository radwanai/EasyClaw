import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { config } from "../config";

export interface TenantSecrets {
  google?: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope: string;
    token_type: string;
  };
}

let smClient: SecretsManagerClient | null = null;
let cachedSecrets: TenantSecrets | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function getClient(): SecretsManagerClient {
  if (!smClient) {
    smClient = new SecretsManagerClient({ region: config.awsRegion });
  }
  return smClient;
}

export async function loadSecrets(): Promise<TenantSecrets> {
  if (!config.secretsId) {
    console.log("[secrets] No SECRETS_ID configured, returning empty secrets");
    cachedSecrets = {};
    return cachedSecrets;
  }

  try {
    const client = getClient();
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: config.secretsId })
    );

    if (response.SecretString) {
      cachedSecrets = JSON.parse(response.SecretString);
      console.log(`[secrets] Loaded secrets for tenant ${config.tenantId}`);
    } else {
      cachedSecrets = {};
    }
  } catch (err: any) {
    if (err.name === "ResourceNotFoundException") {
      console.warn(`[secrets] Secret ${config.secretsId} not found, starting with empty secrets`);
      cachedSecrets = {};
    } else {
      console.error("[secrets] Failed to load secrets:", err.message);
      throw err;
    }
  }

  return cachedSecrets!;
}

export async function updateSecrets(
  updates: Partial<TenantSecrets>
): Promise<void> {
  if (!config.secretsId) {
    console.warn("[secrets] No SECRETS_ID configured, cannot update secrets");
    return;
  }

  const current = cachedSecrets || {};
  const merged = { ...current, ...updates };

  const client = getClient();
  await client.send(
    new PutSecretValueCommand({
      SecretId: config.secretsId,
      SecretString: JSON.stringify(merged),
    })
  );

  cachedSecrets = merged;
  console.log(`[secrets] Updated secrets for tenant ${config.tenantId}`);
}

export function getSecrets(): TenantSecrets {
  return cachedSecrets || {};
}

export function startPeriodicRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(async () => {
    try {
      await loadSecrets();
    } catch (err: any) {
      console.error("[secrets] Periodic refresh failed:", err.message);
    }
  }, config.secretRefreshIntervalMs);
}

export function stopPeriodicRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
