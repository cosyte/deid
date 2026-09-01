#!/usr/bin/env bash
# scripts/check-no-emdash.sh
#
# FOUNDER DIRECTIVE, 2026-07-24: the character U+2014 EM DASH is banned outright across every
# cosyte surface, and COMMIT MESSAGES ARE NAMED EXPLICITLY. The rule is stated canonically in the
# brand voice document; this file is what enforces it in this repository. Plain hyphens only. Where
# a sentence wants the pause an em dash used to give it, write `--`, a comma, or two sentences.
#
# ---------------------------------------------------------------------------
# THE BANNED CHARACTER IS NEVER SPELLED IN THIS FILE, AND THAT IS LOAD-BEARING RATHER THAN CUTE.
# This gate's corpus is `git ls-files` over the whole repository and it carves out NO exemption for
# its own source, its own workflow or its own tests, deliberately: an exemption for the gate's own
# files is precisely where a real violation would hide, and a sibling repository shipped that hole.
# So the character is CONSTRUCTED from its code point below, and every caller that needs a sample
# constructs one the same way. Write the glyph out anywhere in this tree and the gate reds on the
# file that wrote it, which is the correct outcome and not an accident to be exempted away.
#
# ---------------------------------------------------------------------------
# TWO SCANS, DELIBERATELY, AND THE SPLIT IS THE DESIGN.
#
#   * THE TRACKED-FILE SCAN guards the published surface. Nothing outside this repository can put a
#     character into a tracked file: a hit is always something an author here wrote, and clearing
#     one is always a text edit inside this tree.
#   * THE MESSAGE SCAN guards a pull request's title, body and commit messages. That text has a
#     different trust profile: a bot composes a pull-request body by pasting upstream release notes,
#     em dashes included, and no edit inside this tree prevents it.
#
# They are SEPARATE JOBS in `.github/workflows/no-emdash.yml`, producing separate check-run
# contexts, so that requiring one later never drags the other in with it. A sibling shipped both as
# one job, then had to exempt the lot when the message half became noisy, and the exemption
# un-protected the tracked-file half too: the half that guards what a consumer reads. Keep them
# separately addressable from the start.
#
# ---------------------------------------------------------------------------
# WHAT IS EXCLUDED, EACH BY A RULE WITH ITS REASON, NEVER BY A PER-OCCURRENCE EXCEPTION.
# There is no allow-list in this gate and there is no way to spend an exception on one hit. A file
# is either in scope or it is out of scope by one of the three rules below, and each rule REDS when
# the thing it names stops existing, so an exclusion cannot quietly grow into a hole.
#
#   (E1) `vendor/` -- the vendored sibling-parser tarballs this package depends on through `file:`
#        specifiers. They are gzip streams, not text authored here: one of them carries the banned
#        character's UTF-8 byte sequence inside compressed data by coincidence, and there is no
#        text edit that clears it. Excluded as a LITERAL PATH PREFIX, matching the decision
#        `scripts/phi-scan.ts` already took for the same directory and the same reason.
#
#   (E2) `test/fixtures/` -- sample clinical documents whose EXACT BYTES are the subject under
#        test: the HL7 v2 messages, the C-CDA document, the FHIR bundle, the X12 claim and the
#        NCPDP Telecom payload the de-identification suites assert against. Rewriting one changes
#        what the test asserts, and this repository's tests are the evidence its de-identification
#        is correct. MEASURED WHEN THIS GATE LANDED: zero occurrences under this prefix, so the
#        rule removes NOTHING from today's scan. It is written down anyway so that a future fixture
#        which must carry the character is a stated, reasoned non-catch rather than a surprise
#        exemption argued for under time pressure.
#
#   (E3) `CHANGELOG.md` BELOW THE ARCHIVE DIVIDER -- the frozen archive, which is a GOLDEN pinned
#        byte for byte by `FROZEN_ARCHIVE_SHA256` and `FROZEN_ARCHIVE_BYTES` in
#        `test/scripts/changelog-generation.test.ts`, and which has already been published inside
#        shipped npm tarballs. Rewriting it fails that test and rewrites history a consumer has
#        already received.
#        THE NARROWING IS THE FROZEN GOLDEN AND NOTHING ELSE. Everything ABOVE the divider IS
#        scanned, and `.changeset/` -- the SOURCE from which the generator writes every future line
#        above it -- is scanned in full, so the character cannot enter the generated region without
#        this gate seeing it first, at the file an author actually edits. If the divider line is
#        missing, this gate REFUSES rather than scanning the whole file or none of it.
#
# ---------------------------------------------------------------------------
# THE SILENT-GREEN ROUTES, all closed here. This list is not a claim of exhaustiveness.
#
#   (1) THE SCANNER CANNOT SEE. Closed by the locale pin and by the self-tests, which include an
#       END-TO-END pass of the real scan path over a seeded file: a green from a detector that was
#       never shown able to red is worth nothing.
#   (2) AN EMPTY FILE LIST. `xargs` without `-r` runs grep anyway, and grep with no file operand
#       reads STDIN, finds nothing and exits 0. Closed by `-r` and by refusing an empty list.
#   (3) `git ls-files` FAILS AND ITS STATUS IS ERASED. The list is built as its OWN command, never
#       as the head of a pipeline whose `|| true` would swallow the failure.
#   (4) A PATH THE SCANNER NEVER RECEIVES. `git ls-files` C-quotes any path holding a space, a
#       quote or a non-ASCII byte. Closed by `-z` here and `-0` on xargs.
#   (5) A FILENAME PARSED AS AN OPTION. Closed by `-e` before the pattern and `--` after it.
#   (6) A FILENAME READ AS STANDARD INPUT, which `--` does not close: grep reads a bare `-` operand
#       as stdin, and xargs points its child's stdin at /dev/null, so a tracked file named `-` would
#       never be opened and the gate would print OK over it. Closed by `./`-prefixing every path as
#       the list is built. This gate scans the repository ROOT, so the route is LIVE here rather
#       than theoretical.
#   (7) AN UNREAD ENTRY THAT IS NOT A MISSED MATCH. `-d skip` silently skips a tracked symlink to a
#       directory. It is NOT used: a tracked entry that is not a regular file is REFUSED by name.
#       The `! -L` guard matters, because `-d` follows symlinks and a link to a directory would
#       otherwise be counted as a gitlink and skipped.
#   (8) A SCAN THAT DIED PART WAY THROUGH AND REPORTED CLEAN. grep's exit status cannot distinguish
#       that from no-match (and xargs reports grep's 1 as 123). Closed by capturing stderr and
#       refusing on any of it.
#   (9) A FILE SKIPPED FOR LOOKING BINARY. `grep -a` is used everywhere, so nothing is skipped for
#       its bytes and a hit inside a NUL-bearing text file still reports a file and a line. This
#       repository tracks hand-written TypeScript that embeds NUL bytes as field separators, so the
#       default behaviour would have dropped real source out of the scan in silence and the sibling
#       gate next door was found doing exactly that.
#  (10) AN EXCLUSION THAT GROWS OR GOES STALE. Every rule above names something that must still
#       exist: a prefix matching zero tracked files, or a missing `CHANGELOG.md`, or a missing
#       archive divider, REFUSES. The counts are printed on the OK line so a growing exclusion is
#       visible in a passing run.
#  (11) A MESSAGE SCAN OVER A RANGE THE CLONE CANNOT READ. A shallow checkout that hides the base
#       commit makes `git log base..head` report nothing, which reads exactly like a clean pull
#       request. Refused explicitly in `--messages`, in four places: no base or head given, a
#       shallow repository, an object that is not present, and a range that resolves to zero
#       commits.
#  (12) PULL-REQUEST TEXT REACHING A SHELL AS CODE. `--messages` reads the title and the body from
#       the ENVIRONMENT and never from an argument, a template expansion or an `eval`. The workflow
#       passes them through an `env:` block for the same reason. The text is written to a file with
#       `printf '%s'` and scanned as data.
#
# Run it locally with `pnpm check:no-emdash`.

set -euo pipefail

# LOCALE PIN, load-bearing. `grep -P` compiles PCRE in UTF-8 mode only when the locale says so;
# under LC_CTYPE=POSIX (a bare container, cron, `sh -c`) a `\x{...}` escape above U+00FF does not
# mean what it means here. A gate whose matching depends on an inherited environment is a gate that
# reports green in one place and red in another.
export LC_ALL=C.UTF-8

# ---------------------------------------------------------------------------
# The banned character, constructed rather than spelled. See the banner.
# ---------------------------------------------------------------------------
BANNED_NAME='U+2014 EM DASH'
BANNED_RE='\x{2014}'
BANNED=$(printf '\xe2\x80\x94')

# Characters that must NOT match. The directive names U+2014 and nothing else, so this gate bans
# U+2014 and nothing else. Widening it to the whole dash family is a decision somebody makes on
# purpose, with the measurement of what it takes with it; these samples make that decision visible
# rather than accidental.
EN_DASH=$(printf '\xe2\x80\x93')
HORIZONTAL_BAR=$(printf '\xe2\x80\x95')

# ---------------------------------------------------------------------------
# Exclusion rules. Each is stated in the banner with its reason.
# ---------------------------------------------------------------------------
EXCLUDED_PREFIXES=(vendor/ test/fixtures/)
CHANGELOG_FILE='CHANGELOG.md'
ARCHIVE_HEADING='## Released before this file was generated'

usage() {
  cat >&2 <<'EOF'
usage:
  check-no-emdash.sh [--tracked]        scan every tracked file in scope (the default)
  check-no-emdash.sh --stdin <label>    scan the text on standard input, reported under <label>
  check-no-emdash.sh --messages         scan a pull request's title, body and commit messages,
                                        read from PR_TITLE, PR_BODY, PR_BASE_SHA and PR_HEAD_SHA
EOF
  exit 2
}

ERRLOG=$(mktemp)
SCANLIST=$(mktemp)
FILELIST=$(mktemp)
BUFFER=$(mktemp)
SELFDIR=$(mktemp -d)
trap 'rm -f "$ERRLOG" "$SCANLIST" "$FILELIST" "$BUFFER"; rm -rf "$SELFDIR"' EXIT

self_test_fail() {
  echo "ERROR: check-no-emdash - SELF-TEST FAILED: $1" >&2
  echo "       The scanner is not behaving as specified, so no result from it can be believed." >&2
  echo "       Refusing to report." >&2
  exit 1
}

refuse() {
  echo "ERROR: check-no-emdash - $1" >&2
  shift
  for line in "$@"; do echo "       $line" >&2; done
  exit 1
}

refuse_if_incomplete() {
  [ -s "$ERRLOG" ] || return 0
  cat "$ERRLOG" >&2
  echo "" >&2
  refuse "the scan reported errors, so it did not read all of its input." \
    "Refusing to report green from an incomplete scan."
}

# ---------------------------------------------------------------------------
# The two scan primitives. Every mode goes through one of these, so the self-tests below exercise
# the same code path the real run uses rather than a simplified stand-in.
#
# ▶ THE `|| true` ON A BARE grep IS THE NO-MATCH IDIOM AND IS NOT AN ESCAPE HATCH. grep exits 1 when
# it matches nothing, which under `set -e` would kill the script on the CLEAN case, so the status is
# absorbed and the real signal is taken from two other places instead: the captured stderr (any of
# it refuses, route 8) and the emptiness of the hit list. Nothing here can pass BECAUSE of the
# `|| true`; it only lets a clean run reach the refusal machinery. Every occurrence is immediately
# followed by `refuse_if_incomplete`, and the test suite asserts that pairing so the guard cannot be
# deleted while the idiom stays behind.
# ---------------------------------------------------------------------------

# Scan a NUL-separated list of paths. Prints `path:line:text`, one record per offending LINE.
scan_paths() {
  : > "$ERRLOG"
  local hits
  hits=$(xargs -0 -r grep -a -H -n -P -e "$BANNED_RE" -- < "$1" 2>>"$ERRLOG" || true)
  refuse_if_incomplete
  [ -n "$hits" ] && printf '%s\n' "$hits"
  return 0
}

# Count OCCURRENCES, not lines, across the same list. A line holding two of them is one grep record
# and two violations, and a report that says "3 lines" over 5 occurrences understates the work.
#
# THE COUNT IS TAKEN FROM A CAPTURED STRING RATHER THAN FROM A PIPE INTO `wc`, because `pipefail` is
# on: piping a grep that legitimately matches nothing into anything makes the whole pipeline fail,
# and under `set -e` that ends the run silently, with exit 1 and not one word on stderr. That is the
# worst possible failure mode for a gate, since it is indistinguishable from a red at a glance.
count_paths() {
  : > "$ERRLOG"
  local out
  out=$(xargs -0 -r grep -a -o -P -e "$BANNED_RE" -- < "$1" 2>>"$ERRLOG" || true)
  refuse_if_incomplete
  if [ -z "$out" ]; then printf '0'; return 0; fi
  printf '%s\n' "$out" | wc -l | tr -d ' '
}

# Scan one buffer under a display name the reader can act on. Prints `label:line:text`.
scan_buffer() {
  : > "$ERRLOG"
  local hits
  hits=$(grep -a -n -P -e "$BANNED_RE" -- "$1" 2>>"$ERRLOG" || true)
  refuse_if_incomplete
  [ -n "$hits" ] && printf '%s\n' "$hits" | awk -v label="$2" '{ print label ":" $0 }'
  return 0
}

# The same occurrence count over one buffer. Same shape, same reason.
count_buffer() {
  : > "$ERRLOG"
  local out
  out=$(grep -a -o -P -e "$BANNED_RE" -- "$1" 2>>"$ERRLOG" || true)
  refuse_if_incomplete
  if [ -z "$out" ]; then printf '0'; return 0; fi
  printf '%s\n' "$out" | wc -l | tr -d ' '
}

fail_with_hits() {
  local what="$1" hits="$2"
  printf '%s\n' "$hits" >&2
  echo "" >&2
  echo "ERROR: check-no-emdash - ${BANNED_NAME} found in ${what}." >&2
  echo "       Founder directive, 2026-07-24: that character is banned outright on every cosyte" >&2
  echo "       surface, commit messages included. Plain hyphens only." >&2
  echo "       Rewrite the text: '--', a comma, a colon, or two sentences. Do NOT reach for a" >&2
  echo "       colon inside an unquoted YAML plain scalar, which cannot contain one followed by" >&2
  echo "       a space: the file stops parsing. Rewrite the sentence, never the key." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# SELF-TESTS. A gate is believed only after it has shown it can still see. These run in EVERY mode.
# ---------------------------------------------------------------------------

# (a) The pattern matches the banned character, and matches it as ONE character. The anchors are
#     what make this an encoding test as well as a pattern test: under a non-UTF-8 locale the three
#     bytes are three characters and the anchored match fails.
if ! printf '%s\n' "$BANNED" | grep -qP -e "^${BANNED_RE}\$"; then
  self_test_fail "the pattern no longer matches ${BANNED_NAME} as a single character. Either the pattern was changed or the locale pin was lost, and a scan under a non-UTF-8 locale reports every tree clean."
fi

# (b) It matches nothing else in the dash family. The directive names one character; a gate that
#     quietly grew to three would red on legitimate text and would be deleted rather than narrowed.
for sample_name in hyphen double-hyphen en-dash horizontal-bar; do
  case "$sample_name" in
    hyphen) sample='a - b' ;;
    double-hyphen) sample='a -- b' ;;
    en-dash) sample="a ${EN_DASH} b" ;;
    horizontal-bar) sample="a ${HORIZONTAL_BAR} b" ;;
  esac
  if printf '%s\n' "$sample" | grep -qP -e "$BANNED_RE"; then
    self_test_fail "the pattern now matches a ${sample_name}, which the directive does not ban. Widening this gate to the rest of the dash family is a decision to take deliberately, with the measurement of what it takes with it, not a side effect of editing the pattern."
  fi
done

# (c) END TO END, THROUGH THE REAL SCAN PATH. A pattern that matches in isolation proves nothing
#     about the list building, the locale, the xargs boundary or the grep flags around it. So the
#     primitives above are run over a seeded file and over a clean one, and both answers are
#     asserted. This is the assertion that stops this gate from reporting OK over a tree it never
#     opened.
printf 'clean line\nbefore %s after\n' "$BANNED" > "${SELFDIR}/seeded.txt"
printf 'clean line\nanother clean line\n' > "${SELFDIR}/clean.txt"
printf '%s\0' "${SELFDIR}/seeded.txt" > "${SELFDIR}/list"
self_hits=$(scan_paths "${SELFDIR}/list")
case "$self_hits" in
  *"seeded.txt:2:"*) ;;
  *) self_test_fail "the real scan path did not locate a seeded ${BANNED_NAME} at line 2 of a two-line file. It reported: '${self_hits}'." ;;
esac
self_count=$(count_paths "${SELFDIR}/list")
if [ "$self_count" != "1" ]; then
  self_test_fail "the occurrence counter reported ${self_count} for a file holding exactly one ${BANNED_NAME}."
fi
printf '%s\0' "${SELFDIR}/clean.txt" > "${SELFDIR}/list"
self_hits=$(scan_paths "${SELFDIR}/list")
if [ -n "$self_hits" ]; then
  self_test_fail "the real scan path reported a hit on a file that holds none: '${self_hits}'."
fi
if [ -n "$(scan_buffer "${SELFDIR}/clean.txt" sample)" ]; then
  self_test_fail "the buffer scan reported a hit on a buffer that holds none."
fi
if [ -z "$(scan_buffer "${SELFDIR}/seeded.txt" sample)" ]; then
  self_test_fail "the buffer scan reported nothing on a buffer holding a seeded ${BANNED_NAME}."
fi

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

MODE='tracked'
LABEL=''
case "${1-}" in
  ''|--tracked) MODE='tracked' ;;
  --stdin) MODE='stdin'; LABEL="${2-}"; [ -n "$LABEL" ] || usage ;;
  --messages) MODE='messages' ;;
  *) usage ;;
esac

# --stdin: the primitive the message scan is built from, and usable on its own. It REFUSES on empty
# input, because a scan that read nothing must never print OK; a caller with legitimately empty text
# (a pull request with no body) decides that for itself and does not call this.
if [ "$MODE" = 'stdin' ]; then
  cat > "$BUFFER"
  if [ ! -s "$BUFFER" ]; then
    refuse "nothing arrived on standard input for '${LABEL}'." \
      "Refusing to report green from a scan that read nothing."
  fi
  hits=$(scan_buffer "$BUFFER" "$LABEL")
  [ -n "$hits" ] && fail_with_hits "$LABEL" "$hits"
  echo "check-no-emdash: OK (${LABEL}: $(wc -l < "$BUFFER") line(s) scanned for ${BANNED_NAME})"
  exit 0
fi

# Both remaining modes read the repository, so anchor at its top level: `git ls-files` is relative
# to the working directory and would silently scan a subtree from anywhere else.
TOPLEVEL=$(git rev-parse --show-toplevel)
[ -n "$TOPLEVEL" ] || refuse "not inside a git working tree."
cd "$TOPLEVEL"

# ---------------------------------------------------------------------------
# --messages: the pull request's title, body and commit messages
# ---------------------------------------------------------------------------
if [ "$MODE" = 'messages' ]; then
  PR_TITLE="${PR_TITLE-}"
  PR_BODY="${PR_BODY-}"
  PR_BASE_SHA="${PR_BASE_SHA-}"
  PR_HEAD_SHA="${PR_HEAD_SHA-}"

  # ROUTE (11), FIRST HALF: no range at all. Without this the loop below runs over nothing and the
  # scan prints OK, which is the failure this whole block exists to prevent.
  [ -n "$PR_BASE_SHA" ] || refuse "PR_BASE_SHA is empty, so there is no commit range to read." \
    "Refusing to report an absence of findings from a scan with no input."
  [ -n "$PR_HEAD_SHA" ] || refuse "PR_HEAD_SHA is empty, so there is no commit range to read." \
    "Refusing to report an absence of findings from a scan with no input."

  # SECOND HALF: a shallow clone. This is the one that actually happens, because a shallow checkout
  # is the default in GitHub Actions: the base commit is simply absent, `git log base..head` fails
  # or yields nothing, and the job goes green having read no commit message at all.
  if [ "$(git rev-parse --is-shallow-repository)" != 'false' ]; then
    refuse "this clone is SHALLOW, so it cannot be shown to hold the full commit range." \
      "A shallow clone that hides the base commit must not read as an absence of findings." \
      "Check out with fetch-depth: 0."
  fi
  for sha in "$PR_BASE_SHA" "$PR_HEAD_SHA"; do
    if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
      refuse "commit ${sha} is not present in this clone, so the range cannot be read." \
        "A clone that hides an end of the range must not read as an absence of findings." \
        "Check out with fetch-depth: 0."
    fi
  done

  if ! git rev-list "${PR_BASE_SHA}..${PR_HEAD_SHA}" > "$BUFFER" 2>>"$ERRLOG"; then
    cat "$ERRLOG" >&2
    refuse "could not enumerate the commit range ${PR_BASE_SHA}..${PR_HEAD_SHA}."
  fi
  commits=$(wc -l < "$BUFFER")
  if [ "$commits" -eq 0 ]; then
    refuse "the range ${PR_BASE_SHA}..${PR_HEAD_SHA} resolves to ZERO commits." \
      "A pull request has at least one, so this is a range that was not read rather than a" \
      "pull request with nothing in it. Refusing to report an absence of findings."
  fi

  MSG_HITS=''
  # THE TITLE IS REQUIRED. Every pull request has one, so an empty PR_TITLE means the workflow did
  # not hand it over, not that the title is blank.
  [ -n "$PR_TITLE" ] || refuse "PR_TITLE is empty." \
    "Every pull request has a title, so this is text that was never passed in." \
    "Refusing to report an absence of findings on a surface that was not scanned."
  printf '%s' "$PR_TITLE" > "$BUFFER"
  MSG_HITS="${MSG_HITS}$(scan_buffer "$BUFFER" 'pull request title')"

  # THE BODY MAY LEGITIMATELY BE EMPTY, and that is the one difference from the title. It is stated
  # on the OK line rather than passed over, so "the body was clean" and "there was no body" are
  # distinguishable in the log.
  body_state='scanned'
  if [ -n "$PR_BODY" ]; then
    printf '%s' "$PR_BODY" > "$BUFFER"
    body_hits=$(scan_buffer "$BUFFER" 'pull request body')
    if [ -n "$body_hits" ]; then MSG_HITS="${MSG_HITS}"$'\n'"${body_hits}"; fi
  else
    body_state='empty'
  fi

  # COMMIT MESSAGES, one commit at a time so a hit names the commit a reader has to amend.
  git rev-list "${PR_BASE_SHA}..${PR_HEAD_SHA}" > "$SCANLIST"
  scanned_commits=0
  while IFS= read -r sha; do
    [ -n "$sha" ] || continue
    git show -s --format=%B "$sha" > "$BUFFER"
    commit_hits=$(scan_buffer "$BUFFER" "commit ${sha}")
    if [ -n "$commit_hits" ]; then MSG_HITS="${MSG_HITS}"$'\n'"${commit_hits}"; fi
    scanned_commits=$((scanned_commits + 1))
  done < "$SCANLIST"

  if [ "$scanned_commits" -ne "$commits" ]; then
    refuse "read ${scanned_commits} commit message(s) from a range of ${commits} commit(s)." \
      "Refusing to report green from a scan that did not read all of its input."
  fi

  MSG_HITS=$(printf '%s' "$MSG_HITS" | sed '/^$/d')
  [ -n "$MSG_HITS" ] && fail_with_hits "this pull request's text" "$MSG_HITS"
  echo "check-no-emdash: OK (pull request title scanned, body ${body_state}, ${scanned_commits} commit message(s) scanned for ${BANNED_NAME} over ${PR_BASE_SHA}..${PR_HEAD_SHA} in a non-shallow clone)"
  exit 0
fi

# ---------------------------------------------------------------------------
# --tracked: every tracked file in scope
# ---------------------------------------------------------------------------

# ROUTE (10). Every exclusion names something that must still exist. A prefix matching zero tracked
# files is a rule describing a directory that has gone, and leaving it in place is how an exclusion
# list drifts into covering something it was never argued for.
for prefix in "${EXCLUDED_PREFIXES[@]}"; do
  if [ -z "$(git ls-files -- "$prefix")" ]; then
    refuse "the excluded path '${prefix}' matches no tracked file." \
      "The exclusion rules in this script are stated with their reasons and each names something" \
      "that exists. Remove the rule deliberately, or restore the path. Refusing to report from a" \
      "scan whose stated scope no longer describes this tree."
  fi
done
if [ -z "$(git ls-files -- "$CHANGELOG_FILE")" ]; then
  refuse "'${CHANGELOG_FILE}' is not tracked, but this script carries a region rule for it." \
    "Refusing to report from a scan whose stated scope no longer describes this tree."
fi

# ROUTE (3): its own command, so a failure is a failure rather than an empty list.
git ls-files -z > "$FILELIST"
if [ ! -s "$FILELIST" ]; then
  refuse "no tracked files at all." "Refusing to report green from a scan that read nothing."
fi

: > "$SCANLIST"
scanned=0
gitlinks=0
excluded=0
changelog_seen=0
while IFS= read -r -d '' f; do
  # ROUTE (7). A gitlink is a directory entry with no bytes here; a SYMLINK to a directory also
  # tests -d, which is why -L is checked before it is skipped.
  if [ -d "$f" ] && [ ! -L "$f" ]; then
    gitlinks=$((gitlinks + 1))
    continue
  fi
  if [ ! -r "$f" ]; then
    refuse "tracked file is not readable: $f" \
      "Refusing to report green from a scan that could not open its input."
  fi
  if [ ! -f "$f" ]; then
    refuse "tracked entry is not a regular file: $f" \
      "Refusing to report green from a scan that skipped one of its inputs."
  fi
  if [ "$f" = "$CHANGELOG_FILE" ]; then
    changelog_seen=1
    continue
  fi
  skip=0
  for prefix in "${EXCLUDED_PREFIXES[@]}"; do
    case "$f" in "${prefix}"*) skip=1; break ;; esac
  done
  if [ "$skip" -eq 1 ]; then
    excluded=$((excluded + 1))
    continue
  fi
  # ROUTE (6): `./`-prefixed as the list is built, so no operand is ever a bare `-`.
  printf './%s\0' "$f" >> "$SCANLIST"
  scanned=$((scanned + 1))
done < "$FILELIST"

if [ ! -s "$SCANLIST" ]; then
  refuse "no tracked files survived list building." \
    "Refusing to report green from a scan that read nothing."
fi
if [ "$changelog_seen" -ne 1 ]; then
  refuse "'${CHANGELOG_FILE}' was not reached while building the scan list." \
    "Refusing to report green from a scan that lost one of its stated inputs."
fi

# RULE (E3), applied. The divider is located in the tracked file itself, the region ABOVE it is
# scanned under the file's own name so a hit's line number is the file's line number, and a missing
# divider REFUSES rather than defaulting to either extreme.
divider=''
if divider_line=$(grep -a -n -x -F -m1 -e "$ARCHIVE_HEADING" -- "./${CHANGELOG_FILE}"); then
  divider="${divider_line%%:*}"
fi
if [ -z "$divider" ]; then
  refuse "the archive divider is missing from '${CHANGELOG_FILE}'." \
    "This gate scans everything above it and excludes the frozen archive below it, which is" \
    "pinned by digest in test/scripts/changelog-generation.test.ts. Without the divider there is" \
    "no boundary to apply, and guessing one would either red on published bytes or skip live" \
    "text. Refusing."
fi
if [ "$divider" -le 1 ]; then
  refuse "the archive divider is at line ${divider} of '${CHANGELOG_FILE}', leaving nothing above it." \
    "Refusing to report green from a region scan that read nothing."
fi
head -n "$((divider - 1))" "./${CHANGELOG_FILE}" > "$BUFFER"

HITS=$(scan_paths "$SCANLIST")
OCCURRENCES=$(count_paths "$SCANLIST")
CHANGELOG_HITS=$(scan_buffer "$BUFFER" "$CHANGELOG_FILE")
if [ -n "$CHANGELOG_HITS" ]; then
  HITS="${HITS}"$'\n'"${CHANGELOG_HITS}"
  OCCURRENCES=$((OCCURRENCES + $(count_buffer "$BUFFER")))
fi
HITS=$(printf '%s' "$HITS" | sed '/^$/d')

if [ -n "$HITS" ]; then
  echo "${OCCURRENCES} occurrence(s) of ${BANNED_NAME}, by file and line:" >&2
  fail_with_hits "the tracked files listed above" "$HITS"
fi

echo "check-no-emdash: OK (${scanned} tracked file(s) scanned for ${BANNED_NAME}, plus ${CHANGELOG_FILE} above the archive divider at line ${divider}; ${excluded} file(s) excluded by the stated rules for vendored tarballs and byte-exact test fixtures; ${gitlinks} gitlink(s) skipped)"
