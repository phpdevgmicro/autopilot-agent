/**
 * Encrypted Credential Vault
 *
 * Replaces plain-text credentials.json with AES-256-GCM encrypted storage.
 *
 * Key sources (in priority order):
 * 1. CUA_CREDENTIAL_KEY env var (recommended for production)
 * 2. Auto-generated machine key stored in ~/.autopilot-agent/.vault-key
 *
 * File format: credentials.vault (JSON envelope with encrypted payload)
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFile, writeFile, mkdir, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir, hostname, userInfo } from "node:os";

export type StoredCredential = {
  domain: string;
  username: string;
  password: string;
};

type VaultEnvelope = {
  version: 1;
  salt: string;   // hex — unique per vault file
  iv: string;     // hex — unique per write
  tag: string;    // hex — GCM auth tag
  data: string;   // hex — encrypted JSON
};

const ALGORITHM = "aes-256-gcm";
const SALT_BYTES = 32;
const IV_BYTES = 16;
const KEY_LENGTH = 32;

// ── Key derivation ──────────────────────────────────────────────────

const vaultKeyDir = join(homedir(), ".autopilot-agent");
const vaultKeyPath = join(vaultKeyDir, ".vault-key");

/**
 * Derive a 256-bit key from the master secret + salt using scrypt.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 });
}

/**
 * Get the master secret for encryption.
 * Priority: env var → on-disk auto-generated key.
 */
async function getMasterSecret(): Promise<string> {
  // 1. Explicit env var (best for production — set it and forget it)
  const envKey = process.env.CUA_CREDENTIAL_KEY?.trim();
  if (envKey && envKey.length >= 8) {
    return envKey;
  }

  // 2. Auto-generated machine key (convenience for local dev)
  try {
    const existing = await readFile(vaultKeyPath, "utf-8");
    if (existing.trim().length >= 32) {
      return existing.trim();
    }
  } catch {
    // File doesn't exist — generate one
  }

  // Generate a cryptographically random key
  const generatedKey = randomBytes(32).toString("hex");
  await mkdir(vaultKeyDir, { recursive: true });
  await writeFile(vaultKeyPath, generatedKey, { encoding: "utf-8", mode: 0o600 });

  // Try to restrict permissions (best-effort on Windows)
  try {
    await chmod(vaultKeyPath, 0o600);
  } catch {
    // chmod may not be fully effective on Windows — acceptable
  }

  console.log(`[credential-vault] 🔐 Generated new vault key at ${vaultKeyPath}`);
  return generatedKey;
}

// ── Encrypt / Decrypt ───────────────────────────────────────────────

function encrypt(plaintext: string, masterSecret: string): VaultEnvelope {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(masterSecret, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

function decrypt(envelope: VaultEnvelope, masterSecret: string): string {
  const salt = Buffer.from(envelope.salt, "hex");
  const iv = Buffer.from(envelope.iv, "hex");
  const tag = Buffer.from(envelope.tag, "hex");
  const encrypted = Buffer.from(envelope.data, "hex");
  const key = deriveKey(masterSecret, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Load credentials from the encrypted vault.
 * Also handles migrating old plain-text credentials.json automatically.
 */
export async function loadCredentials(profileDir: string): Promise<StoredCredential[]> {
  const vaultPath = join(profileDir, "credentials.vault");
  const legacyPath = join(profileDir, "credentials.json");
  const masterSecret = await getMasterSecret();

  // Try loading encrypted vault
  try {
    const raw = await readFile(vaultPath, "utf-8");
    const envelope: VaultEnvelope = JSON.parse(raw);

    if (envelope.version !== 1) {
      console.warn(`[credential-vault] ⚠️ Unknown vault version ${envelope.version}, skipping`);
      return [];
    }

    const decrypted = decrypt(envelope, masterSecret);
    const credentials: StoredCredential[] = JSON.parse(decrypted);
    console.log(`[credential-vault] 🔓 Loaded ${credentials.length} encrypted credential(s)`);
    return credentials;
  } catch (err) {
    // Vault doesn't exist or is corrupted — check for legacy file
    const isFileNotFound = err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
    if (!isFileNotFound) {
      console.warn(`[credential-vault] ⚠️ Failed to read vault: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Auto-migrate from plain-text credentials.json ─────────────
  try {
    const legacyRaw = await readFile(legacyPath, "utf-8");
    const legacyCredentials: StoredCredential[] = JSON.parse(legacyRaw);

    if (legacyCredentials.length > 0) {
      console.log(`[credential-vault] 🔄 Migrating ${legacyCredentials.length} credential(s) from plain-text to encrypted vault...`);

      // Save to encrypted vault
      await saveCredentials(profileDir, legacyCredentials);

      // Delete the plain-text file
      try {
        await unlink(legacyPath);
        console.log(`[credential-vault] 🗑️ Deleted plain-text credentials.json`);
      } catch {
        // Best-effort deletion
        console.warn(`[credential-vault] ⚠️ Could not delete old credentials.json — please remove it manually`);
      }

      return legacyCredentials;
    }
  } catch {
    // No legacy file either — fresh start
  }

  return [];
}

/**
 * Save credentials to the encrypted vault.
 */
export async function saveCredentials(profileDir: string, credentials: StoredCredential[]): Promise<void> {
  const vaultPath = join(profileDir, "credentials.vault");
  const masterSecret = await getMasterSecret();

  const plaintext = JSON.stringify(credentials);
  const envelope = encrypt(plaintext, masterSecret);

  await mkdir(profileDir, { recursive: true });
  await writeFile(vaultPath, JSON.stringify(envelope, null, 2), "utf-8");
}

/**
 * Add or update a single credential in the vault.
 */
export async function upsertCredential(
  profileDir: string,
  domain: string,
  username: string,
  password: string,
): Promise<boolean> {
  try {
    const existing = await loadCredentials(profileDir);

    const idx = existing.findIndex(c => c.domain === domain);
    if (idx >= 0) {
      existing[idx] = { domain, username, password };
    } else {
      existing.push({ domain, username, password });
    }

    await saveCredentials(profileDir, existing);
    console.log(`[credential-vault] 🔐 Saved encrypted credentials for ${domain}`);
    return true;
  } catch (e) {
    console.error(`[credential-vault] ❌ Failed to save credentials:`, e);
    return false;
  }
}
