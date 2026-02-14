/**
 * Unified provisioner module.
 * Uses mock AWS when USE_MOCK_PROVISIONER=true, real AWS otherwise.
 */

import * as realSecrets from "./aws/secrets-manager";
import * as realEcs from "./aws/ecs";
import * as mock from "./aws/mock-provisioner";

const useMock = process.env.USE_MOCK_PROVISIONER === "true";

export const ensureTenantSecret = useMock
  ? mock.ensureTenantSecret
  : realSecrets.ensureTenantSecret;

export const upsertTenantSecret = useMock
  ? mock.upsertTenantSecret
  : realSecrets.upsertTenantSecret;

export const getTenantSecretArn = useMock
  ? mock.getTenantSecretArn
  : realSecrets.getTenantSecretArn;

export const provisionTenantEcsService = useMock
  ? mock.provisionTenantEcsService
  : realEcs.provisionTenantEcsService;

export const getTenantRuntimeStatus = useMock
  ? mock.getTenantRuntimeStatus
  : realEcs.getTenantRuntimeStatus;

export { useMock };
