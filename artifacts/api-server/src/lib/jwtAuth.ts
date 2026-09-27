/** Session tokens (JWT in an httpOnly cookie) and password hashing. */

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config.js";

export const SESSION_COOKIE = "amp_session";

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  /** Must equal users.token_version, so bumping it revokes every existing session. */
  tv: number;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: `${config.SESSION_HOURS}h`, algorithm: "HS256" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
    if (typeof decoded.userId !== "string" || typeof decoded.tv !== "number") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict" as const,
    path: "/",
    maxAge: config.SESSION_HOURS * 3600 * 1000,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
