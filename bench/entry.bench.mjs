// A suite with one trivial benchmark, so `cosyte-bench run --target <entry>` reads the cold import
// of one published entry on its own: its median over fresh processes, every file it loads and their
// gzip size. `pnpm bench:imports` runs it once for each entry in package.json `exports`. The
// benchmark itself reads the entry's export names and is not a number anyone should read.

import { defineBenchmark, defineSuite } from "@cosyte/bench";

export default defineSuite({
  name: "@cosyte/deid entry",
  benchmarks: [
    defineBenchmark({
      name: "export names",
      sizes: [{ label: "the entry", build: () => ({ inputs: [0] }) }],
      bind: (entry) => () => Object.keys(entry).length,
      weigh: (n) => n,
    }),
  ],
});
