import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * An account holder. Deliberately distinct from a trip participant, which
 * `DOMAIN.md` keeps separate so an expense can be split with someone who
 * never signs up. Participants arrive in step 3.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stored already normalised; see normaliseEmail.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export type User = typeof users.$inferSelect;
