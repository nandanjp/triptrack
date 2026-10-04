import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

/**
 * Validates a JSON body and, on failure, answers in the same shape as every
 * other error: `{ error: string }`.
 *
 * `zValidator`'s default is to return Zod's own serialised issue list, which
 * the client cannot read — it looks for `error` and falls back to "request
 * failed (400)", hiding exactly the message a person needs. Validation errors
 * are the most useful errors in the system, so they get the normal shape.
 */
export const jsonBody = <T extends ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (result.success) return;

    const [issue] = result.error.issues;
    const path = issue?.path.join(".") ?? "";
    const message = issue?.message ?? "invalid request";

    return c.json({ error: path === "" ? message : `${path}: ${message}` }, 400);
  });
