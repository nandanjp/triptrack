import { relations, sql } from "drizzle-orm";
import {
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Status, role and kind columns are plain text with a union type in front of
 * them rather than a Postgres enum or a TypeScript `enum`. Node strips types
 * rather than compiling them, so `enum` is unavailable (ADR-0003), and a
 * Postgres enum needs a migration to add a value.
 */
export const TRIP_STATUSES = [
  "planning",
  "active",
  "completed",
  "cancelled",
  "archived",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/** `owner` manages participants, invites and the trip itself. */
export const PARTICIPANT_ROLES = ["owner", "member"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/**
 * An account holder. Deliberately distinct from a trip participant, which
 * `DOMAIN.md` keeps separate so an expense can be split with someone who
 * never signs up.
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

/**
 * The root aggregate. One Trip carries both tenses — the plan and the log —
 * which is the whole premise in `DOMAIN.md`.
 */
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /**
     * `date`, not `timestamp`: a travel day is a local date, not an instant.
     * Nullable so a trip can exist as a wishlist before it is scheduled.
     */
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status").$type<TripStatus>().notNull().default("planning"),
    /** ISO 4217. Totals are grouped by currency rather than converted (D12). */
    homeCurrency: text("home_currency").notNull().default("CAD"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("trips_created_by_idx").on(table.createdByUserId)],
);

/**
 * A person on a trip. `userId` is nullable by design (D8): an expense must be
 * splittable with someone who will never hold an account. An invite claims an
 * existing row rather than creating a new one, so expenses recorded before
 * someone signed up stay attached to them.
 */
export const tripParticipants = pgTable(
  "trip_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    role: text("role").$type<ParticipantRole>().notNull().default("member"),
    /** When this person joined, so they are absent from earlier days (D9). */
    joinedOn: date("joined_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_participants_trip_idx").on(table.tripId),
    // Partial: many participants may have no account, but one account cannot
    // occupy two seats on the same trip.
    uniqueIndex("trip_participants_trip_user_unique")
      .on(table.tripId, table.userId)
      .where(sql`user_id is not null`),
  ],
);

/**
 * A bearer credential granting trip access by claiming one participant row.
 * ADR-0005 chose links over email, which makes expiry and revocation part of
 * this step rather than a later hardening pass.
 *
 * Only a hash of the token is stored, so a database leak does not yield
 * working invites. The plaintext is shown to the inviter once.
 */
export const tripInvites = pgTable(
  "trip_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    /** Which seat this link fills. Single-use follows from that. */
    participantId: uuid("participant_id")
      .notNull()
      .references(() => tripParticipants.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_invites_token_hash_unique").on(table.tokenHash),
    index("trip_invites_trip_idx").on(table.tripId),
  ],
);

export const tripsRelations = relations(trips, ({ many, one }) => ({
  participants: many(tripParticipants),
  createdBy: one(users, { fields: [trips.createdByUserId], references: [users.id] }),
}));

export const tripParticipantsRelations = relations(tripParticipants, ({ one }) => ({
  trip: one(trips, { fields: [tripParticipants.tripId], references: [trips.id] }),
  user: one(users, { fields: [tripParticipants.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type TripParticipant = typeof tripParticipants.$inferSelect;
export type TripInvite = typeof tripInvites.$inferSelect;
