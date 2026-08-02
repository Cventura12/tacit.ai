import { isDbConfigured, getDb } from "./db.ts";

export async function logOwnerAction(
  action: string,
  details?: Record<string, unknown>
): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    const db = getDb();
    await db.from("owner_actions").insert({ action, details: details ?? {} });
  } catch (err) {
    console.warn("[owner-actions] log failed:", err);
  }
}
