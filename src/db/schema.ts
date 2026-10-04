import { relations, sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
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

export const ENTRY_KINDS = ["activity", "meal", "place"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * A planned entry becomes `done`. A spontaneous one is created directly as
 * `done` — an off-itinerary find is not a separate concept, just an entry born
 * in that state (D2). `skipped` and `cancelled` keep the archaeology of what
 * was meant to happen.
 */
export const ENTRY_STATUSES = ["planned", "done", "skipped", "cancelled"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/**
 * A specific venue, global and shared across trips. This is what makes the
 * cross-trip questions answerable — every country visited, whether somewhere
 * has been eaten at before — which a free-text location per entry could not
 * (D7). Deliberately lightweight: not a gazetteer to maintain.
 */
export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Google Places or OSM id, when one is known. Used to dedupe. */
    externalRef: text("external_ref"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    country: text("country"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("places_external_ref_unique")
      .on(table.externalRef)
      .where(sql`external_ref is not null`),
    index("places_country_idx").on(table.country),
  ],
);

/**
 * A coarse planning area — Seoul, Busan, Jeju — declared before any days
 * exist. Day allocation is never enforced: "7 days in Seoul" is derived by
 * counting the days that point here, so the allocation is a consequence of
 * the itinerary rather than a constraint on it.
 */
export const tripLocations = pgTable(
  "trip_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("trip_locations_trip_name_unique").on(table.tripId, table.name)],
);

/**
 * `dayNumber` is the stable identity and `date` is an attribute (D3), which is
 * what makes shifting a whole trip and inserting a day mid-trip both cheap.
 * Date is nullable so an unscheduled trip still has an itinerary.
 *
 * No CHECK on dayNumber being positive: renumbering moves rows through
 * negative values inside a transaction to avoid colliding with the unique
 * index. See renumberForInsert.
 */
export const tripDays = pgTable(
  "trip_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
    /** A local date, never an instant: a travel day belongs to where you are. */
    date: date("date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_days_trip_number_unique").on(table.tripId, table.dayNumber),
    uniqueIndex("trip_days_trip_date_unique")
      .on(table.tripId, table.date)
      .where(sql`date is not null`),
  ],
);

/**
 * Many-to-many and ordered, because a travel day spans Seoul *and* Busan and
 * the order carries the direction of travel.
 */
export const tripDayLocations = pgTable(
  "trip_day_locations",
  {
    dayId: uuid("day_id")
      .notNull()
      .references(() => tripDays.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => tripLocations.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.dayId, table.locationId] })],
);

/**
 * A thing to do, or done. `replacedBy` records the beach you went to when the
 * museum was closed, so a trip keeps what was intended alongside what
 * happened rather than overwriting it.
 */
export const dayEntries = pgTable(
  "day_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dayId: uuid("day_id")
      .notNull()
      .references(() => tripDays.id, { onDelete: "cascade" }),
    kind: text("kind").$type<EntryKind>().notNull(),
    title: text("title").notNull(),
    placeId: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
    /** Local wall-clock time; the day already carries the date. */
    startsAt: time("starts_at"),
    status: text("status").$type<EntryStatus>().notNull().default("planned"),
    /** May point at an entry on another day — plans move. */
    replacedByEntryId: uuid("replaced_by_entry_id"),
    notes: text("notes"),
    /** Orders entries that carry no time. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("day_entries_day_idx").on(table.dayId),
    index("day_entries_place_idx").on(table.placeId),
    foreignKey({
      columns: [table.replacedByEntryId],
      foreignColumns: [table.id],
      name: "day_entries_replaced_by_fk",
    }).onDelete("set null"),
  ],
);

/**
 * Who was actually there. Materialised at creation rather than implied (D9):
 * a null list meaning "everyone" would retroactively add a late-joining
 * participant to every past entry, and then to its expense shares.
 */
export const dayEntryAttendees = pgTable(
  "day_entry_attendees",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => dayEntries.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => tripParticipants.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.entryId, table.participantId] })],
);

export type Place = typeof places.$inferSelect;
export type TripLocation = typeof tripLocations.$inferSelect;
export type TripDay = typeof tripDays.$inferSelect;
export type DayEntry = typeof dayEntries.$inferSelect;
