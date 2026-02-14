import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  DescribeSecretCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const PROJECT = process.env.PROJECT_NAME || "clawdbot";

function secretName(tenantId: string): string {
  return `${PROJECT}/tenant/${tenantId}`;
}

export interface TenantSecretPayload {
  google?: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope: string;
    token_type: string;
  };
}

/**
 * Ensure a Secrets Manager secret exists for the tenant.
 * Returns the secret ARN.
 */
export async function ensureTenantSecret(tenantId: string): Promise<string> {
  const name = secretName(tenantId);

  try {
    const desc = await client.send(
      new DescribeSecretCommand({ SecretId: name })
    );
    return desc.ARN!;
  } catch (err: any) {
    if (err instanceof ResourceNotFoundException) {
      const res = await client.send(
        new CreateSecretCommand({
          Name: name,
          SecretString: JSON.stringify({}),
          Description: `Tenant secrets for ${tenantId}`,
          Tags: [
            { Key: "project", Value: PROJECT },
            { Key: "tenantId", Value: tenantId },
          ],
        })
      );
      console.log(`[secrets-manager] Created secret for tenant ${tenantId}`);
      return res.ARN!;
    }
    throw err;
  }
}

/**
 * Upsert the secret value for a tenant.
 */
export async function upsertTenantSecret(
  tenantId: string,
  payload: TenantSecretPayload
): Promise<void> {
  const name = secretName(tenantId);

  // Get current value and merge
  let current: TenantSecretPayload = {};
  try {
    const res = await client.send(
      new GetSecretValueCommand({ SecretId: name })
    );
    if (res.SecretString) {
      current = JSON.parse(res.SecretString);
    }
  } catch (err: any) {
    if (!(err instanceof ResourceNotFoundException)) {
      throw err;
    }
    // Secret doesn't exist yet, will create
    await ensureTenantSecret(tenantId);
  }

  const merged = { ...current, ...payload };

  await client.send(
    new PutSecretValueCommand({
      SecretId: name,
      SecretString: JSON.stringify(merged),
    })
  );

  console.log(`[secrets-manager] Updated secret for tenant ${tenantId}`);
}

/**
 * Get secret ARN for a tenant (without fetching the value).
 */
export async function getTenantSecretArn(
  tenantId: string
): Promise<string | null> {
  const name = secretName(tenantId);
  try {
    const desc = await client.send(
      new DescribeSecretCommand({ SecretId: name })
    );
    return desc.ARN || null;
  } catch {
    return null;
  }
}
