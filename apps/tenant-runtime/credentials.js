// credentials.js — Encrypted credential vault for Harvey
// Stores login credentials AES-256-GCM encrypted on disk
// Key derived from VAULT_KEY in .env — never stored in code/git/prompts

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "./data";
const VAULT_FILE = path.join(DATA_DIR, "vault.enc");
const ALGORITHM = "aes-256-gcm";

// Derive a 256-bit key from the passphrase
function getKey() {
  const passphrase = process.env.VAULT_KEY;
  if (!passphrase) throw new Error("VAULT_KEY not set in .env");
  return crypto.scryptSync(passphrase, "clawdbot-vault-salt", 32);
}

// Encrypt data
function encrypt(data) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(JSON.stringify(data), "utf-8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), tag: tag.toString("hex"), data: encrypted };
}

// Decrypt data
function decrypt(payload) {
  const key = getKey();
  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(payload.data, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return JSON.parse(decrypted);
}

// Load vault from disk
function loadVault() {
  try {
    if (!fs.existsSync(VAULT_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(VAULT_FILE, "utf-8"));
    return decrypt(raw);
  } catch (err) {
    console.error("[Vault] Failed to load:", err.message);
    return {};
  }
}

// Save vault to disk
function saveVault(vault) {
  const encrypted = encrypt(vault);
  fs.writeFileSync(VAULT_FILE, JSON.stringify(encrypted));
}

// ─── Public API ──────────────────────────────────

// Save credentials for a site
// site: "amazon", "netflix", etc.
// creds: { email, password, ... any extra fields }
function saveCredentials(site, creds) {
  const vault = loadVault();
  vault[site.toLowerCase()] = {
    ...creds,
    updated: new Date().toISOString(),
  };
  saveVault(vault);
  return { saved: true, site: site.toLowerCase() };
}

// Get credentials for a site (returns { email, password, ... } or null)
function getCredentials(site) {
  const vault = loadVault();
  return vault[site.toLowerCase()] || null;
}

// List saved sites (names only, not credentials)
function listSites() {
  const vault = loadVault();
  return Object.keys(vault).map((site) => ({
    site,
    updated: vault[site].updated || "unknown",
    hasEmail: !!vault[site].email,
    hasPassword: !!vault[site].password,
  }));
}

// Delete credentials for a site
function deleteCredentials(site) {
  const vault = loadVault();
  if (!vault[site.toLowerCase()]) return { deleted: false, error: "site not found" };
  delete vault[site.toLowerCase()];
  saveVault(vault);
  return { deleted: true, site: site.toLowerCase() };
}

// Check if vault is configured
function isConfigured() {
  return !!process.env.VAULT_KEY;
}

module.exports = {
  saveCredentials,
  getCredentials,
  listSites,
  deleteCredentials,
  isConfigured,
};
