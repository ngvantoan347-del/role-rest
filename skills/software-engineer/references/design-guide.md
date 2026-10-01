# Design Guide

The decisions that are expensive to reverse. Read fully before a T3 change, skim the
relevant section for T2.

Filter criterion: keep only what **gets skipped when you are in a hurry**, with the reason.
Pure technical knowledge - what HTTP is, what a transaction is - does not belong here, you
already know that. What belongs is what you know but skip under deadline pressure.

## Boundary - why this is the most expensive thing to change

The hardest part of a system is not the logic inside it, it is the boundaries between the
parts. Function signatures and data shapes are what **everything else depends on**, and they
get locked in very early - changing them later costs orders of magnitude more than changing
them first.

```text
UI / CLI  ->  Application (use case)  ->  Domain (rule)  ->  Port
                                                        ^
                                          Adapter (IO) --+
```

- One-way dependency. `domain` imports nothing from `adapter` or `ui`.
- Cross-module communication goes through a named interface, not a direct import into
  internal state.
- **Every new import line is an architecture claim.** Read them before you commit.
- A module's public API = what it exports. The rest is private, and changeable on request.
- A cycle means a shared concept belongs to a third module, not an import bug.

## Contract - what to declare for every new boundary

| Element | Question it must answer |
| --- | --- |
| Input | type, required or optional, unit, nullability, limits |
| Output | shape, ordering, pagination, how empty differs from null |
| Failure | which errors, throw or return, which are retryable, who handles them |
| Side effect | what it writes, network, file, event, transaction, whether it is idempotent |
| Limits | rate, size, timeout, retry count, backpressure |
| Compatibility | who consumes it, do old callers still run |

Return errors **as values** in the core and throw at the edge, so the compiler forces the
caller to handle it. Reserve exceptions for genuinely rare cases.

Every export is a promise you have to keep. Keep the public surface small.

## Backward compatibility

- **Add, do not rename or repurpose a meaning**, in the same change.
- Support both shapes for the whole deprecation window, measure usage, remove at zero.
- Breaking change = major version + migration note + a date.
- For data you do not control - stored rows, cached payloads, third-party callbacks -
  **assume old and new exist at the same time** and make the reader accept both.

A migration is another kind of breaking change: read it that way.

## Data

- Model the **domain**, not the database. Business rules belong to the type, not the query.
- **Make the wrong state unrepresentable**: enum instead of string, `Email` instead of
  `string`, `PositiveAmount` instead of `number`, non-empty instead of nullable. Much cheaper
  than checking everywhere.
- Stable id + `createdAt`/`updatedAt` for anything persisted.
- UTC when storing, local when displaying, **always write the unit down**.
- Money: integer of the smallest unit, or a decimal type. **Never binary float.**
- Deletion: pick soft or hard per entity, and be consistent. Soft-deleted rows must be
  excluded by default in **every** query.
- Migrations: forward-only, additive by default, must run safely while old code still
  serves traffic, with a rollback or an explicit statement that there is none.

## Error and observability

- **Never swallow.** If ignoring it is genuinely correct, log it with context and reason.
- Keep the cause when you wrap an error.
- Messages are for the operator: what failed, which id, the likely cause. Not copy for the
  user, and never leaking internals or secrets.
- Structured log fields with a correlation id, not prose sentences.
- If the handoff says "monitoring", there must be a real metric, log line, or alert.

## Security

Why this is the most skipped section: nothing fails a test when you forget it.

- Secrets from env only. No literals, no committed config.
- Validate **every** input at the boundary: from clients, from the network, from files.
- Parameterize queries. Never build SQL out of strings.
- Escape output. No `dangerouslySetInnerHTML`, `eval`, `exec`, or shell interpolation of
  untrusted values.
- AuthN + authZ at **every** boundary. Deny is the default.
- **Do not log or return more personal data than the feature needs.**
- Rate limit and payload limits on everything public.
- Dependencies: prefer maintained packages, read install scripts, audit before adding
  anything that touches network, filesystem, or crypto.

## Extensibility without over-engineering

- Solve today's problem with the simplest structure that satisfies the contract.
- Abstract when there are **two** genuinely different variants, or when the third copy
  shows up - not when an imagined future variant does.
- Config and composition over inheritance and monkey-patching.
- When you add a seam, keep it narrow: one interface, one obvious implementation.

The cost of early abstraction: it freezes a wrong guess. The cost of not abstracting: every
copy multiplies every bug by N.

## Size

- One responsibility per file; the file name matches the contents.
- Group by **feature**, not by file type, once the project passes a few modules.
  (`features/checkout/`, not scattered `services/`, `utils/`, `helpers/`.)
- Warn at ~300 lines, do not create new files over ~500. A big file is a signal to split, not
  a reason to keep appending.
- A function that needs a comment to explain a branch is too long.
- Config, secrets, generated code live outside the source tree.

## Performance

**Only optimize what you have measured.** Why: optimizing by feel usually makes things
slower, adds complexity, and creates false safety - worse than not optimizing at all.

1. Have a number: profile, benchmark, or read the slow query plan.
2. Find the real bottleneck (usually I/O or an N+1 query, not the language).
3. Make the smallest change that moves the number.
4. Measure again and report before/after.

Check these first, in rough order of frequency: N+1 queries, unbounded `SELECT *`, missing
pagination, sync IO in the request path, missing timeouts on outbound calls, in-memory
caches with no limit.
