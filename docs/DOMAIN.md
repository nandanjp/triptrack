# TripTrack — Domain Model

**Status:** draft for grilling · **Last updated:** 2026-10-04

## Thesis

One tool for the full lifecycle of a trip: plan it, live it, log it, and settle up —
without the plan and the log being two different artifacts.

The gap being closed: this is all expressible in Notion (root trip page, a table of
days, a child page per day holding entries, photos, lodging links and costs). What
Notion cannot do is **aggregate the per-day, per-person cost breakdowns into a trip
total and a settlement**. That aggregation is the reason this app exists.

## Core principle — the plan *is* the log

There is no separate "planned trip" and "trip report". A single `Trip` carries both
tenses. The mechanism is status on `DayEntry`:

- A planned thing starts `planned` and becomes `done`.
- A spontaneous thing is created directly as `done`. It is not a separate concept —
  an off-itinerary find is simply an entry born in the done state.
- A thing that did not happen becomes `skipped` or `cancelled`, and may point at the
  entry that replaced it via `replaced_by`.

This preserves the archaeology of a trip: what you meant to do, what you actually did,
and what you did instead.

---

## Entities

### User
An account holder.

### Trip
`name`, `start_date?`, `end_date?`, `status`, `home_currency`

Dates are nullable so a trip can exist as a wishlist before it is scheduled.
`status`: `planning | active | completed | cancelled | archived`

### TripParticipant
`trip_id`, `user_id?`, `display_name`, `role`, `invite_status`, `joined_on?`

`user_id` is **nullable by design**. You must be able to split an expense with someone
who does not have an account (a family member who came along and will never sign up).
An invite "claims" a participant when accepted. Modelling membership as a plain
`(trip_id, user_id)` join would make this a painful retrofit across every expense query.

`joined_on` supports people joining partway through a trip.

### TripLocation
`trip_id`, `name`, `geo?`

A coarse, user-defined *planning area* — Seoul, Busan, Jeju. Deliberately not precise.
Declared up front, before any days exist.

Day allocation ("7 days Seoul, 3 Busan, 4 Jeju") is never enforced — it is derived as
`count(days) grouped by location`. The allocation is a consequence of the itinerary,
not a constraint on it.

### Place
`name`, `external_ref?`, `lat`, `lng`, `country?`

Global and cross-trip. A specific venue — a ramen shop, a museum. Referenced by
`DayEntry`. This is what powers cross-trip queries ("every country I've been to",
"have I eaten here before"). Kept lightweight and created on demand; this is not a
POI database to maintain.

> `TripLocation` and `Place` are both "location" in English but serve different jobs:
> one is a planning bucket, the other is a pin on a map. Unifying them into a
> hierarchical geo table is a swamp. They stay separate.

### Booking
`trip_id`, `kind`, `title`, `provider?`, `confirmation_code?`, `starts_at`, `ends_at?`,
`location_id?`, `status`, `attachment?`

`kind`: `lodging | transit | event`
`status`: `booked | cancelled | refunded`

Accommodations and tickets are one entity. They share every field that matters —
provider, confirmation code, cost, a date range, a location, an attachment. `event`
covers prebooked timed entry (a museum slot, a concert, a tour).

A booking's date range describes **what was paid for, not what was used**. These
legitimately differ: an apartment booked for the whole trip but slept in for three
nights; a stay cancelled midway. Cost therefore lives on the booking, independent of
usage — 14 nights booked and 3 used still costs 14 nights.

Cancellations and partial refunds are recorded as **negative expenses against the
booking**, so a cancellation fee is representable without special-casing anything.

### TripDay
`trip_id`, `day_number`, `date?`, `notes?`, `lodging_booking_id?`

`day_number` is the stable identity; `date` is an attribute. This makes inserting a day
mid-trip and shifting an entire trip's dates both cheap, and lets a trip exist with no
dates at all.

`lodging_booking_id` means **"where I sleep at the end of this day"** — lodging attaches
to a *night*, not a day. A 3-night stay touches 4 calendar days, so without this
definition a transition day is ambiguous. Chosen explicitly by the user from the trip's
bookings; never derived.

Dates are **local dates**, not instants. A travel "day" is local to where you are. Times
on entries carry an explicit zone. Storing `timestamptz` and rendering in one zone puts
a Tokyo dinner on the wrong day.

### TripDayLocation
`day_id`, `location_id`, `position`

Many-to-many: a travel day spans Seoul *and* Busan. Ordered, because a travel day has
direction.

### TripDayBooking
`day_id`, `booking_id`

Many-to-many, for `transit` and `event` bookings used on a day — a day can involve a
flight and an airport train. Lodging is excluded here; it uses the single-valued
`TripDay.lodging_booking_id`, because "where did I sleep" is a different question with
different cardinality.

### DayEntry
`day_id`, `kind`, `title`, `place_id?`, `time?`, `status`, `replaced_by?`, `notes?`

`kind`: `activity | meal | place`
`status`: `planned | done | skipped | cancelled`

`replaced_by` points at another `DayEntry` (possibly on a different day) — the beach you
went to when the museum was closed.

### DayEntryAttendee
`entry_id`, `participant_id`

Who was actually there. Defaults to every current trip participant at creation time, and
is editable per entry — the group splits up, some go to Kyoto and others to Osaka.

**These rows are materialised, not implied.** A null attendee list meaning "everybody"
would retroactively add a late-joining participant to every past entry, which is wrong.
Materialising at creation time means someone who joins on day 5 is correctly absent from
days 1–4, and it gives expense shares a sensible default.

### Photo
`trip_id`, `day_id?`, `entry_id?`, `storage_key`, `taken_at?`, `geo?`

Bytes in object storage, metadata in Postgres. `day_id` and `entry_id` are both optional
so an unassigned photo still belongs to the trip.

EXIF carries a timestamp and often GPS, so an upload can auto-assign itself to the right
day and *suggest* the place and entry it belongs to — drop 200 photos and the app drafts
the log. A photo may mark an entry `done` as a side effect, but is never required for it.

### Expense
`trip_id`, `day_id?`, `booking_id?`, `entry_id?`, `description`, `amount_minor`,
`currency`, `paid_by_participant_id`, `split_mode`, `is_private`

Exactly one parent is set, or none (a trip-level cost belonging to no day). This is what
makes the aggregate work:

```
trip total      = all expenses for the trip
                = booking expenses + day expenses + unparented trip expenses
daily spend     = expenses where day_id = X
```

Pre-trip costs (flights bought in March for an October trip) belong to a booking and no
day, and still roll into the trip total.

**`paid_by` is the person who fronted the cash.** (Not "payee" — a payee *receives*
money; this is the payer.)

`split_mode`: `equal | exact`

**The payer holds the remainder.** Their share is always
`total − sum(everyone else's shares)`, which may be zero. In `exact` mode you enter
amounts for whoever owes, and whatever is left is the payer's own spend:

> P1 pays ₩10,000. P2 owes ₩4,000, P3 owes ₩6,000 → **P1 owes nothing.**

This also covers the payer not being in the split at all — paying for someone else's
taxi when you were not in it leaves a remainder of zero — and it makes the
sum-to-total invariant structural rather than something to validate against user input.
An unspecified participant in `exact` mode owes nothing; `sum(others) > total` is an error.

`is_private` expenses are visible only to the payer, carry no shares, and are excluded
from group settlement. They count toward *your* personal total but not the shared total.

### ExpenseShare
`expense_id`, `participant_id`, `amount_minor`

Who consumed the expense and in what proportion.

The critical distinction: *paid* and *owed* are different numbers.

> I pay ₩40,000 for a dinner the four of us ate.
> Spent by me: ₩40,000. My share: ₩10,000. **I am owed ₩30,000.**

So "split equally" must generate an actual set of share rows, not store a single number
per person — otherwise settlement is impossible later. Shares default to the parent
entry's attendees where there is one, otherwise to all current participants.

Invariant: **shares always sum exactly to the expense amount** — guaranteed by the
payer holding the remainder, not by validating input. Rounding lands there too:
₩10,000 split three ways gives the odd won to the payer.

### Settlement
`trip_id`, `from_participant_id`, `to_participant_id`, `amount_minor`, `currency`,
`settled_on`

Balances are **derived, never stored**: `balance = sum(paid) − sum(owed)` per participant.
Settlements are recorded payments that zero people out. Storing running balances is how
these systems go subtly wrong.

**v1 rule: expenses are immutable once settled**, rather than versioned. The expected
flow is settling up at the end of a trip, so a trip is marked settled and its expenses
become read-only from that point. Outstanding balance per participant pair is derived as
`balance − recorded settlements`. Versioned edit history is out of scope for v1, but the
shape must not preclude it.

---

## Decisions and rationale

| # | Decision | Why |
|---|---|---|
| D1 | One `Trip` serves plan and log; status lives on `DayEntry` | Avoids duplicate plan/report entities and keeps divergence representable |
| D2 | Spontaneous entries are entries born `done` | Not a fourth content type; one timeline, one UI |
| D3 | `TripDay` is a real entity keyed by `day_number`, date as attribute | Content (photos, costs, notes) needs a home; stable under date shifts and mid-trip insertions |
| D4 | `Booking` unifies lodging, transit and event | Identical fields; `event` comes free |
| D5 | Day→booking links are explicit, never derived from date overlap | Booked range ≠ used range; cancellations and over-booked stays break derivation |
| D6 | Lodging attaches to a night, via a single-valued field on the day | Removes transition-day ambiguity |
| D7 | `TripLocation` (planning area) is separate from `Place` (venue) | Different jobs; geo hierarchies are a swamp |
| D8 | `TripParticipant.user_id` is nullable | Must split with people who will never have an account |
| D9 | Attendance rows are materialised at creation | Late joiners must not be retroactively added to past entries |
| D10 | Balances derived; settlements recorded separately | Stored balances drift |
| D11 | Money as integer minor units + currency code | Avoids float error; currency exponent derived from the code (KRW has 0 decimals, CAD has 2) |
| D12 | No FX conversion in v1 — totals shown **per currency** | Keeps the model honest with near-zero complexity (see below) |
| D13 | The payer holds the remainder: `share = total − sum(others)` | Makes sum-to-total structural, handles the payer sitting outside the split, and gives rounding a deterministic owner |
| D14 | Expenses lock on settlement; no versioning in v1 | Settling happens at trip end anyway; versioning is the expensive alternative |

### On currency (D12)

Foreign-transaction handling is explicitly out of scope — expenses are assumed paid in
local currency. But mixed currency still arises naturally from the model, because
flights are bought at home in `CAD` while on-ground spend is in `KRW`.

So: keep `currency` per expense, and display totals **grouped by currency**
(`₩1,240,000 + CA$1,850`) rather than converting. No rate snapshots, no retroactive
drift when rates move. Conversion can be added later as a display concern without
touching the schema.

---

## Derived views

Everything below is a query, not stored state:

- Day allocation per location — `count(days) group by location`
- Trip total, and spend per day
- Per-participant balance, and a simplified settlement plan
- Countries and places visited, across all trips
- Bookings whose paid-for nights exceed their used nights (a soft warning, not an error)

## Scope risk

Itinerary, photos and bookings are a modest domain. **Group expense settlement is not** —
it is the piece that can swallow the project. It should live behind a clean module
boundary so it can ship after v1 without reshaping the itinerary model.

## Deferred from v1

Deliberately excluded, with retrofit cost noted:

1. **Versioned expense history.** Expenses lock on settlement instead (D14). Moderate to
   retrofit — needs an append-only shape later.
2. **Concurrent editing** of the same day by multiple participants. Last-write-wins in v1.
   Expensive to retrofit properly.
3. **Offline use.** Not assumed. Would materially change the sync story — the most
   expensive of these to add later.
4. **FX conversion.** Totals group by currency instead (D12). Cheap to add as a display
   concern; the schema already carries per-expense currency.
5. **Percentage and share-based splits.** `equal | exact` only. Cheap to add.
