import cosyte from "@cosyte/eslint-config";

export default [
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
