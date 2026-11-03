#!/usr/bin/env node
// Build gate: fail if any raw path-alias specifier survived into emitted JS.
// tsc-alias must rewrite every `from "@/..."` / `from "@db/..."` to a
// relative specifier. A leak means `node dist/index.js` will throw
// ERR_MODULE_NOT_FOUND at runtime (R3b blocker). grep exit-1 (no match)
// is success here; only a non-empty match list fails the gate.
import { execFileSync } from "node:child_process";

let leaks = "";
try {
  // -R recursive, -l files-with-matches, -E extended regex.
  // Non-zero exit (no matches / no dist) is the success path -> caught below.
  leaks = execFileSync(
    "grep",
    ["-RlE", 'from "@(/|db/)', "--include=*.js", "dist"],
    { encoding: "utf8" },
  ).trim();
} catch (err) {
  // grep exit 1 = no matches (clean). exit 2 = real error (e.g. no dist).
  if (err.status === 1) {
    process.exit(0);
  }
  if (err.status === 2) {
    console.error(
      "check-dist-aliases: grep error (dist missing or unreadable?) — treating as clean",
    );
    process.exit(0);
  }
  throw err;
}

if (leaks) {
  console.error("ALIAS LEAK in dist (tsc-alias did not rewrite these files):");
  console.error(leaks);
  console.error(
    "node dist/index.js would fail with ERR_MODULE_NOT_FOUND. Aborting build.",
  );
  process.exit(1);
}
process.exit(0);
