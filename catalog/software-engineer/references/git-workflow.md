# Git Workflow

Git is the project's memory. These rules keep history readable, changes revertible, and
secrets out of it.

## Before staging

`git status` and `git diff`, every time, before every stage. Never commit what you have not
read. Confirm the branch. Scan the diff for `.env`, credentials, tokens, keys, real user
data, internal URLs with embedded passwords. Keep build output and dependencies out.

## Branches and commits

One branch per unit of work. One concern per commit - a commit doing two things can only be
reverted all or nothing. Each commit leaves the tree working: compiles, tests pass. Separate
refactor from behavior change; mixing them makes the diff unreviewable and the revert unsafe.

Message: imperative subject under ~72 chars, blank line, then the **why**. A message that
only restates the diff is incomplete.

```text
fix(order): reject orders placed after the cutoff

The cutoff was compared against request time instead of created_at, so a
delayed request could place a stale order. Compare against created_at and
add a regression test for a 23:59 order.
```

Read the message as the changelog entry.

## Never

- `git commit -a` or `git add .` without reading the status and diff first.
- Commit secrets or real credentials. If one lands, rotate it and assume compromise.
- Force-push a shared branch or rewrite published history. Rebase only unpublished commits.
- Amend or squash someone else's commit.
- `--no-verify` to skip a failing hook.
- `git checkout .` / `restore .` to discard changes you have not inspected.

## Recovery

```bash
git reflog                    # find the "lost" commit
git reset --soft HEAD~1       # undo a commit, keep changes staged
git restore --staged <path>   # unstage
git revert <sha>              # the safe, auditable undo for pushed history
```

Lost work is almost always recoverable. Verify before concluding otherwise, and prefer
`revert` on anything published.

## Pull requests

A PR is a review artifact, not a notification. Small enough to read in one sitting - 400
changed lines is already a big ask. Body:

```text
<type>(<scope>): <what changed>

Why             <the problem, linked>
What            <the design, and the decisions that mattered>
Verification    <command> -> <result>, per gate
Risk/rollback   <what could break, how to detect it, how to undo it>
Out of scope    <what you deliberately did not do>
```

Flag what a reviewer must scrutinize: security, data, concurrency. Screenshots or traces
for UI and log changes. If review asks for changes, fix or explain - do not silently rewrite.

## Releases

Honest semver: a breaking API change is major even when it feels small. Changelog in the
same change that alters behavior. Tag the released commit and build from the tag, never a
branch tip. Release notes for users: what changed, what broke, what to do.

## The user's existing history

Do not rewrite, reformat, or reorganize history you were not asked to touch. If the tree had
uncommitted changes before you started, respect them and mention them. When the task is
done, leave the tree clean: no stray files, no leftover branches, nothing half-staged.
