// Default-deny sanitizer for persisting/logging a tool call's raw input.
// Given a tool's loggableInputKeys allowlist and the raw input the model
// supplied, returns an object where only allowlisted keys survive verbatim —
// every other key that held a value is dropped and its NAME (never its
// value) is recorded under `_redacted`. A tool that declares no
// loggableInputKeys (including every MCP tool, which never sets it) gets its
// entire input redacted — that is the safe default, not an opt-in.

const REDACTED_KEY = "_redacted";

export function redactToolInput(
  loggableInputKeys: string[] | undefined,
  input: Record<string, unknown>
): Record<string, unknown> {
  const allowed = new Set(loggableInputKeys ?? []);
  const safe: Record<string, unknown> = {};
  const redactedKeys: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (allowed.has(key)) {
      safe[key] = value;
    } else {
      redactedKeys.push(key);
    }
  }

  if (redactedKeys.length > 0) {
    safe[REDACTED_KEY] = redactedKeys;
  }

  return safe;
}
