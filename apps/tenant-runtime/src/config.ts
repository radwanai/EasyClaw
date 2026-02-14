export const config = {
  port: parseInt(process.env.PORT || "8080", 10),
  tenantId: process.env.TENANT_ID || "",
  awsRegion: process.env.AWS_REGION || "us-east-1",
  secretsId: process.env.SECRETS_ID || "",
  controlPlaneSharedSecret: process.env.CONTROL_PLANE_SHARED_SECRET || "",
  secretRefreshIntervalMs: 5 * 60 * 1000, // refresh secrets every 5 minutes
};

export function validateConfig(): void {
  if (!config.tenantId) {
    throw new Error("TENANT_ID environment variable is required");
  }
  if (!config.controlPlaneSharedSecret) {
    throw new Error("CONTROL_PLANE_SHARED_SECRET environment variable is required");
  }
  if (!config.secretsId) {
    console.warn("SECRETS_ID not set — Google API features will be unavailable until secrets are provisioned");
  }
}
