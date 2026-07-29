---
"@cosyte/deid": patch
---

Repository CI configuration only, with no runtime impact: what the required test job selects is now
checked, the leak corpus and `phi-scan` suite included.

A required job gates its steps; it does not gate what those steps select. The CI job that runs this
package's tests ran whatever a single `include` glob in the repo's vitest configuration selected, and
the shared test configuration supplies no `include` of its own, so narrowing that one line to the
per-format directories stopped running the cross-format zero-leak and over-scrub corpus with every
check still reporting green. Coverage could not backstop it, because coverage is measured over `src/`
only and that corpus re-walks paths the per-format suites already cover, so dropping it cost close to
zero coverage percent.

The check compares the test files that exist against the files vitest would actually run, asking
vitest for its resolved selection rather than reading the globs, so an added exclusion and a projects
split are caught alongside a narrowed include. Because that resolution cannot see the command line,
it separately requires the two test scripts CI invokes to equal one of two exact bodies, so a path
filter, an alternate config, a project filter, a shard, a wrapper and a delegation to another script
are all simply not one of those bodies. Its subject is derived from artifacts that exist for their
own reasons rather than from a list inside the check: the modules that must run are the ones
importing one of this package's seven published subpaths, plus the ones exercising the PHI scanner,
and there is no exemption for helpers, so a suite that is renamed, moved to another directory while
its imports keep working, or reached through a symlink does not leave the subject. A move that
breaks the module's own relative imports does leave it, and is the same case as deleting the module.
The one module that was not a test and reached the public surface now imports the two source modules
it actually exercises instead. The check re-proves on every run that it can still fail, by seeding
the removals it exists to catch and requiring itself to catch them one at a time, and it seeds three
of its own derivations, which is less than proving the subject is derived large enough: it does not
check that each published subpath maps to its own source, and it does not cover the resolver that
turns a specifier into a path, so a change to either is a matter for review rather than for the
check.

These routes are closed, which is not the claim that the selection cannot be collapsed. The check
does not see a configuration that can tell which run it is in, since it resolves under a listing
command while CI runs the tests in a different job, nor a specifier rewritten into a form it does
not resolve, such as a substitution, a query suffix or a resolver alias, each of which is caught
today by the type check or the linter rather than by this check, nor a suite skipped inside a file
that is selected, nor which script the shared pipeline elects to invoke, nor a suite renamed out of
the conventional test suffix where no derived rule reaches it, which it reports as a count rather
than leaving to be discovered. Selection is also necessary rather than sufficient: a selected test
that asserts nothing useful is still a review problem.
