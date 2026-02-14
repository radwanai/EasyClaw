import { google } from "googleapis";
import { getOAuth2Client, ensureValidToken } from "./google-auth";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
}

export async function getTodayEvents(): Promise<CalendarEvent[]> {
  const valid = await ensureValidToken();
  if (!valid) {
    throw new Error("Google token not available or refresh failed");
  }

  const auth = getOAuth2Client();
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items || []).map((event) => ({
    id: event.id!,
    summary: event.summary || "(No title)",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    location: event.location || undefined,
    description: event.description || undefined,
  }));
}
