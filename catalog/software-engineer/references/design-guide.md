# Design Guide

Contracts, boundaries, and the decisions that are expensive to reverse. Read this before
writing the first line of a T3 change, and skim the relevant section for T2.

## 1. Boundaries and dependency direction

A module owns one responsibility. Other modules depend on its **contract**, never on its
internals.

```text
UI / CLI  ->  Application (use cases)  ->  Domain (rules)  ->  Ports
                                                        ^
                                          Adapters (IO) --+
```

Rules that keep a codebase from becoming spaghetti:

- Dependencies point one way. `domain` imports nothing from `adapters` or `ui`.
- Cross-module communication goes through a named interface, not a direct import of
  internal state.
- No cycles. If A needs B and B needs A, the shared concept belongs in a third module.
- Public API of a module = its exported surface. Everything else is private and free to
  change.
- Check the new import lines before you commit: every one of them is a structural claim.

The image in the original brief is the failure mode: a bundle of wires with no labels,
where each connection was made by whoever was nearest. A labeled patch panel is the same
wires - it works because the endpoints are named and the topology is intentional.

## 2. Naming

- Names are the primary interface. If the name needs a comment, the design is unfinished.
- No abbreviations unless they are the domain's own (`id`, `url`, `http`).
- Boolean names read as predicates: `isActive`, `hasPendingItems`, `canRetry`.
- Functions are verbs with objects: `createOrder`, `cancelOrder`, `reconcilePayments`.
- No `data`, `info`, `manager`, `helper`, `util`, `handler` as a type name. Name the
  responsibility: `OrderRepository`, `RetryPolicy`, `CsvOrderExporter`.
- Rename immediately. A wrong name propagates and is the most expensive thing to fix later.

## 3. Interfaces and contracts

Every new boundary declares:

| Element | Question to answer |
| --- | --- |
| Input | Types, required vs optional, units, nullability, bounds |
| Output | Shape, ordering, pagination, empty vs null |
| Failure | Which errors, thrown or returned, which are recoverable, who retries |
| Side effects | Writes, network, files, events, transactions, idempotency |
| Limits | Rate, size, timeout, retry count, backpressure |
| Compatibility | Who consumes this? Can old callers keep working? |

Prefer returning errors as values in the core and throwing at the edges, so callers are
forced by the type system to handle failure. Reserve exceptions for genuinely exceptional
paths.

### Backward compatibility

When changing something already consumed:

1. Add, never rename or repurpose, in the same change.
2. Support both shapes during a deprecation window.
3. Instrument usage, then remove once usage hits zero.
4. Breaking change = major version + migration notes in the changelog + a stated date.

For data you do not control (stored rows, cached payloads, third-party callbacks), assume
old and new versions coexist in the wild and make the reader accept both during the window.

## 4. Data modeling

- Model the domain, not the database. Business rules belong on the type, not in a query.
- Make invalid states unrepresentable: enums over strings, `Email` over `string`,
  `PositiveAmount` over `number`, non-empty collections over nullable arrays.
- Identity is explicit. Every persisted entity has a stable id and, where useful,
  `createdAt` / `updatedAt`.
- Timestamps: store UTC, render local, be explicit about units.
- Money: integers of the minor unit or a decimal type. Never binary floats.
- Deletion: decide `soft` vs `hard` per entity and be consistent. Soft-deleted rows must be
  excluded everywhere by default.
- Normalize until it hurts: reference data in tables, volatile/read-heavy data denormalized.
- Migrations are forward-only, additive by default, and must be safe to run while the old
  code is still serving traffic. Write the rollback or state that it is impossible.

## 5. Errors and observability

- Define failure modes explicitly and handle each one deliberately.
- Never swallow an error. If it is genuinely ignorable, log it with context and say why.
- Preserve the cause: wrap with context, keep the original.
- Error messages are for operators: what failed, the identifier, the likely cause. They
  are not user-facing copy and must not leak internals or secrets.
- Log structured fields, not prose sentences. Include a request or correlation id.
- Instrument the things you claim to monitor: if the summary says "monitoring", there is
  a metric, a log line, or an alert behind that claim.

## 6. Security baseline

- Secrets from env or a secret store. Never literals, never committed config, never logs.
- Validate all input at the boundary; trust nothing from the client, the network, or files.
- Parameterize queries. No string-built SQL.
- Escape output. No `dangerouslySetInnerHTML`, `eval`, `exec`, or shell interpolation of
  untrusted values.
- AuthN and authZ at every boundary. Deny by default.
- Don't log or return more personal data than the feature requires.
- Dependencies: prefer well-maintained packages, check install scripts, audit before
  adding anything that touches the network, filesystem, or crypto.
- Rate limit and cap payload sizes on anything public-facing.

## 7. Extensibility without over-engineering

- Solve today's problem in the simplest structure that satisfies the contract.
- Abstract when there are two concrete variants that differ meaningfully, or a third copy
  appears - not when a future variant is imagined.
- Prefer configuration and composition over inheritance and monkey-patching.
- Keep public surface small. Every exported function is a promise you must keep.
- When you do add a seam, make it narrow: one interface, one obvious implementation.

## 8. Structure and files

- One responsibility per file; filenames match their contents.
- Group by feature, not by file type, once the project has more than a handful of modules.
  (`features/checkout/`, not `services/`, `utils/`, `helpers/` dumping grounds.)
- Keep a size ceiling: a warning at ~300 lines, a hard stop for a new file at ~500. Large
  files are a signal to split by responsibility, not to keep appending.
- Functions that need a comment to explain their branches are too long; split them.
- Colocate a module's test next to it. Keep fixtures small and explicit.
- Configuration, secrets, and generated code stay out of the source tree proper.

## 9. Performance and scale

Only optimize what is measured. Before changing anything for speed:

1. Get a number: profile, benchmark, or read a slow query plan.
2. Identify the actual bottleneck (usually I/O or N+1 queries, not the language).
3. Make the smallest change that moves the number.
4. Re-measure and report before/after.

Cheap wins worth checking by default: N+1 database queries, unbounded `SELECT *`, missing
pagination, synchronous IO in a request path, missing timeouts on outbound calls, and
unbounded in-memory caches.
