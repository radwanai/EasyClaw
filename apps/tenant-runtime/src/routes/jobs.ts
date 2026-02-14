import { Router, Request, Response } from "express";
import { getRecentEmails, createDraftReply } from "../services/gmail";
import { getTodayEvents } from "../services/calendar";
import { config } from "../config";

const router = Router();

/**
 * POST /jobs/daily-brief
 * Fetches calendar events + recent emails, produces a summary.
 * MVP: uses a simple template-based summarizer (no LLM call).
 */
router.post("/jobs/daily-brief", async (_req: Request, res: Response) => {
  try {
    const [events, emails] = await Promise.all([
      getTodayEvents().catch((err) => {
        console.error("[daily-brief] Calendar fetch failed:", err.message);
        return [];
      }),
      getRecentEmails(5).catch((err) => {
        console.error("[daily-brief] Gmail fetch failed:", err.message);
        return [];
      }),
    ]);

    // MVP summarizer (template-based, no LLM)
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let summary = `Daily Brief for ${dateStr}\n`;
    summary += `Tenant: ${config.tenantId}\n\n`;

    // Calendar section
    summary += `📅 TODAY'S SCHEDULE (${events.length} events)\n`;
    if (events.length === 0) {
      summary += "  No events scheduled today.\n";
    } else {
      for (const event of events) {
        const start = event.start
          ? new Date(event.start).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "All day";
        summary += `  • ${start} — ${event.summary}`;
        if (event.location) summary += ` (${event.location})`;
        summary += "\n";
      }
    }

    summary += "\n";

    // Email section
    summary += `📧 RECENT EMAILS (${emails.length} shown)\n`;
    if (emails.length === 0) {
      summary += "  No recent emails.\n";
    } else {
      for (const email of emails) {
        summary += `  • From: ${email.from}\n`;
        summary += `    Subject: ${email.subject}\n`;
        summary += `    Preview: ${email.snippet.substring(0, 100)}...\n\n`;
      }
    }

    res.json({
      tenantId: config.tenantId,
      generatedAt: now.toISOString(),
      summary,
      data: {
        events,
        emails,
      },
    });
  } catch (err: any) {
    console.error("[daily-brief] Error:", err.message);
    res.status(500).json({ error: "Failed to generate daily brief", detail: err.message });
  }
});

/**
 * POST /jobs/draft-reply
 * Creates a Gmail draft reply to a specific message.
 * Body: { messageId, threadId, to, subject, body }
 */
router.post("/jobs/draft-reply", async (req: Request, res: Response) => {
  try {
    const { messageId, threadId, to, subject, body } = req.body;

    if (!messageId || !threadId || !to || !subject || !body) {
      res.status(400).json({
        error: "Missing required fields: messageId, threadId, to, subject, body",
      });
      return;
    }

    const result = await createDraftReply(messageId, threadId, to, subject, body);

    res.json({
      tenantId: config.tenantId,
      ...result,
    });
  } catch (err: any) {
    console.error("[draft-reply] Error:", err.message);
    res.status(500).json({ error: "Failed to create draft reply", detail: err.message });
  }
});

export default router;
