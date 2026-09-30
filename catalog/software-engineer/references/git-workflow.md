# Git Workflow

Git is the project's memory. The rules below keep history readable, changes revertible, and
secrets out of it.

## Before you touch git

- `git status` and `git diff` before every stage. Always. Never commit what you have not
  read.
- Check you are on the right branch and the right worktree.
- Confirm nothing sensitive is in the diff: `.env`, credentials, tokens, private keys,
  real user data, internal URLs with embedded passwords.
- Keep generated files, build output, and dependency directories out of the commit.

## Branches

- One branch per unit of work: `fix/order-timeout`, `feat/export-csv`.
- Branch from an up-to-date base. Rebase onto the base before review.
- Do not mix unrelated changes into one branch. Two concerns means two branches.
- Never commit directly to a protected or shared default branch.

## Commits

- **One concern per commit.** A commit that does two things can only be reverted all or
  nothing.
- **Small and verifiable.** Each commit should leave the tree in a working state:
  compiles, tests pass. A commit that leaves `main` broken is a release incident waiting
  for a deploy.
- **Separate refactor from behavior change.** Mixing them makes the diff unreviewable and
  the revert unsafe.
- **Message format:** imperative subject line under ~72 chars, blank line, then the
  *why* in the body. Explain intent and constraints, not a restatement of the diff.

```text
fix(order): reject orders placed after the cutoff

The cutoff was compared against request time instead of the order's
created_at, so a delayed request could place a stale order. Compare
against created_at and add a regression test for a 23:59 order.
```

- Read the message as the changelog entry. If it only says what the diff shows, it is
  incomplete.

## Never

- Never `git commit -a` or `git add .` without reading `git status` and the diff first.
- Never commit secrets, tokens, `.env` files, or real credentials. Rotate immediately if
  one is committed; assume it is compromised.
- Never force-push a shared or protected branch, or rewrite published history. Rebase
  only commits nobody else has pulled.
- Never amend or squash someone else's commit.
- Never delete or `reset --hard` a branch that contains unpushed work you did not create.
- Never use `--no-verify` to get past a failing hook. Fix the hook's complaint.
- Never `git checkout .` or `git restore .` to discard changes you have not inspected.

## Recovering from mistakes

```bash
git reflog                       # find the commit you thought you lost
git reset --soft HEAD~1          # undo a commit, keep the changes staged
git restore --staged <path>      # unstage
git revert <sha>                 # safe, auditable undo for pushed commits
```

Recovering lost work is almost always possible. Verify before concluding that something is
gone, and prefer `revert` on published history.

## Pull request

A PR is a review artifact, not a notification.

**Title and description:**

```text
<type>(<scope>): <what changed, imperative>

## Why
<the problem, with a link to the issue.>

## What
<the design in a few sentences, and the important decisions.>

## Verification
- <command> -> <result>
- <manual check> -> <result>

## Risk and rollback
<What could break, how to detect it, how to undo it.>

## Out of scope
<What you deliberately did not do.>
```

- Keep PRs small enough to review in one sitting. 400 changed lines is already a big ask.
- Screenshots or traces for UI and log changes.
- Call out anything the reviewer must check carefully: security, data, concurrency.
- Respond to review by fixing or explaining. Do not silently rewrite the PR.

## Releases and tags

- Semantic versioning, honestly applied. A breaking API change is a major, even if it feels
  small.
- Update the changelog in the same change that alters behavior.
- Tag the commit that was actually released. Build from the tag, never from a branch tip.
- Write release notes for users: what changed, what broke, what to do. Internal refactor
  detail goes in the commit body.

## Working with the user's existing history

- Do not rewrite or reorganize history the user did not ask you to touch.
- Do not reformat or reformat-adjacent files you were not asked to change.
- If the working tree already had uncommitted changes when you started, respect them and
  mention them. Ask before touching anything you did not create.
- When the task is done, leave the tree clean: no stray files, no leftover branches you
  created, no half-staged state.
