# ADR-0005 — Grant trip access with shareable invite links, and keep email out of the system

**Status:** Accepted · 2026-10-04

## Context
Trips are multi-user, and `DOMAIN.md` draws a deliberate line between a **participant**
and a **user account**: `TripParticipant.user_id` is nullable because an expense must be
splittable with someone who will never sign up. So the invite mechanism governs only who
can log in and edit a trip — not who can appear in an itinerary or owe money. That is a
narrower problem than general user onboarding.

Emailed invitations were the obvious default and were rejected. They introduce a
transactional email provider on the invite path: a credential that expires, a
deliverability failure mode that is invisible from inside the cluster, and an external
dependency for a flow used a handful of times a year.

An external identity provider was also considered. It removes password handling, but it
requires every travel companion to hold an account with that provider and puts sign-in
— the one path that must work from a hotel lobby — behind a third party.

## Decision
Local accounts with passwords. Trip access is granted by a **signed, shareable invite
link** that the inviter distributes themselves, through whatever channel they already use
to talk to their travel companions.

Accepting a link **claims an existing participant row**, linking it to the accepting
user, rather than creating a new participant. A participant invited by name and a
participant who later signs in are the same row, so expenses recorded before they
joined remain correct.

No email is sent by this application, for any reason.

## Consequences
- **There is no self-service password reset**, because there is no channel to send one
  over. Recovery is an administrative action by the operator. For a handful of users this
  is acceptable; it is the first thing that breaks if the user base ever grows.
- **An invite link is a bearer credential.** Anyone holding it gains trip access, and
  links get pasted into group chats that outlive the trip. Expiry and revocation are
  therefore part of the step that introduces invites, not a later hardening pass, and
  single-use versus multi-use is a real choice to make there.
- **Password storage becomes this application's problem** — hashing, and rate limiting
  on sign-in. Small, but non-zero, and security-relevant.
- Session cookies are signed with a secret supplied as an environment variable from a
  Kubernetes Secret. Because env-injected secrets are **read once at process start**,
  rotating it needs a `kubectl rollout restart` to take effect, and doing so logs
  everyone out. Both are acceptable; neither is obvious from the code.
- Removing email removes the only outbound network dependency the application would have
  had. Nothing in the system needs egress, which simplifies both the threat model and
  the failure modes.
- This forecloses any notification feature — trip reminders, "someone added an expense"
  — without first reintroducing the dependency this ADR rejected.
