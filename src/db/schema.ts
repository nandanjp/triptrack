import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
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
    /**
     * Once set, the money is done and expenses become read-only (D14). v1
     * locks rather than versioning, because the expected flow is settling up
     * at the end of a trip. An owner can reopen, which is the escape hatch
     * for a mistake.
     */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    /**
     * A public, read-only link to the itinerary. Null means not shared.
     *
     * Stored in the clear, unlike an invite token, and the difference is
     * deliberate: an invite grants membership and is used once, so only its
     * hash is kept. A share link grants nothing but reading a money-free
     * itinerary, and has to stay re-copyable — an owner who sent it to family
     * should not have to invalidate theirs to see it again. See ADR-0011.
     */
    shareToken: text("share_token"),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trips_created_by_idx").on(table.createdByUserId),
    uniqueIndex("trips_share_token_unique")
      .on(table.shareToken)
      .where(sql`share_token is not null`),
  ],
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
    /**
     * Where I sleep at the end of this day. Lodging attaches to a *night*,
     * not a day: a 3-night stay touches 4 calendar days, so without that
     * definition a transition day is ambiguous (D6). Chosen explicitly from
     * the trip's bookings, never derived from date overlap (D5).
     */
    lodgingBookingId: uuid("lodging_booking_id").references(
      // A thunk, because bookings is declared further down. The explicit
      // return type is what stops the inference going circular.
      (): AnyPgColumn => bookings.id,
      { onDelete: "set null" },
    ),
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

/**
 * Accommodation and tickets are one entity (D4): they share every field that
 * matters — provider, confirmation code, a date range, a location. `event`
 * covers prebooked timed entry, which falls out for free.
 */
export const BOOKING_KINDS = ["lodging", "transit", "event"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

export const BOOKING_STATUSES = ["booked", "cancelled", "refunded"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * A booking's date range describes **what was paid for, not what was used**.
 * These legitimately differ: an apartment booked for a whole trip but slept in
 * for three nights, or a stay cancelled midway. That is exactly why day links
 * are explicit rather than derived from overlap (D5).
 *
 * No cost column: cost is an Expense carrying this booking's id, so trip
 * totals aggregate from one place rather than two. Arriving in step 6.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: text("kind").$type<BookingKind>().notNull(),
    title: text("title").notNull(),
    provider: text("provider"),
    confirmationCode: text("confirmation_code"),
    /**
     * An instant, not a local date: transit crosses timezones, and lodging
     * check-in has a real clock time. The local-date rule applies to trip
     * days, which is where "what day is it" is decided.
     */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    locationId: uuid("location_id").references(() => tripLocations.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<BookingStatus>().notNull().default("booked"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bookings_trip_idx").on(table.tripId),
    index("bookings_trip_kind_idx").on(table.tripId, table.kind),
  ],
);

/**
 * Transit and event bookings used on a day. Many-to-many, because a day can
 * involve a flight and an airport train. Lodging is excluded: it uses the
 * single-valued column on the day, since "where did I sleep" is a different
 * question with different cardinality (D6).
 */
export const tripDayBookings = pgTable(
  "trip_day_bookings",
  {
    dayId: uuid("day_id")
      .notNull()
      .references(() => tripDays.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.dayId, table.bookingId] })],
);

export type Booking = typeof bookings.$inferSelect;

/**
 * A cost. Exactly one parent is set, or none — a trip-level cost belonging to
 * no day, such as a flight bought in March for an October trip. That is what
 * makes the aggregate work from a single place:
 *
 *   daily spend = expenses on that day
 *   trip total  = booking expenses + day expenses + unparented expenses
 *
 * `paidByParticipantId` is who *fronted the cash*, which is a different
 * question from whose consumption it was. Both are needed, and conflating
 * them is what makes settlement impossible later.
 *
 * Parents are `set null` rather than cascading: deleting a day must not
 * silently delete money and change the trip total. The expense survives as an
 * unparented trip cost.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    dayId: uuid("day_id").references(() => tripDays.id, { onDelete: "set null" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    entryId: uuid("entry_id").references(() => dayEntries.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    /**
     * Integer minor units (D11). The exponent comes from the currency code —
     * KRW has none, CAD has two — and is a presentation concern. Negative is
     * a refund, which is how a cancellation is recorded against a booking.
     */
    amountMinor: integer("amount_minor").notNull(),
    /** ISO 4217, uppercase. Totals group by this rather than converting (D12). */
    currency: text("currency").notNull(),
    paidByParticipantId: uuid("paid_by_participant_id")
      .notNull()
      .references(() => tripParticipants.id, { onDelete: "restrict" }),
    splitMode: text("split_mode").$type<"equal" | "exact">().notNull().default("equal"),
    /** Visible only to the payer, carries no shares, outside group settlement. */
    isPrivate: boolean("is_private").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("expenses_trip_idx").on(table.tripId),
    index("expenses_day_idx").on(table.dayId),
    index("expenses_booking_idx").on(table.bookingId),
    // Unlike a booking's kind, this invariant *is* expressible in the schema,
    // so it is enforced there rather than only in the handlers.
    check(
      "expenses_single_parent",
      sql`(case when day_id is null then 0 else 1 end
         + case when booking_id is null then 0 else 1 end
         + case when entry_id is null then 0 else 1 end) <= 1`,
    ),
    check("expenses_amount_nonzero", sql`amount_minor <> 0`),
    check("expenses_currency_format", sql`currency ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * Who consumed an expense, and how much of it. Balances are derived from
 * these and never stored — `sum(paid) − sum(owed)` per participant — because
 * a stored running balance is how these systems go quietly wrong.
 *
 * A zero share is not stored: owing nothing and not being involved coincide.
 */
export const expenseShares = pgTable(
  "expense_shares",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => tripParticipants.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.expenseId, table.participantId] }),
    index("expense_shares_participant_idx").on(table.participantId),
    check("expense_shares_amount_nonzero", sql`amount_minor <> 0`),
  ],
);

export type Expense = typeof expenses.$inferSelect;
export type ExpenseShare = typeof expenseShares.$inferSelect;

/**
 * A payment one participant actually made to another. These are the only
 * stored facts about settlement: outstanding balance is
 * `sum(paid) − sum(owed) − recorded payments`, derived every time.
 *
 * Amounts are positive and directional — a negative payment would be the same
 * fact written backwards, and two spellings of one thing is how a ledger
 * stops reconciling.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    fromParticipantId: uuid("from_participant_id")
      .notNull()
      .references(() => tripParticipants.id, { onDelete: "restrict" }),
    toParticipantId: uuid("to_participant_id")
      .notNull()
      .references(() => tripParticipants.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    /** A local date: when the money changed hands, not an instant. */
    settledOn: date("settled_on").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("settlements_trip_idx").on(table.tripId),
    check("settlements_amount_positive", sql`amount_minor > 0`),
    check("settlements_currency_format", sql`currency ~ '^[A-Z]{3}$'`),
    // Paying yourself is not a payment.
    check("settlements_distinct_parties", sql`from_participant_id <> to_participant_id`),
  ],
);

export type Settlement = typeof settlements.$inferSelect;
