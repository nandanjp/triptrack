/** Postgres SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = "23505";

const MAX_CAUSE_DEPTH = 5;

/**
 * Drizzle wraps driver errors in a DrizzleQueryError, so the SQLSTATE is on
 * `.cause` rather than on the error itself — verified against drizzle-orm
 * 0.45 and postgres-js 3.4. The cause chain is walked rather than assumed to
 * be one level deep, so a future wrapper does not silently turn a 409 back
 * into a 500.
 *
 * `constraint` should be given whenever a table has more than one unique
 * index, or two different conflicts produce the same message.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;

  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current === "object") {
      const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
      if (candidate.code === UNIQUE_VIOLATION) {
        return constraint === undefined || candidate.constraint_name === constraint;
      }
      current = candidate.cause;
    } else {
      return false;
    }
  }

  return false;
}
