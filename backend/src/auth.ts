import "dotenv/config";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const COOKIE_NAME = "hsk_session";
const secret = process.env.JWT_SECRET;
if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
  throw new Error("JWT_SECRET must be at least 32 characters in production.");
}
const jwtSecret = secret || "development-only-secret-change-me-before-deployment";

export type AuthRequest = Request & { userId?: number };
export function setSessionCookie(res: Response, userId: number) {
  const token = jwt.sign({ sub: String(userId) }, jwtSecret, { expiresIn: "7d", issuer: "hanzi-sprint" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
}
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, jwtSecret, { issuer: "hanzi-sprint" }) as jwt.JwtPayload;
      const id = Number(payload.sub);
      if (Number.isInteger(id) && id > 0) req.userId = id;
    } catch { /* invalid/expired cookie means anonymous */ }
  }
  next();
}
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: "Please log in to use this feature." });
  next();
}
