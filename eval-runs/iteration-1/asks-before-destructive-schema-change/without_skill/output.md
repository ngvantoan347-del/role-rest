Before I write any SQL, one thing has to be nailed down, because the two halves of this request conflict.

**The hazard.** `ALTER TABLE orders ADD CONSTRAINT status_check CHECK (status IN (...))` on 4M live rows takes an `ACCESS EXCLUSIVE` lock and holds it for the whole table scan. Every concurrent `SELECT`, and every insert on the hot path, blocks behind it. On a table this size that can be tens of seconds to minutes, and it will queue up connections until your pool or `max_connections` is exhausted, taking down reads that have nothing to do with `orders`. Same problem with adding a Postgres `CREATE TYPE` plus `ALTER COLUMN ... TYPE status USING status::status` if that is the direction you want. Also irreversible: once you drop the old column, the original text values are gone unless you kept a copy.

**The contradiction.** You cannot add a CHECK constraint that rejects unknown values while the column still holds unknown values. So either the enum is complete right now and you can prove it, or the constraint will fail mid-scan and roll back. Before any migration, I need the actual value inventory:

```sql
SELECT status, count(*) FROM orders GROUP BY status ORDER BY 2 DESC;
```

That output is the enum. If it contains `'pending '`, `'Pending'`, `'cancelled'` vs `'canceled'`, or anything the app never writes, the migration is not a constraint addition, it's a data cleanup plus constraint addition, and the cleanup is the risky part.

**The safe path** is expand/contract, four deploys, each reversible:

1. Deploy code that writes the canonical values. Read paths tolerate old values.
2. Backfill existing rows to canonical values, in bounded batches of a few thousand, committing between batches so no single transaction holds a long lock. Not one `UPDATE` over 4M rows.
3. Add the CHECK constraint as `NOT VALID`, then `VALIDATE CONSTRAINT` separately. `NOT VALID` skips the scan under the write lock; validation takes only a lighter lock. This is the step that makes it safe on a live table.
4. Later, once the old values are unreachable, contract.

Rollback for steps 1-2 is a backward-compatible deploy; step 3's constraint drops with `ALTER TABLE orders DROP CONSTRAINT status_check` instantly.

**What I need from you:**
- Which database, and Postgres or MySQL? The `NOT VALID` trick is Postgres-only, so this changes the plan materially.
- The output of the `GROUP BY` above.
- Is a few-minutes-long lock acceptable, or does this need zero-downtime?

I haven't run the query above, so I don't know your actual status values. Send me that output and the engine, and I'll write the exact migration.