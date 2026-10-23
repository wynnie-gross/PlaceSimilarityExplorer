import type { CharacteristicDimension, DimensionScore, RankedPlace } from "./types";

export interface ScoreBreakdownItem {
  dimension: CharacteristicDimension;
  weight: number;
  status: "comparable" | "missing" | "excluded";
  similarity: number | null;
  contribution: number | null;
}

function dimensionSimilarity(result: DimensionScore): number {
  const unionCount = result.sourceCount + result.candidateCount - result.sharedCount;
  return unionCount === 0 ? 0 : result.sharedCount / unionCount;
}

export function getScoreBreakdown(
  scores: DimensionScore[],
  dimensions: CharacteristicDimension[],
  weights: Record<string, number>,
): ScoreBreakdownItem[] {
  const rows = dimensions.map((dimension): ScoreBreakdownItem => {
    const weight = weights[dimension.key] ?? 1;
    if (weight <= 0) return { dimension, weight, status: "excluded", similarity: null, contribution: null };

    const result = scores.find((item) => item.dimensionKey === dimension.key);
    if (!result || result.sourceCount === 0 || result.candidateCount === 0) {
      return { dimension, weight, status: "missing", similarity: null, contribution: null };
    }

    return { dimension, weight, status: "comparable", similarity: dimensionSimilarity(result), contribution: null };
  });
  const comparableWeight = rows.reduce((total, row) => total + (row.status === "comparable" ? row.weight : 0), 0);

  return rows.map((row) => row.status !== "comparable" || row.similarity === null || comparableWeight === 0
    ? row
    : { ...row, contribution: row.similarity * row.weight / comparableWeight * 100 });
}

export function scoreGraphCandidates(
  candidates: RankedPlace[],
  dimensions: CharacteristicDimension[],
  weights: Record<string, number>,
  nameField: string,
): RankedPlace[] {
  const activeDimensions = dimensions.filter((dimension) => (weights[dimension.key] ?? 1) > 0);
  const activeWeight = activeDimensions.reduce((total, dimension) => total + (weights[dimension.key] ?? 1), 0);

  const ranked = candidates.map((candidate) => {
    let weightedScore = 0;
    let comparableWeight = 0;

    for (const dimension of activeDimensions) {
      const result = candidate.dimensions.find((item) => item.dimensionKey === dimension.key);
      if (!result || result.sourceCount === 0 || result.candidateCount === 0) continue;

      const weight = weights[dimension.key] ?? 1;
      const exactMatchScore = dimensionSimilarity(result);
      weightedScore += exactMatchScore * weight;
      comparableWeight += weight;
    }

    const sortName = String(candidate.place.properties[nameField] ?? candidate.place.id);
    return {
      sortName,
      candidate: {
        ...candidate,
        score: comparableWeight === 0 ? 0 : weightedScore / comparableWeight,
        coverage: activeWeight === 0 ? 0 : comparableWeight / activeWeight,
      },
    };
  });

  return ranked
    .sort((left, right) => right.candidate.score - left.candidate.score || right.candidate.coverage - left.candidate.coverage || left.sortName.localeCompare(right.sortName))
    .map(({ candidate }) => candidate);
}

