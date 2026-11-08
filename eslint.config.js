import cosyte from "@cosyte/eslint-config";

export default [
  // The shared default type-checks src, test, scripts and the root config files; the runnable
  // programs under examples/ are linted too (`cosyte-process.config.json` adds them to `pnpm lint`),
  // so they join the type-checked set.
  ...cosyte(import.meta.dirname, {
    files: ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts", "examples/**/*.ts", "*.config.ts"],
  }),

  // The examples are programs a reader runs: printing what they show is their job.
  {
    files: ["examples/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
