import { Request, Response, NextFunction } from "express";
import { config } from "../config";

export function requireSharedSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = req.headers["x-clawdbot-secret"];
  if (!secret || secret !== config.controlPlaneSharedSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
