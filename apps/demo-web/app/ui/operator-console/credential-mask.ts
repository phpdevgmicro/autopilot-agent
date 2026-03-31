/**
 * Client-side credential masking utility.
 *
 * Mirrors the backend credential-mask.ts but runs in the browser.
 * Applied to display text in the Summary, Logs, and Live Feed to
 * ensure passwords are never visible on-screen.
 */

const MASK = "••••••••";

const CREDENTIAL_PATTERNS: RegExp[] = [
  // Key=Value style
  /(?:pass(?:word)?|passwd|secret|token|api[_-]?key|auth[_-]?token|access[_-]?token|credential|pin)\s*=\s*(?<val>\S+)/gi,
  // Key: Value style
  /(?:pass(?:word)?|passwd|secret|token|api[_-]?key|auth[_-]?token|access[_-]?token|credential|pin)\s*:\s*(?<val>\S+)/gi,
  // Markdown table: | Password | Xyz123 |
  /\|\s*(?:pass(?:word)?|passwd|secret|token|api[_-]?key|credential|pin)\s*\|\s*(?<val>[^|]+?)\s*\|/gi,
  // Sentence patterns: "and pass: Xyz" / "and password: Xyz"
  /(?:and\s+)?pass(?:word)?(?:\s*[:=]\s*|\s+)(?<val>\S+)/gi,
  // Typed: "password123"
  /Typed:\s*"(?<val>[^"]+)"/gi,
  // API key shapes
  /(?<val>sk-(?:proj-)?[A-Za-z0-9_-]{20,})/g,
  /Bearer\s+(?<val>[A-Za-z0-9_\-.]+)/gi,
];

export function maskCredentials(text: string): string {
  if (!text) return text;

  let masked = text;

  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;

    masked = masked.replace(pattern, (fullMatch, ...args) => {
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
