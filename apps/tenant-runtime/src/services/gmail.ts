import { google } from "googleapis";
import { getOAuth2Client, ensureValidToken } from "./google-auth";

export interface EmailSnippet {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

export async function getRecentEmails(maxResults = 10): Promise<EmailSnippet[]> {
  const valid = await ensureValidToken();
  if (!valid) {
    throw new Error("Google token not available or refresh failed");
  }

  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: "is:inbox",
  });

  const messages = res.data.messages || [];
  const emails: EmailSnippet[] = [];

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name === name)?.value || "";

    emails.push({
      id: msg.id!,
      from: getHeader("From"),
      subject: getHeader("Subject"),
      snippet: detail.data.snippet || "",
      date: getHeader("Date"),
    });
  }

  return emails;
}

export async function createDraftReply(
  messageId: string,
  threadId: string,
  to: string,
  subject: string,
  body: string
): Promise<{ draftId: string; preview: string }> {
  const valid = await ensureValidToken();
  if (!valid) {
    throw new Error("Google token not available or refresh failed");
  }

  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const rawMessage = [
    `To: ${to}`,
    `Subject: Re: ${subject}`,
    `In-Reply-To: ${messageId}`,
    `References: ${messageId}`,
    "",
    body,
  ].join("\n");

  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId,
      },
    },
  });

  return {
    draftId: draft.data.id!,
    preview: body.substring(0, 200),
  };
}
