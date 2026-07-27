import type { Channel, Message } from "../types";
import { readRecent, type GmailMessage } from "@/lib/gmail";

// Number of messages to fetch from inbox on each fetchNew() call.
// The coarse filter will drop most of them before any AI runs.
const FETCH_MAX = 25;

// Default Gmail query — recent unread messages.
const DEFAULT_QUERY = "is:unread newer_than:7d";

export class GmailChannel implements Channel {
  readonly name = "gmail";

  constructor(
    private readonly query: string = DEFAULT_QUERY,
    private readonly max: number = FETCH_MAX,
  ) {}

  async fetchNew(): Promise<Message[]> {
    let raw: GmailMessage[];
    try {
      raw = await readRecent(this.query, this.max);
    } catch (err) {
      console.warn("[GmailChannel] fetchNew failed:", err);
      return [];
    }

    return raw.map((m): Message => ({
      source: "gmail",
      id: m.id,
      from: m.from,
      subject: m.subject,
      // snippet is sufficient for the relevance filter — full body is fetched
      // later by handle_email when a message actually needs a reply.
      body: m.snippet,
      receivedAt: m.date || new Date().toISOString(),
      raw: {
        id: m.id,
        unread: m.unread,
        snippet: m.snippet,
        date: m.date,
      },
    }));
  }
}
