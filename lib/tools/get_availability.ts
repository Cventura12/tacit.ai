import type { ToolDefinition } from "./registry";
import { getMyUri, getEventType, getAvailableTimes } from "./calendly";

export const get_availability: ToolDefinition = {
  name: "get_availability",
  description:
    "Gets Caleb's available meeting times. Use this when a visitor asks to meet, book time, grab a call, schedule a chat, or wants to know when Caleb is free. Returns open slots for the bookable event type.",
  input_schema: {
    type: "object",
    properties: {
      days_ahead: {
        type: "number",
        description:
          "How many days ahead to check for availability. Defaults to 7. Maximum 7.",
      },
    },
    required: [],
  },
  lane: "public",
  statusLabel: "checking Caleb's availability…",
  execute: async (input) => {
    console.log("[get_availability] execute() entered | input keys:", Object.keys(input));
    const daysAhead =
      typeof input.days_ahead === "number"
        ? Math.min(Math.max(1, input.days_ahead), 7)
        : 7;

    const userUri = getMyUri();
    const eventType = await getEventType(userUri);

    if (!eventType) {
      return JSON.stringify({
        available: false,
        reason: "no_event_type",
        message: `No active bookable event type found. Check the CALENDLY_EVENT_SLUG config (currently: "${process.env.CALENDLY_EVENT_SLUG ?? "30min"}").`,
      });
    }

    const slots = await getAvailableTimes(eventType.uri, daysAhead);

    if (slots.length === 0) {
      return JSON.stringify({
        available: false,
        reason: "no_slots",
        eventType: eventType.name,
        duration: eventType.duration,
        checkedDays: daysAhead,
      });
    }

    return JSON.stringify({
      available: true,
      eventType: eventType.name,
      duration: eventType.duration,
      slots,
    });
  },
};
