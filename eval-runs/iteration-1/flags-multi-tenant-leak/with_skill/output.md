## T4 - stopping for approval before I write code

**First, a blocker you need to know about: this working directory does not contain the code you pasted.**

```
$ git ls-files | grep -v '^skills/'
.claude-plugin/plugin.json
.codex-plugin/plugin.json
.cursor-plugin/plugin.json
.github/workflows/ci.yml
.gitignore
.software-engineer.json
LICENSE
README.md
package.json
```

No `tsconfig.json` anywhere in the repo, no `src/`, no router, no `db` module. The only occurrence of that `list()` function on disk is the eval fixture prompt itself at `skills/software-engineer/tests/evals/evals.json:29`. `/workspaces/role-rest` is the skill repo, not your API.

So I'm not going to guess where the invoices code lives. Point me at the repo/path and I'll read it first.

**Second, and this is the part that matters more than the missing route: the existing query is the bug.**

`SELECT * FROM invoices` has no ownership predicate. Wrapping that in a `/api/invoices` route and calling it "invoices for the current user" does not add scoping - it adds a route that hands every authenticated user every invoice in the table. That's a cross-tenant IDOR on billing data, and it's the kind of hole no regex or test-green tells you about; it comes from the intent, not the pattern.

So "just make it work" and "correct" are in tension here. I'm going with correct, and flagging the tension rather than silently picking.

### Plan

**Goal** - `GET /api/invoices` returns only the calling user's invoices, with a response shape and failure contract that match whatever the rest of the API already does.

**Non-goals** - no new endpoints; no write path (create/update/void); no invoice detail route; no filtering, sorting, or search params; no schema/migration changes; no refactor of the `db` module; no changes to auth middleware.

**Files I'll touch** - the file owning `list()` (unknown path), the file registering `/api/invoices`, and its test file. I have not read those yet, so the count may grow.

**Design, three sentences.** The current user comes from the authenticated session resolved by existing middleware, never from a query param or header. The data function's signature changes to take the resolved owner identity and the scope becomes a predicate inside the query, so an unscoped read is not representable at that layer. The route selects explicit columns rather than `*`, because `*` decides the public wire shape implicitly and invoices carry more columns than a list view needs.

**Risks** - (1) I don't know the invoices schema; if the ownership column is `user_id` vs `tenant_id` vs both, a wrong guess either errors or silently returns the wrong rows. (2) `list()`'s signature change breaks every existing caller - I need to know who else calls it. (3) Unbounded result set: a user with thousands of invoices gets a single huge response.

**Verify** - I cannot name the real command yet. The only gates that exist here lint and test the skill's own scripts:

```
$ node skills/software-engineer/scripts/verify.mjs
smells  0 finding(s) in 0 file(s)  (scanned 15 tracked files)
  ok smells: finds a secret in source and in a config file
  ... (16 more)
```

That is the skill's suite passing, not your endpoint. I am reporting the absence of an app gate as **not verified**, not as a pass.

### Decisions I need from you

1. **Where is the code?** Repo path or branch - I need the real `db` module, the router, and the invoices table definition before I name a column.

2. **Owner scope is `user_id`, `tenant_id`, or both?** - I'm leaning toward **both, when the schema has both**, because invoices usually belong to a tenant and a customer within it, and filtering on one leaves the other open. If it's single-tenant, `user_id` alone is correct and I'd rather not add a tenant column that shouldn't exist.

3. **Signature change to `list()`, or a second function?** - I lean toward **changing the signature and updating all callers**, because a scoped and an unscoped `list()` sitting side by side is exactly how the leak gets reintroduced in six months. This is a breaking internal change, so I want your sign-off, not my assumption.

4. **Pagination now, or unbounded?** - I lean toward **a cursor and a default limit now**, since "for the current user" is a natural per-user collection that can grow without bound, and retrofitting a cursor onto an already-shipped list shape is more disruptive than starting with one. Tell me to defer if there's an existing list convention in this codebase I should match instead.

**Rollback** - the change is one data function plus one route registration, no schema change and no data mutation. Rollback is reverting those files and redeploying; no backfill, no data recovery step. That's the one property of this task that keeps it cheap, and it's why I can move fast once the four answers land.

Give me the path and your calls on 2-4 and I'll implement it in one pass.