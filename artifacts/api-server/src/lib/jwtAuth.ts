/**
 * JWT utilities and password hashing.
 * Uses SESSION_SECRET as the signing key (already a Replit-managed secret).
 */

import jwt        from "jsonwebtoken";
import bcrypt     from "bcryptjs";

const JWT_SECRET  = process.env["SESSION_SECRET"] ?? process.env["JWT_SECRET"] ?? "smc_dev_change_me";
const JWT_EXPIRES = "30d";

export interface JwtPayload {
  userId:   string;
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
