import { describe, expect, it } from "vitest";
import { getScoreBreakdown, scoreGraphCandidates } from "./scoring";
import type { CharacteristicDimension } from "./types";

const dimensions: CharacteristicDimension[] = [
  { key: "income", label: "Income", relationshipType: "Has_Income", categoryType: "Income", categoryNameField: "name" },
  { key: "education", label: "Education", relationshipType: "Has_Education", categoryType: "Education", categoryNameField: "name" },
  { key: "climate", label: "Climate", relationshipType: "Has_Climate", categoryType: "Climate", categoryNameField: "name" },
];

describe("scoreProfiles", () => {
  it("scores graph overlap counts using comparable dimensions only", () => {
    const [result] = scoreGraphCandidates([{
      place: { id: "candidate", typeName: "Place", properties: { name: "Candidate" } },
      score: 0,
      coverage: 0,
      dimensions: [
        { dimensionKey: "income", sharedCount: 0, sourceCount: 1, candidateCount: 1 },
        { dimensionKey: "education", sharedCount: 1, sourceCount: 1, candidateCount: 1 },
      ],
    }], dimensions, { income: 1, education: 2, climate: 1 }, "name");

    expect(result.score).toBeCloseTo(2 / 3);
    expect(result.coverage).toBe(0.75);
  });

  it("matches the sidebar example and excludes zero-weight characteristics", () => {
    const [result] = scoreGraphCandidates([{
      place: { id: "candidate", typeName: "Place", properties: { name: "Candidate" } },
      score: 0,
      coverage: 0,
      dimensions: [
        { dimensionKey: "income", sharedCount: 0, sourceCount: 1, candidateCount: 1 },
        { dimensionKey: "education", sharedCount: 0, sourceCount: 1, candidateCount: 1 },
        { dimensionKey: "climate", sharedCount: 1, sourceCount: 1, candidateCount: 1 },
      ],
    }], dimensions, { income: 1, education: 0, climate: 2 }, "name");

    expect(result.score).toBeCloseTo(2 / 3);
    expect(result.coverage).toBe(1);
  });

  it("keeps scores and coverage unchanged when every weight is doubled", () => {
    const candidates = [{
      place: { id: "candidate", typeName: "Place", properties: { name: "Candidate" } },
      score: 0,
      coverage: 0,
      dimensions: [
        { dimensionKey: "income", sharedCount: 1, sourceCount: 2, candidateCount: 2 },
        { dimensionKey: "climate", sharedCount: 1, sourceCount: 1, candidateCount: 1 },
      ],
    }];
    const original = scoreGraphCandidates(candidates, dimensions, { income: 1, education: 1, climate: 2 }, "name");
    const doubled = scoreGraphCandidates(candidates, dimensions, { income: 2, education: 2, climate: 4 }, "name");

    expect(doubled).toEqual(original);
  });

  it("breaks the overall score into comparable weighted contributions", () => {
    const candidate = {
      place: { id: "candidate", typeName: "Place", properties: { name: "Candidate" } },
      score: 0,
      coverage: 0,
      dimensions: [
        { dimensionKey: "income", sharedCount: 1, sourceCount: 2, candidateCount: 2 },
        { dimensionKey: "education", sharedCount: 1, sourceCount: 1, candidateCount: 2 },
        { dimensionKey: "climate", sharedCount: 0, sourceCount: 0, candidateCount: 1 },
      ],
    };
    const weights = { income: 1, education: 2, climate: 1 };
    const [ranked] = scoreGraphCandidates([candidate], dimensions, weights, "name");
    const breakdown = getScoreBreakdown(ranked.dimensions, dimensions, weights);

    expect(breakdown[0]).toMatchObject({ status: "comparable", similarity: 1 / 3, contribution: 100 / 9 });
    expect(breakdown[1]).toMatchObject({ status: "comparable", similarity: 1 / 2 });
    expect(breakdown[1].contribution).toBeCloseTo(100 / 3);
    expect(breakdown[2]).toMatchObject({ status: "missing", similarity: null, contribution: null });
    expect(breakdown.reduce((total, row) => total + (row.contribution ?? 0), 0)).toBeCloseTo(ranked.score * 100);

    const excluded = getScoreBreakdown(ranked.dimensions, dimensions, { ...weights, education: 0 });
    expect(excluded[1]).toMatchObject({ status: "excluded", similarity: null, contribution: null });
  });
});
