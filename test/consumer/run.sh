#!/usr/bin/env bash
#
# Consumer smoke test — verify the PUBLISHED artifact, not the source tree.
#
# The unit suite imports from `../src`, so it cannot fail for a whole class of
# breakage: a bad `main`/`files` entry, a renamed or dropped export, or .d.ts
# files a consumer can't resolve. All of those ship green today.
#
# Four checks, cheapest first:
#   publint     packaging config vs the real tarball (main/files/exports resolve)
#   attw        declarations resolve under node10 / node16 CJS+ESM / bundler
#   probe.cjs   require(), export surface vs snapshot, emitted JS executes
#   probe.ts    tsc --noEmit --strict against the emitted .d.ts
#
# publint and attw are off-the-shelf and cover more than a hand-rolled check
# would; the probes cover what they can't — export drift and whether the
# declarations are usable rather than merely resolvable.
#
# Makes NO AWS calls: behavioural coverage against Floci lives in the `build`
# job. This gates publishing, so it stays hermetic — a release must not hinge
# on a container booting.
#
# Usage: test/consumer/run.sh
# Exit:  0 all checks passed, non-zero on the first failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO_ROOT/test/consumer"
cd "$REPO_ROOT"

echo "==> compile"
yarn --silent compile

# `npm pack` honours `files`, so the tarball is what publish would upload.
# Read the name from --json rather than the last stdout line so npm printing
# anything else can't yield a wrong path. --ignore-scripts because we just
# compiled: re-running `prepare` would only duplicate the build.
#
# --pack-destination keeps the tarball out of the repo root, which matters:
# `attw --pack .` runs its OWN `npm pack` into the cwd under the same default
# filename and deletes it afterwards, so a repo-root tarball silently
# disappears mid-run. Packing once here and passing that path to every check
# avoids the collision and the duplicate pack.
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> pack"
TARBALL="$WORK/$(npm pack --json --ignore-scripts --pack-destination "$WORK" |
    node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).at(-1).filename')"
[ -f "$TARBALL" ] || { echo "pack produced no tarball at $TARBALL" >&2; exit 1; }

echo "==> publint (packaging config)"
npx --yes publint@0.3 "$TARBALL"

echo "==> attw (declaration resolution)"
# No --ignore-rules: the package resolves cleanly in every mode today, so
# suppressing anything would only hide a future regression.
npx --yes @arethetypeswrong/cli@0.18 "$TARBALL"

echo "==> consumer probes in a scratch project"
PROBE="$WORK/probe"
mkdir -p "$PROBE"
cp "$HERE/probe.cjs" "$HERE/probe.ts" "$HERE/tsconfig.json" "$HERE/expected-exports.json" "$PROBE/"
cat > "$PROBE/package.json" <<'JSON'
{
  "name": "tibber-aws-consumer-probe",
  "version": "1.0.0",
  "private": true,
  "description": "Scratch consumer used by test/consumer/run.sh; not published."
}
JSON

# Probe with the TypeScript the library is built with: the question is whether
# OUR emitted declarations work, not whether some other tsc likes them.
TS_VERSION="$(node -p "require('$REPO_ROOT/package.json').devDependencies.typescript")"

cd "$PROBE"
# The scratch install hits the registry for the tarball's dependencies, so it
# can fail for reasons unrelated to the code under test. This step gates
# publish — retry a transient blip rather than failing a good release.
for attempt in 1 2 3; do
    if npm install --silent --no-audit --no-fund --no-package-lock \
        "$TARBALL" \
        "typescript@${TS_VERSION}" \
        "@types/node@^22" >/dev/null 2>"$PROBE/npm-install.log"; then
        break
    fi
    if [ "$attempt" = 3 ]; then
        echo "    ✗ scratch install failed after 3 attempts:" >&2
        tail -20 "$PROBE/npm-install.log" >&2
        exit 1
    fi
    echo "    scratch install attempt ${attempt} failed; retrying in $((attempt * 5))s" >&2
    sleep $((attempt * 5))
done

node probe.cjs
npx --no-install tsc -p tsconfig.json
echo "  ✓ types: declarations resolve and documented call shapes still compile"

echo "==> consumer smoke test passed"
