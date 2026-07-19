import jwt from "jsonwebtoken";

export const SESSION_COOKIE_NAME = "session";

export function signSession(userId: number): string {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) throw new Error("SESSION_JWT_SECRET이 설정되지 않았습니다.");
  return jwt.sign({ userId }, secret, { expiresIn: "30d" });
}

export function verifySession(token: string | undefined): number | null {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(token, secret) as { userId: number };
    return payload.userId;
  } catch {
    return null;
  }
}

export function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  return undefined;
}
