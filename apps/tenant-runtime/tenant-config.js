// tenant-config.js — Multi-tenant deployment configuration
// When TENANT_ID is set, the bot runs in "tenant mode":
// - Uses Secrets Manager for token storage
// - Responds to control-plane API calls
// - Disables interactive Telegram features (optional)

const TENANT_ID = process.env.TENANT_ID || "";
const CONTROL_PLANE_SHARED_SECRET = process.env.CONTROL_PLANE_SHARED_SECRET || "";

function isTenantMode() {
  return !!TENANT_ID;
}

function getTenantId() {
  return TENANT_ID;
}

function validateSharedSecret(headerValue) {
  if (!CONTROL_PLANE_SHARED_SECRET) return true; // no secret configured = no auth
  return headerValue === CONTROL_PLANE_SHARED_SECRET;
}

module.exports = {
  isTenantMode,
  getTenantId,
  validateSharedSecret,
  TENANT_ID,
  CONTROL_PLANE_SHARED_SECRET,
};
