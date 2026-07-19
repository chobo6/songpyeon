import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const sessions = new Set<string>();

export function checkPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return typeof expected === "string" && expected.length > 0 && password === expected;
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.add(token);
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  return typeof token === "string" && sessions.has(token);
}

export function destroySession(token: string | undefined): void {
  if (typeof token === "string") {
    sessions.delete(token);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (!isValidSession(cookies?.admin_session)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function _resetForTest(): void {
  sessions.clear();
}
