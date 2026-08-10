import type { ToolDefinition, ToolExecutionContext } from "./registry";
import { sendMessageToOwner, sanitize, isValidEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/ratelimit";

const MAX_MSG_LEN = 2000;
const MAX_NAME_LEN = 100;
const MAX_CONTACT_LEN = 200;

export const leave_message: ToolDefinition = {
  name: "leave_message",
  description:
    "Sends a message from the visitor directly to Caleb's inbox. Use this when: the visitor wants to pass along a note, get in touch, reach Caleb, or leave contact info. Also use it as the fallback when scheduling fails — offer to relay their message instead.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The message the visitor wants to send to Caleb.",
      },
      from_name: {
        type: "string",
        description: "The visitor's name (optional).",
      },
      from_contact: {
        type: "string",
        description:
          "An email address or social handle where Caleb can reply (optional). If it looks like an email, it becomes reply-to.",
      },
    },
    required: ["message"],
  },
  lane: "public",
  statusLabel: "sending that to Caleb…",
  execute: async (input, ctx: ToolExecutionContext) => {
    // Keys only — input carries visitor-submitted message/contact content
    // that must never land in logs.
    console.log("[leave_message] execute() entered | input keys:", Object.keys(input));

    // Durable rate limit: 3 messages per IP per hour
    const allowed = await checkRateLimit(`${ctx.ip}:leave_message`, 3600, 3);
    if (!allowed) {
      return JSON.stringify({
        success: false,
        reason: "rate_limited",
        message: "Too many messages from this connection — try again in an hour.",
      });
    }

    const rawMessage = typeof input.message === "string" ? input.message.trim() : "";
    if (!rawMessage) {
      return JSON.stringify({ success: false, reason: "empty_message" });
    }
    if (rawMessage.length > MAX_MSG_LEN) {
      return JSON.stringify({
        success: false,
        reason: "message_too_long",
        maxLength: MAX_MSG_LEN,
      });
    }

    const rawName =
      typeof input.from_name === "string" ? input.from_name.trim() : undefined;
    const fromName = rawName
      ? sanitize(rawName).slice(0, MAX_NAME_LEN) || undefined
      : undefined;

    const rawContact =
      typeof input.from_contact === "string" ? input.from_contact.trim() : undefined;
    const fromContact = rawContact
      ? sanitize(rawContact).slice(0, MAX_CONTACT_LEN) || undefined
      : undefined;

    const contactLooksLikeEmail =
      fromContact && fromContact.includes("@") && !isValidEmail(fromContact);

    try {
      await sendMessageToOwner({ message: rawMessage, fromName, fromContact });
      console.log("[leave_message] sent successfully");
      return JSON.stringify({
        success: true,
        ...(contactLooksLikeEmail
          ? { note: "The contact email didn't look valid, so reply-to was omitted." }
          : {}),
      });
    } catch (err) {
      console.error("[leave_message] send failed:", err);
      return JSON.stringify({
        success: false,
        reason: "send_failed",
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  },
};
