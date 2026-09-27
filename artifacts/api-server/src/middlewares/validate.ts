import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

/** Replace req.body with the parsed value, or answer 400 with the first issue. */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      res.status(400).json({ ok: false, error: `${where}${issue?.message ?? "Invalid input."}` });
      return;
    }
    req.body = parsed.data;
    next();
  };
}

/** Parse query parameters with a schema; answers 400 on failure. */
export function parseQuery<T extends ZodTypeAny>(schema: T, req: Request, res: Response): import("zod").infer<T> | null {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid query." });
    return null;
  }
  return parsed.data;
}
