import { Router, Request, Response } from "express";
import { config } from "../config";
import { getSecrets } from "../services/secrets";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  const secrets = getSecrets();
  const hasGoogle = !!(secrets.google?.refresh_token);

  res.json({
    status: "healthy",
    tenantId: config.tenantId,
    timestamp: new Date().toISOString(),
    connectors: {
      google: hasGoogle ? "connected" : "not_connected",
    },
  });
});

export default router;
