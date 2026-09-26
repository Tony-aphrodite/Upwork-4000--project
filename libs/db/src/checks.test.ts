import { beforeAll, describe, expect, it } from "vitest";
import { Database } from "./client";
import { AREAS, CHECKS, runChecks, type CheckResult } from "./checks";

// The acceptance checks, one test each, in order, against a fresh database.
let results: CheckResult[] = [];
beforeAll(async () => {
  results = await runChecks(() => Database.open());
}, 120000);

for (const area of AREAS) {
  describe(area, () => {
    for (const c of CHECKS.filter((x) => x.area === area)) {
      it(c.title, () => {
        const r = results.find((x) => x.id === c.id);
        expect(r, "did not run").toBeDefined();
        expect(r!.ok, r!.detail).toBe(true);
      });
    }
  });
}
