// secrets-adapter.js — AWS Secrets Manager adapter for multi-tenant deployment
// When SECRETS_ID is set, tokens are read from/written to Secrets Manager
// instead of local files. Falls back to file-based storage otherwise.

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "./data";
const SECRETS_ID = process.env.SECRETS_ID || "";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

let smClient = null;

function getSecretsManagerClient() {
  if (smClient) return smClient;
  try {
    const {
      SecretsManagerClient,
    } = require("@aws-sdk/client-secrets-manager");
    smClient = new SecretsManagerClient({ region: AWS_REGION });
    return smClient;
  } catch {
    console.warn(
      "[secrets-adapter] @aws-sdk/client-secrets-manager not installed, using file storage"
    );
    return null;
  }
}

function useSecretsManager() {
  return !!SECRETS_ID && !!getSecretsManagerClient();
}

// Load secrets from Secrets Manager
async function loadFromSecretsManager() {
  const {
    GetSecretValueCommand,
  } = require("@aws-sdk/client-secrets-manager");
  const client = getSecretsManagerClient();
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: SECRETS_ID })
  );
  return res.SecretString ? JSON.parse(res.SecretString) : {};
}

// Save secrets to Secrets Manager
async function saveToSecretsManager(payload) {
  const {
    PutSecretValueCommand,
  } = require("@aws-sdk/client-secrets-manager");
  const client = getSecretsManagerClient();
  await client.send(
    new PutSecretValueCommand({
      SecretId: SECRETS_ID,
      SecretString: JSON.stringify(payload),
    })
  );
}

// Load Google tokens
async function loadGoogleToken() {
  if (useSecretsManager()) {
    try {
      const secrets = await loadFromSecretsManager();
      if (secrets.google) {
        return {
          access_token: secrets.google.access_token,
          refresh_token: secrets.google.refresh_token,
          expiry_date: secrets.google.expires_at,
          scope: secrets.google.scope,
          token_type: secrets.google.token_type,
        };
      }
    } catch (err) {
      console.error("[secrets-adapter] Failed to load from Secrets Manager:", err.message);
    }
    return null;
  }

  // Fallback to file
  const tokenFile = path.join(DATA_DIR, "gmail_token.json");
  if (!fs.existsSync(tokenFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  } catch {
    return null;
  }
}

// Save Google tokens
async function saveGoogleToken(tokens) {
  if (useSecretsManager()) {
    try {
      const secrets = await loadFromSecretsManager().catch(() => ({}));
      const merged = {
        ...secrets,
        google: {
          access_token: tokens.access_token || "",
          refresh_token: tokens.refresh_token || secrets?.google?.refresh_token || "",
          expires_at: tokens.expiry_date || 0,
          scope: tokens.scope || "",
          token_type: tokens.token_type || "Bearer",
        },
      };
      await saveToSecretsManager(merged);
      console.log("[secrets-adapter] Tokens saved to Secrets Manager");
      return;
    } catch (err) {
      console.error("[secrets-adapter] Failed to save to Secrets Manager:", err.message);
    }
  }

  // Fallback to file
  const tokenFile = path.join(DATA_DIR, "gmail_token.json");
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
  console.log("[secrets-adapter] Tokens saved to file");
}

module.exports = {
  useSecretsManager,
  loadGoogleToken,
  saveGoogleToken,
};
