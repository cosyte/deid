/**
 * **DICOM: the declared scope of replacement-UID referential integrity.**
 *
 * Study, Series and SOP Instance UIDs are remapped rather than removed, so a de-identified study is
 * still a study. How far that guarantee reaches was previously answerable only by reading a guide. It is
 * a value on the result now, so a consumer tells the two cases apart by reading a field rather than by
 * remembering which arguments were passed.
 *
 * Everything is synthetic and built in memory.
 */

import { serializeDicom } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { deidentifyDicom, deidentifyDicomBuffer } from "../../src/dicom/index.js";
import { buildPhiDataset } from "./helpers/fixtures.js";

describe("a run given no cross-file UID cache states that the scope is the single call", () => {
  it("declares the single-call scope on the dataset entry point", () => {
    const { uidReferentialIntegrity } = deidentifyDicom(buildPhiDataset());
    expect(uidReferentialIntegrity.scope).toBe("single-call");
    expect(uidReferentialIntegrity.statement).toContain("only within this single call");
  });

  it("declares the same on the byte entry point", () => {
    const { uidReferentialIntegrity } = deidentifyDicomBuffer(serializeDicom(buildPhiDataset()));
    expect(uidReferentialIntegrity.scope).toBe("single-call");
    expect(uidReferentialIntegrity.statement).toContain("no shared");
  });

  it("the statement is value-free and safe to log", () => {
    const { uidReferentialIntegrity } = deidentifyDicom(buildPhiDataset());
    // It is a constant, so it can carry no UID, no sentinel and no other byte of the study.
    const other = deidentifyDicom(buildPhiDataset({ pixelData: true })).uidReferentialIntegrity;
    expect(other.statement).toBe(uidReferentialIntegrity.statement);
    expect(uidReferentialIntegrity.statement).not.toContain("1.2.826");
    expect(uidReferentialIntegrity.statement).not.toContain("ZZSENTINEL");
  });
});

describe("a run given a shared cache declares a scope distinguishable from the no-cache one", () => {
  it("is told apart by reading a value, not by knowing which arguments were passed", () => {
    const uidMap = new Map<string, string>();
    const withCache = deidentifyDicom(buildPhiDataset(), { uidMap }).uidReferentialIntegrity;
    const withoutCache = deidentifyDicom(buildPhiDataset()).uidReferentialIntegrity;

    expect(withCache.scope).toBe("caller-supplied-cache");
    expect(withoutCache.scope).toBe("single-call");
    expect(withCache.scope).not.toBe(withoutCache.scope);
    expect(withCache.statement).not.toBe(withoutCache.statement);
    expect(withCache.statement).toContain("every call that shares");
  });

  it("declares the shared-cache scope on the byte entry point too", () => {
    const uidMap = new Map<string, string>();
    const part10 = serializeDicom(buildPhiDataset());
    expect(deidentifyDicomBuffer(part10, { uidMap }).uidReferentialIntegrity.scope).toBe(
      "caller-supplied-cache",
    );
    expect(deidentifyDicomBuffer(part10).uidReferentialIntegrity.scope).toBe("single-call");
  });

  it("the cache the caller supplied really is the one the pass used (non-vacuity)", () => {
    // Without this, the declaration could be a label the pass attaches without honouring: the shared
    // map is what makes the claim true, so it has to be shown filling up.
    const uidMap = new Map<string, string>();
    expect(uidMap.size).toBe(0);
    const a = deidentifyDicom(buildPhiDataset(), { uidMap });
    expect(uidMap.size).toBeGreaterThan(0);
    // And a second call sharing it remaps consistently, which is the guarantee the scope names.
    const b = deidentifyDicom(buildPhiDataset(), { uidMap });
    expect(a.dataset.get("0020000D")?.rawBytes.toString("latin1")).toBe(
      b.dataset.get("0020000D")?.rawBytes.toString("latin1"),
    );
  });

  it("an empty shared cache still counts as supplied: the scope follows the argument", () => {
    // The declaration is about the guarantee the caller bought, not about whether the map happened to
    // hold anything when the call started.
    expect(
      deidentifyDicom(buildPhiDataset(), { uidMap: new Map() }).uidReferentialIntegrity.scope,
    ).toBe("caller-supplied-cache");
  });
});
