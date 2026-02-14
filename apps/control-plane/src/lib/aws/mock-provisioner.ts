/**
 * Mock AWS provisioner for local development.
 * Simulates AWS Secrets Manager and ECS operations without real AWS credentials.
 */

import type { ProvisionResult, RuntimeStatus } from "./ecs";
import type { TenantSecretPayload } from "./secrets-manager";

// In-memory stores
const mockSecrets: Record<string, TenantSecretPayload> = {};
const mockServices: Record<
  string,
  {
    tenantId: string;
    status: string;
    taskDefArn: string;
    serviceName: string;
    createdAt: Date;
  }
> = {};

export async function ensureTenantSecret(tenantId: string): Promise<string> {
  const arn = `arn:aws:secretsmanager:us-east-1:000000000000:secret:clawdbot/tenant/${tenantId}-mock`;
  if (!mockSecrets[tenantId]) {
    mockSecrets[tenantId] = {};
  }
  console.log(`[mock] ensureTenantSecret(${tenantId}) -> ${arn}`);
  return arn;
}

export async function upsertTenantSecret(
  tenantId: string,
  payload: TenantSecretPayload
): Promise<void> {
  mockSecrets[tenantId] = {
    ...(mockSecrets[tenantId] || {}),
    ...payload,
  };
  console.log(`[mock] upsertTenantSecret(${tenantId})`);
}

export async function getTenantSecretArn(
  tenantId: string
): Promise<string | null> {
  if (mockSecrets[tenantId] !== undefined) {
    return `arn:aws:secretsmanager:us-east-1:000000000000:secret:clawdbot/tenant/${tenantId}-mock`;
  }
  return null;
}

export async function provisionTenantEcsService(
  tenantId: string,
  secretArn: string
): Promise<ProvisionResult> {
  const serviceName = `clawdbot-tenant-${tenantId}`;
  const taskDefArn = `arn:aws:ecs:us-east-1:000000000000:task-definition/clawdbot-tenant-${tenantId}:1`;

  mockServices[tenantId] = {
    tenantId,
    status: "ACTIVE",
    taskDefArn,
    serviceName,
    createdAt: new Date(),
  };

  console.log(`[mock] provisionTenantEcsService(${tenantId})`);

  return {
    taskDefArn,
    serviceName,
    cluster: "clawdbot-cluster-mock",
  };
}

export async function getTenantRuntimeStatus(
  tenantId: string
): Promise<RuntimeStatus | null> {
  const svc = mockServices[tenantId];
  if (!svc) return null;

  return {
    serviceName: svc.serviceName,
    status: svc.status,
    runningCount: 1,
    desiredCount: 1,
    taskIp: "127.0.0.1",
  };
}

export function getMockSecrets(tenantId: string): TenantSecretPayload | null {
  return mockSecrets[tenantId] || null;
}
