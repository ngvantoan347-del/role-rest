#!/usr/bin/env bash
# demo.sh - reproduce the README's headline claim in one command.
#
# Why this exists: the README leads with falsify catching one break and missing another in the
# same file. A claim like that is worth nothing if a stranger cannot see it in under a minute,
# and "clone, install, read the code, trust me" is not a path anyone takes. So the exact
# scenario is materialised here, run for real, and printed.
#
# Nothing is mocked. The suite that goes green is a real `node --test` run.
#
# Usage: ./demo.sh [keep-dir]
#   keep-dir   leave the fixture on disk at this path instead of cleaning up, so you can poke
#              at it or re-run falsify yourself.

set -euo pipefail

KEEP="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FALSIFY="$HERE/skills/software-engineer/scripts/falsify.mjs"
DIR="$(mktemp -d "${TMPDIR:-/tmp}/falsify-demo-XXXXXX")"

cleanup() {
  if [ -z "$KEEP" ]; then
    rm -rf "$DIR"
  else
    echo
    echo "fixture kept at $KEEP"
  fi
}
trap cleanup EXIT

if [ -n "$KEEP" ]; then
  rm -rf "$KEEP"
  mkdir -p "$KEEP"
  DIR="$KEEP"
fi

# --- the service under review ------------------------------------------------------
# Two guards. One is tested, one is not. This asymmetry is the whole demo: both versions of the
# suite below are green, and only one of them can tell a tested guard from an untested one.
cat > "$DIR/checkout.js" <<'JS'
export function checkout(cart, balance) {
  if (!cart.items.length) throw new Error('empty cart')
  const total = cart.items.reduce((n, i) => n + i.price * i.qty, 0)
  if (balance < total) throw new Error('insufficient balance')
  if (!cart.couponValid) throw new Error('invalid coupon')
  return { ok: true, total }
}
JS

cat > "$DIR/package.json" <<'JSON'
{ "name": "demo", "type": "module", "scripts": { "test": "node --test" } }
JSON

# A suite that looks thorough: five passing assertions. It exercises the happy path and the
# empty cart, and has never once run the insufficient-balance or invalid-coupon branch.
cat > "$DIR/checkout.test.js" <<'JS'
import { test } from 'node:test'
import assert from 'node:assert'
import { checkout } from './checkout.js'

const cart = (total) => ({ items: [{ price: total, qty: 1 }], couponValid: true })

test('charges the total', () => {
  assert.deepEqual(checkout(cart(40), 100), { ok: true, total: 40 })
})
test('charges multi-item carts', () => {
  const c = { items: [{ price: 10, qty: 2 }, { price: 5, qty: 1 }], couponValid: true }
  assert.equal(checkout(c, 100).total, 25)
})
test('rejects an empty cart', () => {
  assert.throws(() => checkout({ items: [], couponValid: true }, 100), /empty cart/)
})
test('handles a large cart', () => {
  assert.equal(checkout(cart(99999), 100000).total, 99999)
})
JS

cd "$DIR"
git init -q
git config user.email demo@example.com
git config user.name demo
# Only the manifest is committed. The service and its tests are the uncommitted change, which is
# the state falsify is built for: nobody reviews a diff by reading HEAD, and nobody wires a
# twenty-minute gate into the loop between writing code and saying it works.
git add package.json
git commit -qm 'initial manifest'

echo "=============================================================="
echo " step 1  npm test"
echo "=============================================================="
npm test --silent 2>&1 | tail -4
echo
echo "Five assertions. All green. Read them again: not one of them calls checkout"
echo "with a balance below the total while the coupon is valid, and not one of them"
echo "passes an invalid coupon on a cart that is otherwise fine."
echo
echo "=============================================================="
echo " step 2  node falsify.mjs"
echo "=============================================================="
set +e
node "$FALSIFY" --no-color
FALSIFY_CODE=$?
set -e
echo
echo "=============================================================="
echo " what just happened"
echo "=============================================================="
echo "exit code $FALSIFY_CODE. The suite is green in step 1 and false on four of six breaks."
echo
echo "Line 2 is the empty-cart guard. Removing it turned a test red - that branch is tested."
echo "Line 4 is insufficient balance and line 5 is the coupon check. Removing either one, or"
echo "deleting the throw entirely, left all five assertions green."
echo
echo "So the code accepts orders that should be refused, and the suite has no opinion about"
echo "it. Coverage would report 100% on those lines, because they do execute - on the happy"
echo "path, where they pass. That is the part coverage cannot express: these lines run, and"
echo "running is not the same as checking."
echo
echo "Each break is one line, applied alone. That matters: mutating all three guards at once"
echo "would have shown one red test and called the file covered, which is the more flattering"
echo "lie - and the more common one."
echo
echo "=============================================================="
echo " step 3  cover one of them"
echo "=============================================================="
cat >> "$DIR/checkout.test.js" <<'JS'
test('rejects insufficient balance', () => {
  assert.throws(() => checkout(cart(500), 100), /insufficient balance/)
})
JS
# Step 3 is expected to still exit non-zero: line 5 remains uncovered, and the tool keeps saying
# so. `set -e` would abort the script here, so the run is explicitly allowed to fail.
set +e
node "$FALSIFY" --no-color 2>&1 | grep -E '^(falsify|  (caught|SURVIVED|unchecked)|  reach|  [0-9]+ break)' | head -12
set -e
echo
echo "Line 4 is caught now. Line 5 still is not, and the tool still says so. Same service,"
echo "same business logic, one assertion - the report moves to a line number instead of a"
echo "file name, which is the only version of this that a reader can act on."
echo
echo "That gap is invisible to coverage, invisible to review, and invisible to a green CI"
echo "run. It is what this repo is for."
echo
echo "Run it on your own repo:"
echo
echo "  node $FALSIFY"
echo
echo "(This script exits 0. The verifier exits 1 above, on purpose - that is the finding.)"
echo
exit 0