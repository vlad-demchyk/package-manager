#!/usr/bin/env bash
# Builds packman into presentation/.build and captures READ-ONLY runs on the synthetic demo repository.
# Next: node presentation/tools/build-pages.js && node presentation/tools/build-data.js
# Needs a local list of private names outside git: presentation/.private-words.txt (or PACKMAN_SITE_PRIVATE_WORDS); build-data.js stops without it.
# Usage: bash presentation/tools/capture-outputs.sh <demo repository>
# Use only a synthetic repository with invented names: the output ends up on the public site.
# The commands only read (no --apply), but they use the network (advisories, registry).
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/.." && pwd)"
ws="$(cd "${1:?path to the demo repository}" && pwd)"
build="$here/.build"
out="$build/out"
rm -rf "$out" && mkdir -p "$out"
cp "$repo/package.json" "$build/" && rm -rf "$build/data" && cp -r "$repo/data" "$build/"
(cd "$repo" && npx tsc -p tsconfig.build.json --outDir "$build/dist") || { echo "build failed"; exit 1; }
# Demo repository path (Windows and POSIX forms): build-data.js replaces it with C:\repo\site-demo.
{ (cd "$ws" && pwd -W 2>/dev/null) || true; echo "$ws"; } > "$out/workspace.txt"
: > "$out/commands.tsv"
export NO_COLOR=1 CI=1
P="node $build/dist/cli/bin.js"
run() { # run <key> <arguments...>; key = output file name and data-output on the pages
  local key="$1"; shift
  printf '%s\t%s\n' "$key" "$*" >> "$out/commands.tsv"
  (cd "$ws" && timeout 180 $P "$@" --lang en > "$out/$key.txt" 2>&1; echo "exit $?" >> "$out/$key.txt")
  echo "$key: $(tail -1 "$out/$key.txt")"
}
NF=apps/news-feed
TC=webparts/team-calendar
run check check --no-security
run check-security check
run check-p check -p $NF --no-security
run check-p-error check -p $NF --no-security --severity error
run fix-review fix --risk review
run fix-p-rule fix -p $NF --rule npm/range-spec
run fix-p-lockstep fix -p $TC --rule spfx/lockstep-mismatch --risk review
run upgrade upgrade
run upgrade-p-to upgrade -p $TC --to 1.21.1 --offline
run align-package align --package react
run align-package-pnp align --package @pnp/sp
run align-base align --base $NF
run align-base-to align --base $TC --to $NF
run list list
run groups groups
run versions versions --package "@pnp/*"
run node node
run outdated outdated
run audit audit
run store-plan store plan
run store-plan-union store plan --union
run store-status store status
run store-status-json store status --json
run log log
run log-n log -n 5
run data-status data status
run spfx spfx
run sp-requirements sp requirements
run profile-generate profile generate -n demo
