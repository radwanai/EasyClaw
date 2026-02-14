import express from "express";
import { config, validateConfig } from "./config";
import { loadSecrets, startPeriodicRefresh } from "./services/secrets";
import { requireSharedSecret } from "./middleware/auth";
import healthRouter from "./routes/health";
import jobsRouter from "./routes/jobs";

async function main() {
  console.log(`[tenant-runtime] Starting for tenant: ${config.tenantId}`);
  validateConfig();

  // Load secrets from AWS Secrets Manager at startup
  await loadSecrets();
  startPeriodicRefresh();

  const app = express();
  app.use(express.json());

  // Health endpoint is public (ECS health check needs it)
  app.use(healthRouter);

  // Job endpoints require shared secret
  app.use("/jobs", requireSharedSecret, jobsRouter);

  app.listen(config.port, "0.0.0.0", () => {
    console.log(
      `[tenant-runtime] Listening on port ${config.port} (tenant: ${config.tenantId})`
    );
  });
}

main().catch((err) => {
  console.error("[tenant-runtime] Fatal error:", err);
  process.exit(1);
});
