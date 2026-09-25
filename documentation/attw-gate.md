### The `attw` gate

- **`attw` SAYS "does not contain types" AND EXITS 0, SO THE `attw` SCRIPT IS A WRAPPER, NOT THE BARE
  CLI**: for a package that ships types that is a broken publish reported as a pass.
  → `documentation/agent-notes.md#attw-exits-0-on-an-untyped-package`
- **Concurrency only supplies the condition; the BUILD ORDER is the trigger**: `tsup` emits JS before
  declarations, so every build has a window. The answer is **not** a lock, a lease or a build queue.
  **Do not read the measured window timings as constants.**
  → `documentation/agent-notes.md#the-build-order-is-the-trigger`
- **TOTAL declaration loss is silent; PARTIAL loss exits 1. A missing JS entry point is invisible to a
  types analyser. Do not carry a sibling's sentence over without re-running it here, and specifically do
  NOT write "No problems found" into that row: it is false for this package even on a pristine run.**
  → `documentation/agent-notes.md#what-is-measured-on-this-package`
- **`scripts/attw.mjs` carries TWO nets that catch different things** (a manifest-path preflight, and a
  post-check on the untyped sentence). **Anything that would hide the sentence is refused BY OPTION NAME,
  in TWO shapes: an argv token, and a combined short-option cluster containing `q` or `f`**. A
  whole-token-only draft walked back to exit 0 over an untyped pack. **That is a claim about two shapes,
  not that no spelling remains.** → `documentation/agent-notes.md#the-two-nets`
- **This is a PER-REPO script. Landing it here fixes this repo only**: check the siblings before
  claiming the class is closed. → `documentation/agent-notes.md#what-the-gate-test-pins`
