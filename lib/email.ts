// Transactional email via Resend.
// Why Resend over Nodemailer/SMTP: the SDK constructs all headers internally,
// which eliminates the header-injection risk that raw SMTP requires careful
// escaping for. No SMTP credentials or OAuth flow needed — just an API key.
// The visitor's contact info goes in the body only, never in headers, so
// they cannot spoof the From address or inject additional recipients.

import { Resend } from "resend";
import { interpretResendResult } from "@/lib/t002";

// Strip CRLF sequences from any visitor-supplied string — belt-and-suspenders
// guard against header injection. Resend's SDK also validates headers, but
// we sanitize on our side before the value ever reaches the SDK.
export function sanitize(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

// Loose email check — only used to decide whether to set reply-to.
// Not a gate; invalid contact info is allowed through (just omits reply-to).
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

export interface MessagePayload {
  message: string;
  fromName?: string;
  fromContact?: string;
}

// Resend's send API confirms the request was ACCEPTED by Resend — never that the
// email was actually delivered to the owner's inbox (no delivery webhook exists in
// this repo). Callers must not treat `accepted: true` as delivery confirmation.
export interface SendMessageResult {
  accepted: boolean;
  id?: string;
}

export async function sendMessageToOwner(payload: MessagePayload): Promise<SendMessageResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email service is not configured");

  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) throw new Error("Owner email is not configured");

  // RESEND_FROM_EMAIL defaults to Resend's shared sender, which works
  // immediately without domain verification as long as OWNER_EMAIL is the
  // email registered with your Resend account. To use a custom sender
  // (e.g. "noreply@yourdomain.com"), verify your domain at resend.com/domains
  // and set RESEND_FROM_EMAIL accordingly.
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

  const resend = new Resend(apiKey);

  const subjectSuffix = payload.fromName ? ` from ${sanitize(payload.fromName)}` : "";
  const subject = `New message${subjectSuffix} via caleb.ai`;

  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const bodyLines = [
    "New message via caleb.ai",
    "─────────────────────────────────",
    sanitize(payload.message),
    "─────────────────────────────────",
    "",
    ...(payload.fromName ? [`Name:    ${sanitize(payload.fromName)}`] : []),
    ...(payload.fromContact ? [`Contact: ${sanitize(payload.fromContact)}`] : []),
    `Sent:    ${timestamp}`,
  ];

  const replyTo =
    payload.fromContact && isValidEmail(payload.fromContact)
      ? payload.fromContact
      : undefined;

  const result = await resend.emails.send({
    from: fromEmail,
    to: ownerEmail,
    subject,
    text: bodyLines.join("\n"),
    ...(replyTo ? { replyTo } : {}),
  });

  return interpretResendResult(result);
}
