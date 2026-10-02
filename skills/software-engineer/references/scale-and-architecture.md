# Scale and Architecture

System-level decisions: whether to split a service, sync or events, how far to cache, who can
see whose data, how to roll back. This is the part dropped fastest when the deadline bites,
because everything here runs; nothing goes red as you write it.

Mistakes at this level do not surface as you write them, and usually not in someone else's review.
They surface when traffic grows, when the second tenant appears, on the
third deploy of the day - by then the cost of the fix is a hundred times higher and often means a
rewrite. `references/design-guide.md` covers how to set contracts inside one process; this file
covers what happens when that contract crosses a wire, a queue, and hundreds of packages.

Filter: keep only what gets dropped under deadline pressure. Pure technical definitions are not
here - terminology is not content.

## 1. Monorepo and polyrepo

Layout decides **how you verify**, before you get to thinking about code quality. A monorepo gives you one commit, one search, one dependency graph, and cross-package refactors with no version dance; it charges the whole repo's blast radius for every commit. A polyrepo flips that trade: independent deploys, contracts explicit in versions, and you pay with no global search plus manual version pinning.

The monorepo's real problem is **gates that cost too much**, not the build tool. A 20-25 minute full suite for a one-line fix means "I'll verify later" becomes the default - you just built yourself a reason to skip verification. The number 200 packages is a property of the repo architecture, not of your carelessness. A cheap gate is an architecture requirement.

```bash
nx affected -t typecheck,lint,test --base=origin/main   # affected packages
turbo run test --filter=...[origin/main]                 # affected tasks + packages
bazel query 'rdeps(//..., //libs/shared:all)'          # reverse deps = the compat surface
pnpm -F <pkg> test && pnpm why <dep>                    # gate one package, find its dependents
```

Do not hand-roll an "affected" command with a shell script comparing paths - it misses the multi-package case, which is exactly the case you most need gated. Ecosystem details: `references/stack-commands.md`.

| Mistake | Why |
| --- | --- |
| Running `nx run-many -t test --all` | You pay for 199 unrelated packages to avoid mapping the dependency graph |
| Testing only the package you changed, skipping packages that import it | The bug lives in the consumer, not in the changed package |
| Ignoring the lockfile in the diff | A changed lockfile means the whole dependency tree can change versions |
| Treating config files as unaffected | Config often lives in another package; build tags and path aliases follow it |

A shared package with N internal consumers is **one public API with N callers** - changing its signature is a breaking change for all N, and it is where a small bug touches the most people. Ask `rdeps` / `pnpm why` before you change, and also ask whether consumers exist in other repos.

## 2. Services and boundaries

Splitting a service is more a network organization decision than a technical one, and it costs far more than an interface. Do not split just because "it will scale" - that is the argument of someone who has not measured.

| Situation | Choice | Why |
| --- | --- | --- |
| Same domain, same deploy rhythm, same team | Module boundary | Splitting a service buys network, deploy and version contracts, and buys no independence |
| Owns its own data, different deploy rhythm, different team | Service | This is where a service pays off: independent deploys and blast radius |
| Needs a different scale profile (CPU-bound vs IO-bound) | Split processes first | Much cheaper and it keeps internal transactions |
| Nobody owns anything after the split | Do not split yet | Ownership is the real reason to split, the network is only a consequence |

**Sync or events.** Use sync when the caller needs the result to decide the next step, or needs immediate backpressure. Use events when you only need to know "it happened" and the consumer can tolerate lag. Why: sync turns infrastructure latency into your latency, and infrastructure does not carry your SLA; sync also propagates failures, events isolate them. Querying data across the boundary with a sync call is you writing a distributed join and then debugging it yourself. Whichever you pick, the contract must still declare the items in the Contract table in `references/design-guide.md`.

### When a dependency degrades

This is the part nobody tests until it happens for real, because locally everything is fast and still alive.

| What the dependency does | What breaks, and what blocks it | Why |
| --- | --- | --- |
| Latency goes up 10x | Connection pool fills up - you need timeouts | No timeout means each request holds a connection until the default expiry. Budget backwards from your SLA, and you need a `pool` timeout, not just read/write |
| Availability drops | Capacity goes away - you need retry + backoff + jitter, then a circuit breaker | Unbounded retry turns their incident into your load; with no breaker the retries all land on the thing that is already on fire |
| Slow at a middle hop | The whole chain's latency budget gets eaten | 3 hops × 200ms = 600ms while the SLA is 300ms. Call chains add up, and nobody adds them up |
| One slow dependency eats the whole pool | The rest of the app dies with it - you need a bulkhead | A shared pool gives no isolation, so one weak side drags down everything |
| Incompatible deploy | `null` slips into your logic | Your bug surfaces on their deploy, and you have no evidence for it |

### Retry without an idempotency key is a duplicate write

A client that gets a timeout does not know whether you already wrote, so it retries - exactly as designed. But if the server has no key, the second attempt is a second write. For payment or inventory, that is a data bug, not a behaviour bug.

- The key is generated by the **caller** and kept across retries. A server that
  generates the key itself gives every retry a different key, which means no idempotency
  at all.
- The server stores the key together with the **returned result** in the same transaction as the side effect. Without
  storing the result, a retry returns 2xx and does nothing - the client thinks it succeeded, the data is still wrong.
- The key's TTL must be **longer than the client's retry window**. A `UNIQUE` on the key also
  covers a race between two instances.

## 3. Events and async

A broker guarantees no loss. It does not guarantee no duplication. Every consumer must assume the message arrives one to three times, and must be idempotent from the start - fixing it after duplicate data exists in production costs far more than getting it right the first time.

| What the consumer must do | Why |
| --- | --- |
| Idempotent handler, dedup key stored next to the side effect with a TTL longer than the redelivery window | Dedupe without a TTL is an unbounded table, which means no dedupe at all |
| Assume ordering only when the partition guarantees it | A broker guarantees order **within one partition**, not across partitions |
| Order-sensitive handler uses a state machine, not last-write-wins | With no guaranteed order, last-write-wins silently swallows valid updates |
| Poison message → DLQ after N attempts, keep the original payload and the reason | Retrying a broken message forever means the consumer is stuck permanently and the rest backs up |
| Acknowledge **after** the side effect completes | Acking first means losing the message permanently when the process dies mid-way |
| Handler does no long blocking IO | A partition processes serially; a 2 second handler caps the throughput of the whole topic |
| Replayable from the log | When you find a bug in the handler, rerunning historical data is the last resort, and it has to be feasible |

An event schema is a public contract, not an internal shape. Adding an optional field is fine,
because old consumers skip unknown fields. Changing a field's type or a key's name is not, because
the consumer fails to deserialize at **runtime**, not at build time. Changing a field's *meaning*
(cents instead of dollars, UTC instead of local) is never fine - wrong data with nothing reporting
an error, and that is the most expensive kind of bug. Deleting a field is only allowed after every
consumer has dropped it: measure usage first, do not guess. Do not publish whole rows to the bus - publish the **minimum payload** the consumer needs, plus ids so it can look things up if it really
needs to. A payload that has left your boundary outlives the code that produced it.

**Dual-write.** "Write to the DB then publish the event" is two systems and no transaction covers both. There is always a gap, and it gets found by an unrelated incident, at the worst possible time. A transactional outbox - write the event into an `outbox` table in the same transaction, a separate process reads and publishes it - removes event loss, and gives you back three things: it is still at-least-once so consumers must still be idempotent; publish latency equals poll latency; and one more operational component to deploy, monitor and clean up. Do not treat this as a later task - an event write path without an outbox is debt already incurred, and it gets paid in data loss, not in a ticket.

## 4. Multi-tenant SaaS

The cheapest way to leak data between paying customers is to forget the filter in exactly one
place. And the place it gets forgotten most is not SQL - it is the **cache key**.

| Rule | Why |
| --- | --- |
| `tenant_id` is `NOT NULL` on every table holding customer data, and indexed | Data belonging to no tenant is data nobody remembers at query time |
| Tenant comes from the token/session, **never** from the request body | The body is client-controlled. This is textbook IDOR |
| Every query goes through a single entry point that takes the tenant from context | A constraint applied by hand at each call site is a constraint that will have one gap |
| Every cache key, object path, search index, log field is tenant-prefixed | A shared cache key is a data leak, and it leaves no trace in the logs |
| Row-level security in the DB is the second line of defence | RLS protects you when the app code is wrong. Correct app code is the precondition for RLS doing anything |

The cheapest effective test for this: take tenant A's token, call the API with an `id` belonging to tenant B, assert **404, not 403** - 403 reveals the existence of the data.

A tenant filter in SQL protects **data**, not **permissions** - two separate questions, two separate layers. A global role with no tenant attached is a bypass of the entire tenant scope. A tenant-scoped role (`owner` / `member` of tenant X) covers most B2B SaaS, but not when data is more sensitive than "the whole tenant". Resource-level is needed when the tenant has internal structure: team, project, product line.

| Data isolation tier | What you get | What it does **not** give you |
| --- | --- | --- |
| Shared schema, `tenant_id` as a column | Cheapest, one migration for everyone | One query that forgets the filter is a data leak. One bad index hits every tenant. Backup, restore and downtime are shared too |
| Schema per tenant | Queries need no filter, isolation at namespace level | Does not survive thousands of tenants: a migration = N schemas, connections = N schemas, still one failure domain |
| DB per tenant | Near-absolute isolation, separate restore, noisy neighbour nearly gone | Per-tenant operational cost, cross-tenant queries need separate work, and it is **not** immune to one tenant misbehaving - it just turns into an ops problem |

Choosing a tier is choosing which kind of failure you take. No tier is immune; they differ in whether the failure shows up early or late. And a noisy neighbour needs its own quota at any tier: rate limiting by IP is not rate limiting by tenant - a 500-seat tenant behind one NAT proxy is still one IP.

**Migration and backfill once you have many tenants:** succeeding at 3 tenants does not mean succeeding at a tenant with 40 million rows. A backfill must be **batched** (not one unbounded `UPDATE` - it holds a transaction open and blocks vacuum), **resumable** with a checkpoint so re-running it many times does no harm, tolerant of **both shapes** throughout the backfill (the same backward-compatibility rule in `references/design-guide.md`), **rate-limited** so it does not compete with real traffic, and **instrumented** with a count of rows done. A backfill is a deploy with no rollback, so "resumable" is the only thing that saves it when it breaks halfway.

**Test isolation:** every test creates its own tenant, and fixtures do not carry a baked-in `tenant_id` - a fixture with a hardcoded tenant is a data leak walking silently into the suite. There must be at least one test proving tenant A cannot read tenant B's data; that is the only test this layer and below can protect. Caches and background jobs also need the tenant, because a cache key missing the tenant in tests still goes green and still breaks in production.

## 5. Data at scale

| Pagination approach | When it breaks | Why |
| --- | --- | --- |
| `OFFSET` | An insert or delete happens between two reads | A new row inserted at the front pushes the last record down, the client sees repeats or misses. Reading page 500 still means scanning 500 pages |
| Keyset / cursor | Does not break as long as the cursor is an indexed column | Reads exactly the rows needed, and the order is the index's physical order, so it is stable |
| Cursor on `updated_at` | An update happens between two reads | When `updated_at` changes, items are missed or repeated; the cursor must be based on an immutable key |
| Page size with no cap | The client sends `?limit=100000` itself | One request kills the database |

A cursor should be the pair `(created_at, id)` so the order is unique - with only `created_at`, two rows sharing a timestamp make the cursor ambiguous.

**No caps die in their own way.** A query with no `LIMIT` kills the database; an `IN (...)` built from user input blows up the query plan. Threads, goroutines, connections per request with no cap turn load growth into resource growth instead of throughput. A queue with no length cap means a full buffer becomes a drop or backpressure, and both need an explicit decision. An in-memory cache with no cap OOMs, exactly at peak traffic. Retries with no cap turn an incident into itself multiplied.

**N+1 at the ORM layer:** default lazy loading is an N+1 - one query fetches N rows, then N queries, one per row. It does not surface with 10 rows of data and surfaces when the table has 10 thousand. How to catch it: count queries on **one real endpoint**. Turn off lazy loading in dev so an N+1 becomes an exception on the first run - that is why it is worth configuring.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;   -- Postgres
EXPLAIN SELECT ...;                        -- MySQL
```

Four things to look for in the plan: is the index actually used, estimated rows versus actual rows, any unexpected sort/temp sort, and which index is being fully scanned. Build an index on a large table with `CREATE INDEX CONCURRENTLY` (Postgres) - a normal index blocks writes for the whole build. And an index is a write cost: adding an index for every column in a `WHERE` is optimization by making everything slower.

**Partitioning and archival.** Partition by time when the table has retention: it turns "cleaning up old data" from a bulk `DELETE` - slow, locking, generating enormous WAL, knocking over replication - into a near-instant `DROP`. A table nobody queries any more moves to cold storage; keeping it there only costs money without creating value.

**Caching.** TTL always exists, even when you think it does not need one - a cache with no TTL lives forever and lives wrong. Invalidate explicitly on write when the key is known, because relying on a TTL for user data that is read right after a write means they see stale data. The key must reflect every dimension that changes the result, including identity and tenant - a key missing one permission dimension is a cache read of someone else's data. Use single-flight for hot keys, because a cache stampede means N requests hitting the DB at once the moment the key expires.

**Backpressure.** When the consumer is slower than the producer, three options, and all three must be said out loud before you install one: cap the input (503), trading away some traffic but clearly and measurably; buffer with a limit then drop in a controlled way, only allowing event types that are droppable, so data loss is by design and not an incident; or block the producer, hold the data, and reduce throughput system-wide. Silence is the fourth option, and it becomes an OOM at peak load.

## 6. Concurrency and distributed correctness

| Bug | Mechanism | Why |
| --- | --- | --- |
| Lost update | `UPDATE ... WHERE version = $1`, or `SELECT ... FOR UPDATE` | Read-then-write is not atomic; two requests read the same value and each overwrites the other |
| Double submit | An idempotency key from the client | Without a key that is two **technically valid** transactions - the system is doing exactly what was asked |
| TOCTOU | A `UNIQUE` constraint, `INSERT ... ON CONFLICT DO NOTHING` | The gap between `SELECT` and `INSERT` is where the second request slips in |
| Two workers claim one job | `SELECT ... FOR UPDATE SKIP LOCKED` in a transaction, with a lease that expires | Worker dies without releasing the job → the lease expires and it can be claimed again → the handler must be idempotent |
| Distributed lock | `SET key value NX PX ttl` **and** a lock-resolution primitive | A lock whose TTL expires while you still hold it → two owners at once. And nobody can hold the contract between the lock and the DB transaction |
| Cache stampede | Single-flight, jittered TTL | A hot key's TTL expiring = N requests hitting the DB at once |

A `UNIQUE` constraint usually beats a distributed lock: a lock protects you from two processes acting at once, a constraint protects you from every client including clients that do not go through the lock. The constraint lives in storage so it does not vanish when a process dies. When a rule can be expressed as a constraint, use the constraint - a lock is the answer for the thing you do not yet know can be expressed.

**Clock skew.** A host off by a few seconds is enough to break expiring tokens, webhook signature verification, and work queue leases. Why: you are comparing host A's `now()` with host B's `now()`, and neither is absolutely right - whatever produces "5 minutes ago" is "5 minutes from now" with just a few seconds of drift. For tokens and signatures: rotate secrets with an **acceptable skew limit** written down explicitly. For leasing and dedup: use a version counter from storage, not the clock. For reporting: use the server clock as the source and state the timezone.

**"Exactly-once" is a lie told with a transaction in the wrong place.** A database transaction is local to one database: it does not cover an HTTP call, it does not cover the broker, it does not cover the queue. What you actually get is at-least-once plus an idempotent consumer, and in most systems that is enough. When someone says "exactly-once", ask two questions: which boundary, and when it breaks, what state is the data in. The second question usually has no answer, and that is the answer.

## 7. Observability is a delivery requirement

A change with no observability is a change that is not done - not a "later" task.

| Must ship with | Why |
| --- | --- |
| A structured log with a correlation id | The only question at 3am is "where did this request go" |
| A metric for the new behaviour | A metric is the thing with a before/after number. A log is the thing you read after you already know there is a problem |
| Trace propagation across every outbound call | Without a trace the diagnostic chain is guesswork |
| A dashboard if the metric is dangerous enough to need an alert | A metric nobody looks at does not exist |

The module-level log section is in `references/design-guide.md`. This is the system-level part: the things that must exist before it reaches users.

**A correlation id must cross async boundaries.** Put it in the header/message metadata on send; the consumer picks it up, keeps it when logging, and creates a new id for child spans. Otherwise you have a log at the producer and a log at the consumer with no link - exactly when you most need the trace, you do not have it. Same mechanism for trace context over HTTP and across the message broker. And **metrics must not carry ids**: a metric labelled with a user id, tenant id or request id is a dead metric - cardinality explodes, and it costs money in a way you cannot measure.

**Alert on symptoms, not causes.** CPU > 80% is a bad alert: it is not always a problem, and it fires exactly when you are scaling legitimately. Good is a 5xx ratio or p99 latency over SLO - something users feel. Similarly, queue depth is a consequence while end-to-end latency is what the user is waiting on; pod restarts are ops' job while error rate per endpoint is yours. An alert needs a clear action: "endpoint is slow" does nothing, "checkout p99 > 2s for 15 minutes" does.

**SLOs and error budget.** Measure by user journey, not per service, so it decides behaviour - and the budget then lets you ship fast and stops you fixing first. This is what turns "being careful" from a feeling into a rule, and the only thing that fights alert fatigue. The number must be signed off, not defaulted: an SLO of 99.9% means roughly 43 minutes of downtime a month for every user at the same time, and it needs someone accountable for reading it and accepting it.

**"We'll add monitoring later"** never gets added, because by then the incident is over and nobody has the details any more. Adding observability to a three-month-old change is close to writing it from scratch.

## 8. Release and rollback in a large organisation

**A feature flag is a contract**, and every attribute has a reason: it has an owner, naming a person or team, because a flag nobody owns is a flag nobody deletes. It has an expiry date written in code, because a flag that lives forever is a branch of code you no longer test and nobody dares delete because it might be on somewhere. It has a reassessment step at every deploy, or the dead-flag rate grows monotonically. Both states must be tested - flag off is code that has never run, flag on is a path that is tested; missing one of the two means you have a branch nobody verifies. And a flag is an escape hatch, not a configuration mechanism: a pure variant change is a label. Flag debt is the same kind of debt as `TODO` debt.

| Rollout step | Stop when | Why |
| --- | --- | --- |
| Canary: real traffic to the new instance, old stays | The new instance's error rate or latency is worse | Direct comparison, no control group needed |
| Percentage: 1% → 10% → 50% | A metric degrades beyond background noise | You need a with/without comparison, otherwise you do not know whether it is you or today |
| Internal user ring | Internal users see an error that external users do not | That is you testing in the wrong place and shipping it |

Invariant: **widen slowly, shrink fast.** If you need a meeting to roll back, it was not a controlled rollout.

**A boring rollback** needs four conditions, and missing one loses the other three:

1. A rollback is just a deploy of the old version, with no reverse code to
   write.
2. **Old code can read new data.** This is the most-skipped condition: adding a `NOT NULL` column, changing a type, `RENAME` a column, or adding a value to an enum that old code does not know - all of these crash old code **after** you roll back. Redeploying the old version and finding it does not run is the worst outcome that can happen.
3. The failure path is separated from the happy path by a flag, so it can be turned off without
   a rollback.
4. You know in advance who decides the rollback and how long it takes to get
   them.

Condition 2 is why `design-guide.md` requires additive migrations and readers that accept both shapes.

**A config change is a deploy too.** It goes through the same pipeline, has the same chance of breaking, and usually has no feature flag, no test and **nobody** has ever rolled it back. Bad config breaks production no less than a bad deploy, and it is skipped in every rollback plan. A config that changes behaviour must be versioned, reviewed, and have a safe default.

| Migration step | What it does | Runs with old code |
| --- | --- | --- |
| Expand | Add a new nullable column, delete nothing | Yes |
| Migrate | Backfill, write the new column, read the new column when ready | Yes |
| Contract | Drop the old column, add `NOT NULL` | Only when **no** instance is running old code |

This order is mandatory because old and new code always coexist during a large deploy, so
contract before expand is how you create a non-rollbackable incident. And "old code is dead" is
a claim that has to be measured with a metric, not inferred from "I finished deploying".

## 9. Questions to answer before calling a change done

This is the enterprise-height version of the table in section 6 of `SKILL.md`. Every question
has to be answered with a number, a command, or a `path:line`. An unanswered question is a gap
to **report**, not a detail to skip.

| Question | Answer it with |
| --- | --- |
| At what N does this behaviour change? | A number: rows, tenants, messages/s, packages |
| Which packages does this change affect, and have I run their gates? | The output of `nx affected` or `turbo --filter` |
| Who depends on what I changed, in this repo and in other repos? | `rdeps`, `pnpm why`, the import graph |
| If a dependency is slow or dead, what does this request path do? | Timeouts, breaker, bulkhead already in place |
| What happens if this message arrives twice? | An idempotency key or a dedup key |
| Which personal data does this payload carry, and where is it stored? | A field list and the storage locations |
| What plan does this query get at N million rows? | `EXPLAIN (ANALYZE, BUFFERS)` |
| What if this tenant uses 1% of the data and 100% of the connections? | Per-tenant limits already in place |
| Is there any path that reads this data without `tenant_id`? | A query audit; a test proving tenant A cannot read tenant B's data |
| Does state break if two requests arrive at the same time? | A concurrency test, `go test -race`, constraints in place |
| On rollback, can old code read the new data? | Diff the schema before and after, name the new columns |
| How do I know it is broken, and how fast? | Metric + alert + dashboard, with names |
| Does this change have a flag, and when does the flag expire? | Flag name, owner, date |
| What does this system do if the layer below dies 100%? | Behaviour on dependency death: block, degrade, or die with it |

## When to read this file

- The change touches more than one package, one process, or one service.
- Your diff contains `tenant_id`, cache, queue, event, retry, lock, or
  `idempotency`.
- Multiple customers share the system and their data must not mix.
- Before calling a design "big enough" - ask how it breaks when N grows a hundredfold.

What you do not need yet: a one-person project, no second customer, a single process. There
most of what is in this file is over-engineering, and `references/design-guide.md` is enough.

## Final judgment

None of the above exists to make the system more complex. It all comes down to one question:
**when something breaks, do you know exactly where it broke, and can you get back?**

A change with no answer to both of those is not done - no matter how clean the code, how green
the tests, and how approved the PR.
