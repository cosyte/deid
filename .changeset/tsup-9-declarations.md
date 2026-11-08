---
"@cosyte/deid": patch
---

The type declarations are rebuilt with a newer bundler, and the JavaScript runs exactly as before.
Built with tsup 9, each declaration file lists its type-only exports in a separate `export type`
statement, and the shared declaration and JavaScript chunks have new file names. Every subpath
exports the same names and types as before.
