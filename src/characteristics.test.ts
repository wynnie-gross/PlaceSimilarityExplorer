import { describe, expect, it } from "vitest";
import { getCharacteristicInfo, groupCharacteristicDimensions, groupSharedCharacteristics } from "./characteristics";
import type { CharacteristicDimension } from "./types";

const makeDimension = (key: string, label: string, relationshipType = label): CharacteristicDimension => ({
  key,
  label,
  relationshipType,
  categoryType: label,
  categoryNameField: "name",
});

describe("groupCharacteristicDimensions", () => {
  it("groups shared values using the same labels and categories as weights", () => {
    const groups = groupSharedCharacteristics([
      makeDimension("income", "Has_IncomeLevel"),
      makeDimension("climate", "Has_Climate"),
      makeDimension("housing", "Has_HousingType"),
    ], [
      { dimensionKey: "income", sharedCount: 1, sourceCount: 1, candidateCount: 1, sharedValues: ["High Income"] },
      { dimensionKey: "climate", sharedCount: 2, sourceCount: 2, candidateCount: 2, sharedValues: ["Temperate", "Dry"] },
      { dimensionKey: "housing", sharedCount: 0, sourceCount: 1, candidateCount: 1 },
    ]);
    expect(groups).toEqual([
      { label: "Demographics", characteristics: [{ key: "income", label: "Median Household Income Level", values: ["High Income"], sharedCount: 1 }] },
      { label: "Geography", characteristics: [{ key: "climate", label: "Climate", values: ["Temperate", "Dry"], sharedCount: 2 }] },
    ]);
  });

  it.each([
    "Housing Type", "Predominant Race", "Share of Renters", "Population Size",
    "Median Age", "Landform", "Hydrography", "Dominant Industry", "Geographic Area",
    "Rent Price", "Racial and Ethnic Diversity", "Transit Type", "Median Household Income Level",
    "College and University Presence", "Climate", "Population Density",
  ])("uses authored characteristic text without appended references for %s", (label) => {
    const info = getCharacteristicInfo(makeDimension(label, label));
    expect(info.source).toBeTruthy();
    expect(info.source).not.toContain("Methodology documented in");
    expect(info.source).not.toContain("Entity type:");
    expect(info.source).not.toContain("Relationship:");
    expect(info.source).not.toContain("does not include an original dataset citation");
    expect(info.calculation).not.toContain("upstream formula is not included");
    expect(info.limitations).toBeTruthy();
  });

  it("uses preferred labels and groups while preserving scoring keys", () => {
    const groups = groupCharacteristicDimensions([
      makeDimension("housing", "Has_Housing_Type"),
      makeDimension("race", "Race", "Has_Predominant_Race"),
      makeDimension("density", "Population Density"),
      makeDimension("diversity", "Diversity"),
      makeDimension("incomelevel", "incomelevel"),
      makeDimension("has collegepresence", "has collegepresence"),
      makeDimension("custom", "Local Character"),
    ]);

    expect(groups.map((group) => [group.label, group.dimensions.map((dimension) => dimension.label)])).toEqual([
      ["Demographics", ["Predominant Race", "Racial and Ethnic Diversity", "Median Household Income Level"]],
      ["Geography", ["Population Density"]],
      ["Industry & Culture", ["College and University Presence"]],
      ["Housing & Infrastructure", ["Housing Type"]],
      ["Other characteristics", ["Local Character"]],
    ]);
    expect(groups.flatMap((group) => group.dimensions.map((dimension) => dimension.key))).toEqual([
      "race",
      "diversity",
      "incomelevel",
      "density",
      "has collegepresence",
      "housing",
      "custom",
    ]);
  });

  it("returns the authored rent source without graph metadata", () => {
    const info = getCharacteristicInfo(makeDimension("rent", "Median Rent", "Has_Rent"));

    expect(info.meaning).toContain("gross rent");
    expect(info.calculation).toContain("B25064_001E");
    expect(info.source).toContain("2024 ACS 5-Year Estimates");
    expect(info.source).toBe("U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B25064 (Median Gross Rent).");
    expect(info.limitations).toContain("not a one-bedroom rent estimate");
  });

  it("retains an explicit unknown-source fallback for unrecognized graph dimensions", () => {
    const info = getCharacteristicInfo(makeDimension("custom", "Local Character"));
    expect(info.calculation).toContain("Jaccard similarity");
    expect(info.source).toContain("does not include an original dataset citation");
    expect(info.limitations).toBeUndefined();
  });

  it("preserves key formulas and interpretation caveats from the document", () => {
    const diversity = getCharacteristicInfo(makeDimension("diversity", "Diversity"));
    expect(diversity.calculation).toContain("1 - sum(p_i squared)");
    expect(diversity.calculation).toContain("0.875");
    const colleges = getCharacteristicInfo(makeDimension("colleges", "Has_CollegePresence"));
    expect(colleges.source).toContain("FTE12MN");
    expect(colleges.limitations).toContain("not the percentage of residents");
    const hydrography = getCharacteristicInfo(makeDimension("water", "Hydrography"));
    expect(hydrography.calculation).toContain("one mile");
    expect(hydrography.calculation).toContain("scalerank <= 6");
    expect(hydrography.limitations).toContain("not no water");
  });
});