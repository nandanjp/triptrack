# ADR-0008 — An edit that moves money must restate the split, not inherit it

**Status:** Accepted · 2026-10-04

## Context
A stored share set cannot reconstruct the intent that produced it, because
**a zero share is not stored**. That is the right storage rule — owing nothing and not
being involved are the same state, and writing zeroes would bloat the table and invite
"is this a real zero or a leftover" questions — but it erases a distinction that matters
when recomputing:

> P1 pays ₩2,500 for P2's taxi. P1 was not in the car, so owes nothing.
> P1 pays ₩5,000 for a dinner they ate with P2, and P2 covers the whole bill back.

Afterwards both look identical: one share row, belonging to P2. Re-splitting the first
case among the people found in the share table would correctly leave P1 out; doing it to
the second would wrongly drop P1 from a dinner they ate.

So on a PATCH that changes the amount, the payer, the mode or the participants, there are
three options:

- **Infer the previous intent from the stored shares.** Rejected: the inference is
  provably ambiguous, and being wrong moves somebody's money without telling them.
- **Store the consumer set alongside the shares**, including zeroes or in a separate
  table. Honest, and it would make inheritance sound. Rejected for now as more schema
  than the problem warrants, and it adds a second place for the participant list to
  disagree with reality.
- **Require the caller to restate the split.** Chosen.

## Decision
A PATCH that touches nothing affecting the split — a description, a parent — leaves the
shares **completely untouched**. No delete-and-reinsert, no recomputation.

A PATCH that changes `amountMinor`, `paidByParticipantId`, `splitMode`, `isPrivate`,
`consumerIds` or `exactShares` must supply the full split intent: `consumerIds` for an
equal split, `exactShares` for an exact one. Without it the request is refused with
*"changing the split needs … which cannot be inferred"*.

## Consequences
- **Fixing a typo is free, and changing an amount is not.** Correcting ₩40,000 to
  ₩45,000 means resending who it was split between, even when that has not changed. The
  UI can carry it, but any other caller has to know to.
- **Nothing silently moves money.** The failure mode is an error message, which is the
  right direction for this subdomain to fail in.
- **It forecloses a one-field "just fix the amount" API** until the consumer set is
  stored properly. That is the upgrade path if this proves annoying: add the set, then
  inheritance becomes sound and this rule can relax.
- **The error is only reachable through the API.** A caller that supplies the intent
  every time never sees it, so it will be easy to forget this rule exists when writing a
  second client.
- The same reasoning does **not** apply to creation, where there is no previous intent to
  inherit and the defaults — the entry's attendees, else everyone — are unambiguous.
