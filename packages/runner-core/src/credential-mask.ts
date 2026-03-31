/**
 * Credential masking utility.
 *
 * Detects common credential patterns (passwords, API keys, tokens, secrets)
 * in free-form text and replaces the actual values with a mask character
 * sequence. Used throughout the display and logging layers to prevent
 * accidental credential leakage in the UI, live feed, summaries, and
 * webhook payloads.
 *
 * IMPORTANT: This module only masks OUTPUT / DISPLAY text. The actual
 * credentials are still passed to the Responses API for browser interaction.
 */

const MASK = "••••••••";

/**
 * Patterns that capture a label + separator + value.
 *
 * Each regex uses a named group `<val>` for the portion to mask.
 * Order matters — more specific patterns should come first.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  // ── Key=Value style ────────────────────────────────────
  // pass=Xyz123  password=Xyz123  secret=Xyz123  token=Xyz123  api_key=Xyz123
  /(?:pass(?:word)?|passwd|secret|token|api[_-]?key|auth[_-]?token|access[_-]?token|credential|pin)\s*=\s*(?<val>\S+)/gi,

  // ── Key: Value (YAML / prose) ──────────────────────────
  // pass: Xyz123  password: Xyz123  Password: Xyz123
  /(?:pass(?:word)?|passwd|secret|token|api[_-]?key|auth[_-]?token|access[_-]?token|credential|pin)\s*:\s*(?<val>\S+)/gi,

  // ── Markdown table row:  | Password | Xyz123 |  ────────
  /\|\s*(?:pass(?:word)?|passwd|secret|token|api[_-]?key|credential|pin)\s*\|\s*(?<val>[^|]+?)\s*\|/gi,

  // ── Sentence patterns: "and pass: Xyz" / "and password: Xyz" ──
  /(?:and\s+)?pass(?:word)?(?:\s*[:=]\s*|\s+)(?<val>\S+)/gi,

  // ── Typed: "password123" (type action log) ─────────────
  // Only match if the preceding context mentions "type" / "Typed"
  /Typed:\s*"(?<val>[^"]+)"/gi,

  // ── API key / bearer token shapes ──────────────────────
  // sk-proj-..., sk-..., Bearer <token>, ghp_..., gho_...
  /(?<val>sk-(?:proj-)?[A-Za-z0-9_-]{20,})/g,
  /Bearer\s+(?<val>[A-Za-z0-9_\-.]+)/gi,
  /(?<val>ghp_[A-Za-z0-9_]{30,})/g,
  /(?<val>gho_[A-Za-z0-9_]{30,})/g,
];

/**
 * Replace all detected credentials in `text` with `MASK`.
 *
 * The function is idempotent — already-masked text will pass through
 * unchanged (the mask string itself will never match a credential pattern).
 */
export function maskCredentials(text: string): string {
  if (!text) return text;

  let masked = text;

  for (const pattern of CREDENTIAL_PATTERNS) {
    // Reset lastIndex for global regexes used across multiple calls
    pattern.lastIndex = 0;

    masked = masked.replace(pattern, (fullMatch, ...args) => {
      // Named group `val` is in the last-but-one argument (groups object)
      const groups = args[args.length - 1] as Record<string, string> | undefined;
      const val = groups?.val;

      if (!val || val === MASK || val.trim().length === 0) {
        return fullMatch;
      }

      return fullMatch.replace(val, MASK);
    });
  }

  return masked;
}

/**
 * Sanitise a filesystem path for display by replacing the real home
 * directory username with a generic agent identity.
 *
 * `/home/phpdevgmicro/autopilot-agent/...` → `/home/agent/autopilot-agent/...`
 */
export function sanitizePath(path: string): string {
  if (!path) return path;

  // Linux home directories:  /home/<user>/...
  const sanitized = path.replace(
    /\/home\/[^/]+\//g,
    "/home/agent/",
  );

  // Windows user directories:  C:\Users\<user>\...
  return sanitized.replace(
    /[A-Z]:\\Users\\[^\\]+\\/gi,
    "C:\\Users\\agent\\",
  );
}
