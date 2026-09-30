# Design Guide

The decisions that are expensive to reverse. Read before a T3 change, skim the section for
T2. Everything here the model already knows is the house style; what follows is the subset
that is easy to skip under time pressure.

## Boundaries

Dependencies point one way: `UI -> application/use cases -> domain/rules -> ports`, with
adapters implementing the ports and depending inward. Never inward-to-outward. Cross-module
communication goes through a named interface, not a direct import of internals. Cycles mean
the shared concept belongs in a third module.

Check the new import lines before you commit: every one is a structural claim.

## Contracts

Every new boundary declares: input (types, nullability, bounds, units) · output (shape,
ordering, pagination, empty vs null) · failure (which errors, thrown or returned, who
retries) · side effects (writes, network, events, idempotency) · limits (timeout, size, rate)
· compatibility (who consumes this, can old callers keep working).

Return errors as values in the core, throw at the edges, so the type system forces handling.

## Backward compatibility

Add, never repurpose, in the same change. Support both shapes through a deprecation window,
instrument usage, remove at zero. A break is a major version plus migration notes. For data
you do not control - stored rows, cached payloads, third-party callbacks - assume old and
new coexist and make the reader accept both.

## Data

Model the domain, not the database. Make invalid states unrepresentable: enums over strings,
`Email` over `string`, non-empty over nullable. Stable id plus `createdAt`/`updatedAt` on
anything persisted. UTC storage, explicit units. Money in integer minor units, never floats.
Decide soft vs hard delete per entity and be consistent - soft-deleted rows excluded by
default everywhere.

Migrations: forward-only, additive by default, safe to run while old code still serves
traffic, with a rollback or an explicit statement that none exists.

## Errors and observability

Never swallow. Preserve the cause when wrapping. Error messages are for operators: what
failed, which id, likely cause - and must not leak internals or secrets. Log structured
fields with a correlation id, not prose. If the handoff claims "monitoring", there is
actually a metric, log line, or alert behind it.

## Security

Secrets from env only, never literals or committed config. Validate all input at the
boundary. Parameterize queries. Escape output - no `eval`, `exec`, or shell interpolation
of untrusted values. AuthN and authZ on every new path, deny by default. Collect no more
personal data than the feature needs. Cap payload sizes and rate limit anything public.

## Extensibility

Solve today simply. Abstract at two genuinely divergent variants or the third copy, not at
an imagined future one. Prefer composition over inheritance. Keep the public surface small:
every export is a promise.

## Size

One responsibility per file, named for what it holds, grouped by feature once there is more
than a handful of modules. Warning at ~300 lines, no new file past ~500. A function needing
a comment to explain its branches is too long. Config, secrets, and generated code stay out
of the source tree.

## Performance

Optimize only what is measured: get a number, find the actual bottleneck, smallest change,
re-measure and report before/after. Check first for N+1 queries, unbounded `SELECT *`, missing
pagination, sync IO in a request path, missing timeouts, and unbounded in-memory caches.
