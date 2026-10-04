# ADR-0011 — Share an itinerary with a public link, and keep the token in the clear

**Status:** Accepted · 2026-10-04

## Context
A trip is worth showing to people who are not on it — family who want to know where you
will be, a friend planning the same route. None of them want an account, and none of
them should see what anything cost.

Two questions had real alternatives.

**What travels.** The whole trip, or a subset? Sharing everything would hand a reader
expense amounts, who owes whom, booking confirmation codes and the names of everyone
going — none of which is theirs to see, and most of which is exactly the sensitive part.

**How the token is stored.** `DOMAIN.md` and ADR-0005 store only a *hash* of an invite
token, on the grounds that a database leak should yield no working invites. Applying the
same rule here would mean an owner could never re-copy their own link: having sent it to
family, seeing it again would require issuing a new one and breaking theirs.

## Decision
A trip carries at most one share link. An owner turns it on, and the plaintext token is
stored on the trip so it stays re-copyable. Turning sharing off, or issuing a new link,
is what revokes the old one — there is no expiry, because a link sent to family should
not quietly stop working mid-trip.

**What travels with the link:** trip name, dates, areas, and the days — day number, date,
day notes, locations, and each entry's kind, title, time, status and place.

**What does not:** every expense, share, balance and settlement; every booking, including
providers and confirmation codes; every participant, and therefore all attendance; and
entry notes, which tend to hold logistics meant for the group.

`GET /api/shared/:token` needs no session, and answers the same 404 for a revoked link,
a made-up one, and a trip that was never shared.

## Consequences
- **The token is readable in the database, unlike an invite token.** That is a deliberate
  departure, and the reasoning is that the two things differ in what they grant: an
  invite confers *membership* — write access, money, other people's names — and is used
  once, so only its hash is kept. A share link confers reading one money-free itinerary,
  and must survive being looked up again. A leak of the trips table would expose
  itineraries; it would not expose money, credentials, or any write access.
- **There is no expiry.** A link works until an owner revokes it, which is the right
  default for something sent to family and wrong for something pasted in a public forum.
  Revocation is the only control, and it is all-or-nothing.
- **Narrowing what travels is enforced by the query, not by filtering a full object.**
  The public endpoint selects the columns it wants rather than deleting the ones it does
  not, so a column added later is absent by default instead of leaking by default. A test
  asserts against the whole serialised payload for a list of things that must never
  appear, so a future field cannot quietly add one back.
- **Day notes travel and entry notes do not**, which is a judgement call rather than a
  principle. Day notes read as narrative; entry notes read as logistics. An owner cannot
  currently override that per note.
- **One link per trip** means no way to tell who opened it, or to hand different people
  different links. Several named links with their own revocation would be the upgrade,
  and the column would have to become a table.
- **A shared trip is not discoverable** — nothing lists shared trips, and the token is
  256 bits of CSPRNG output, so guessing is not a concern. But the link is a bearer
  credential like any other, and forwarding it is not something the app can prevent.
