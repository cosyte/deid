# Examples

Four small programs that show what `@cosyte/deid` does, each runnable as it stands. Every example
imports `@cosyte/deid` by its published name, which resolves through this package's own `exports`
to the built `dist/`, so build first. Each one checks its own output and exits non-zero on a
mismatch.

```bash
pnpm install
pnpm build
pnpm examples                                # runs all four
pnpm tsx examples/deidentify-a-model.ts      # or one at a time
```

| Example                                                                | What it shows                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`deidentify-a-model.ts`](./deidentify-a-model.ts)                     | The core engine on a generic locus model: a name removed, a date kept to its year, a ZIP kept to three digits, a clinical value retained, free text and an unknown value blocked, and a manifest that carries no value. |
| [`deidentify-an-hl7-message.ts`](./deidentify-an-hl7-message.ts)       | The `@cosyte/deid/hl7` adapter on a parsed ORU^R01: identifiers located by structure, structured results kept, string and narrative results and the NTE comment blocked, and no input identifier left in the output.    |
| [`fail-closed.ts`](./fail-closed.ts)                                   | What happens when the library cannot be sure: free text blocked with no redactor, and again when your redactor throws or returns nothing; a keyed transform with no key refused; a mislabelled policy refused.          |
| [`expert-determination-support.ts`](./expert-determination-support.ts) | The Expert Determination support report built from a manifest. `determination` is always `null`: the library structures the facts for a qualified expert and never renders a determination or a risk score.             |

**What these examples do not show, because the library does not do it.** A result is
"Safe-Harbor-transformed per the configured policy". It is not a certification that data is
de-identified, and nothing here makes the actual-knowledge judgment Safe Harbor also requires, or an
Expert Determination. Those stay with you. See the
[known limitations](../docs-content/limitations.md) before relying on this for data that leaves your
control.

Every input is synthetic, in the shape of the repository's own fixtures under `test/fixtures/`: `ZZ`
placeholder names and identifiers, reserved `555` phone numbers, and `900`-range numbers that are
never issued. `@cosyte/hl7` is an optional peer dependency of the package and a development
dependency here, which is what the HL7 examples parse with.

`tsconfig.json` in this folder maps `@cosyte/deid` to the source, so `pnpm typecheck` and
`pnpm lint` check the examples before anything is built. At run time nothing maps the name: Node
resolves it through `exports`, as it does in your project.
