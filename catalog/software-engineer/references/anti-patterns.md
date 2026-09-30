# Anti-Patterns

`smells.mjs` catches the mechanical residue with a regex. This file is the residue that
needs judgment - the things a scanner cannot see, grouped by what they cost.

## Unverifiable claims

"Should work now" · "fixed" with no cause explained · results described from memory rather
than from the terminal · a hypothesis stated as a finding.

Cost: the first confident false answer makes every later answer suspect. Only report what a
command printed, and separate verified from inferred from unknown.

## Deferred debt

`TODO` with no owner · "add later" around a missing capability · `return null` where a
contract is promised · fake data in a production path · commented-out code · "cleanup" as a
backlog category.

Cost: each one is a promise to the caller that the code never keeps. Finish it, or track it
with an owner and an issue, or remove the exposed surface.

## Structural chaos

Business logic in a UI, controller, or route handler · layer violations · import cycles ·
`utils.ts` dumping grounds · one 1000-line file · a function whose branches need a comment ·
a module that does IO, rules, and formatting at once.

Cost: unchangeable, untestable, unreviewable. The tangle in the brief is exactly this: every
wire soldered to whatever was nearest. The fix is named endpoints and intentional topology,
not working harder on the tangle.

## Copy-paste culture

Two similar blocks are fine. Three is a shared abstraction. The same applies to validation,
error messages, config constants, and "I copied the old file and edited it" - which also
inherits the old file's bugs and dead code.

## Data and failure

Unvalidated input at the boundary · string-built SQL · secrets, tokens, or real user data in
code, logs, or fixtures · destructive migrations with no rollback · unbounded queries and
uploads · empty `catch` · `Something went wrong` as an error message · `null` meaning both
"absent" and "failed" · unbounded retries.

Cost: the first four are unrecoverable once pushed; the rest are the bugs that survive to
production because nothing ever said they were wrong.

## Process shortcuts

Straight to a protected branch · one commit of unrelated work · rewriting published history ·
`git add .` with unknown contents · skipping a pre-existing failing test · a cross-cutting
change with no plan · "just try this" experiments left in the tree.

Cost: unreviewable and unbisectable history, and unknown behavior shipping.

## Documentation debt

README describing the old behavior · a non-obvious decision with no comment and no ADR ·
comments narrating the line below them · examples that no longer run.

Cost: actively misleading, which is worse than absent.

## The two failure modes behind all of it

Everything here is **unverified** or **unowned**. Fix the verification first, then attach an
owner and a design to everything left.
