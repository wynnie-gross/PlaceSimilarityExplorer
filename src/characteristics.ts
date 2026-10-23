import type { CharacteristicDimension, DimensionScore } from "./types";

export interface CharacteristicGroup {
  label: string;
  dimensions: CharacteristicDimension[];
}

export interface SharedCharacteristicGroup {
  label: string;
  characteristics: { key: string; label: string; values: string[]; sharedCount: number }[];
}

export interface CharacteristicInfo {
  meaning: string;
  calculation: string;
  source: string;
  limitations?: string;
}

interface CharacteristicDefinition {
  label: string;
  group: string;
  aliases: string[];
  meaning: string;
  calculation: string;
  source: string;
  limitations: string;
}

const definitions: CharacteristicDefinition[] = [
  {
    label: "Housing Type", group: "Housing & Infrastructure", aliases: ["housing type", "type of housing"],
    meaning: "The dominant housing structure-size category, based on shares of housing units.",
    calculation: "Computed each group's share of units from ACS B25024. Detached single-family must have exceeded 50% to qualify; attached single-family, duplexes, 3-4 units, 5-19 units, 20-49 units, 50+ units, and mobile/other each qualified at 30% or more. If several groups qualified, chose the largest share. If none qualified, assigned Mixed Residential.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B25024 (Units in Structure).",
    limitations: "These are units-per-structure categories, not verified building heights or urban form. A 5-19-unit structure is not necessarily low-rise. Categories are project-defined, not official Census place typologies.",
  },
  {
    label: "Predominant Race", group: "Demographics", aliases: ["predominant race", "race", "racial composition"],
    meaning: "The largest mutually exclusive race/ethnicity group among a place's residents; predominant does not necessarily mean a majority.",
    calculation: "Divided each of eight B03002 group counts by the table's total population and selected the largest share: Hispanic/Latino of any race, and non-Hispanic White, Black, American Indian/Alaska Native, Asian, Native Hawaiian/Other Pacific Islander, Other Race, and Two or More Races.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B03002 (Hispanic or Latino Origin by Race).",
    limitations: "Hispanic/Latino residents are not counted again in the non-Hispanic groups. This is not a complete description of a place's identity.",
  },
  {
    label: "Share of Renters", group: "Housing & Infrastructure", aliases: ["share of renters", "renter share", "renters", "rental tenure"],
    meaning: "The percentage of occupied housing units that are renter-occupied.",
    calculation: "Renter share = B25003_003E (Renter-Occupied Housing Units) / B25003_001E (Total Housing Units) x 100. Valid matched places were grouped into six national quantile categories from Very Low to Very High Renter Share.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B25003 (Tenure).",
    limitations: "Vacant units are excluded. This is housing tenure composition, not affordability, housing quality, or residential stability. Missing, negative, or inconsistent estimates are excluded. Quantile thresholds depend on the national reference distribution.",
  },
  {
    label: "Population Size", group: "Demographics", aliases: ["population size", "population", "total population"],
    meaning: "The estimated total resident population, grouped by fixed population thresholds.",
    calculation: "Based on the number, it was categorized into bins. Categories are Very Small: under 5,000; Small: 5,000-9,999; Small-Medium: 10,000-24,999; Medium: 25,000-49,999; Medium-Large: 50,000-99,999; Large: 100,000-249,999; Very Large: 250,000-499,999; Major Population Center: 500,000 or more.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B01003 (Total Population).",
    limitations: "These are custom project thresholds, not official Census classifications. ACS estimates summarize the 2020-2024 collection period rather than a population count on a single date.",
  },
  {
    label: "Median Age", group: "Demographics", aliases: ["median age", "age"],
    meaning: "The midpoint of the age distribution for the total population in a place.",
    calculation: "Categorized places into five national quantile groups. Equal estimates made the groups unequal in size.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B01002 (Median Age by Sex).",
    limitations: "The groups indicate relative national position, not fixed age bands.",
  },
  {
    label: "Landform", group: "Geography", aliases: ["landform", "land form", "terrain"],
    meaning: "The physical landform at a representative point inside the place boundary.",
    calculation: "Used the centroid of the Place polygon boundary as the sample point. Used the Extract Values To Points with nearest-cell sampling on the World Ecological Land Units raster. NoData or unmatched values remain unclassified.",
    source: "Esri / USGS, World Ecological Land Units (2015), raster landform description ELU_LF_Des. Resolution: 7.5 arc-seconds.",
    limitations: "One sampled cell does not establish the dominant landform across the whole place. Large places can contain several landforms. Raster coverage and NoData can leave places unclassified; the class is not a measure of ecological quality.",
  },
  {
    label: "Hydrography", group: "Geography", aliases: ["hydrography", "hydrogeography", "water body", "water feature"],
    meaning: "Whether the place boundary is near a mapped ocean coastline, lake, or prominent river.",
    calculation: "Test each water type independently within one mile of the place boundary using geodesic distance. Rivers are restricted to Natural Earth scalerank <= 6. The Hydrography classification used priority Coastal, then Lakeside, then Riverside, then None.",
    source: "Natural Earth Data - Coastline, Lakes, and Rivers Shapefiles.",
    limitations: "One mile is proximity, not proof of a waterfront or public access. Natural Earth is generalized and omits smaller features. Scalerank is cartographic prominence, not discharge or navigability. None means no qualifying mapped feature was found, not no water.",
  },
  {
    label: "Dominant Industry", group: "Industry & Culture", aliases: ["dominant industry", "industry"],
    meaning: "The broad industry group with the most employed residents age 16 and over, rather than the most jobs physically located in the place.",
    calculation: "Aggregate C24030 industry counts into broad groups using ACS_2024_C24030_Metadata labels. Select the group with the largest count. Invalid estimates or a zero total remain unclassified.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table C24030 (Sex by Industry for the Civilian Employed Population 16 Years and Over).",
    limitations: "This describes resident workforce composition, not local establishments, workplace jobs, or unusual concentration compared with the national workforce. Missing data are not treated as zero.",
  },
  {
    label: "Geographic Area", group: "Geography", aliases: ["geographic area", "land area"],
    meaning: "The place's land-area footprint in square miles.",
    calculation: "Classify LAND_AREA_SQMI into eight fixed ranges: Very Small: under 0.5; Small: 0.5 to under 1; Moderately Small: 1 to under 3; Moderate: 3 to under 5; Moderately Large: 5 to under 10; Large: 10 to under 25; Very Large: 25 to under 100; Extremely Large: 100 or more square miles. Null or negative values remain unclassified; zero is Very Small.",
    source: " U.S. Census Bureau, 2024 Census-place ALAND field.",
    limitations: "The size thresholds are analytical choices, not official Census definitions.",
  },
  {
    label: "Rent Price", group: "Housing & Infrastructure", aliases: ["rent price", "median rent", "gross rent"],
    meaning: "Median monthly gross rent, including contract rent and estimated utility costs for renter-occupied units paying cash rent.",
    calculation: "Used B25064_001E as a monthly dollar amount. Classified valid matched places into six national quantile categories from Very Low to Very High Median Rent, retaining ties in the same category.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B25064 (Median Gross Rent).",
    limitations: "This combines rental units of different sizes; it is not a one-bedroom rent estimate or an affordability measure relative to income. Quantile cutoffs are relative, not fixed dollar thresholds. ACS covers 2020-2024, not a single-date rental market.",
  },
  {
    label: "Racial and Ethnic Diversity", group: "Demographics", aliases: ["racial and ethnic diversity", "racial ethnic diversity", "ethnic diversity", "diversity"],
    meaning: "How evenly the population is distributed across eight mutually exclusive race/ethnicity groups.",
    calculation: "Calculate Simpson's diversity index D = 1 - sum(p_i squared), using unrounded shares of the same eight B03002 groups as Predominant Race. Zero indicates one group; the theoretical maximum with eight groups is 0.875. Retain the raw index and classify valid places into five national quantile groups.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B03002 (Hispanic or Latino Origin by Race).",
    limitations: "This measures distribution across the chosen groups, not every dimension of identity or diversity. National quantile thresholds can change with the reference population or release. Ties may produce unequal group sizes.",
  },
  {
    label: "Transit Type", group: "Housing & Infrastructure", aliases: ["transit type", "public transit", "transportation"],
    meaning: "The types of fixed-route public transit mapped as intersecting a place boundary.",
    calculation: "Intersected National Transit Map route geometries with Census-place polygons, mapped GTFS route_type codes to ten modes, and aggregated distinct modes by GEOID. Multiple rail-family types, or rail plus another mode, are Multimodal Rail; a lone rail mode is Rail Only. Other summaries include Bus Only, Bus + Other, specific single modes, Other Multimodal, and No Mode Identified. The rail family is rail, light rail, and subway/metro.",
    source: "National Transit Map Routes, Esri Living Atlas.",
    limitations: "A route can cross a boundary without any boarding stop inside it. The method does not measure frequency, hours, quality, or accessibility, and does not infer BRT or commuter/heavy-rail subtypes. No Mode Identified has coverage unverified and does not prove absence of service.",
  },
  {
    label: "Median Household Income Level", group: "Demographics", aliases: ["median household income level", "median household income", "household income", "income level", "incomelevel"],
    meaning: "The midpoint of the household income distribution, expressed relative to other places nationally.",
    calculation: "Grouped valid estimates into ten national income deciles. Retained the original median household income in the inflation-adjusted dollars used by the ACS release.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, table B19013 (Median Household Income), variable B19013_001E.",
    limitations: "Deciles are relative classifications, not fixed income thresholds. Ties can make groups unequal in size. The classification does not account for local cost of living or survey margins of error.",
  },
  {
    label: "College and University Presence", group: "Industry & Culture", aliases: ["college and university presence", "college presence", "collegepresence", "presence of colleges and universities", "colleges and universities", "higher education", "universities", "colleges"],
    meaning: "The concentration of postsecondary institutions and their enrollment relative to the place's population.",
    calculation: "Spatially joined institution points to place polygons with INTERSECT, counted institutions, and summed the total student enrollement in the place. STUDENT_POP_PCT = enrollment / POPULATION x 100. Zero institutions gives No College/University Presence. Eligible places with institutions are split into five national quintiles using the 20th, 40th, 60th, and 80th percentiles of the ratio. Missing or invalid data gives Data Unavailable, not no presence.",
    source: "Integrated Postsecondary Education Data System (IPEDS), FTE12MN enrollment.",
    limitations: "The ratio is not the percentage of residents who are students: enrollment is assigned to campus locations and students may commute. It does not measure academic quality, prestige, or economic importance. Quintiles indicate relative national intensity, not fixed college-town thresholds.",
  },
  {
    label: "Climate", group: "Geography", aliases: ["climate"],
    meaning: "A long-term climate-zone classification at a representative point inside the place.",
    calculation: "Created an inside point with Feature To Point. Performed a one-to-one, keep-all Spatial Join using INTERSECT with CEC climate polygons, copying Climate into CLIMATE_ZONE. For initially null assignments, use Near with geodesic distance and copy the nearest polygon's Climate value. Preserve existing non-null assignments.",
    source: "Commission for Environmental Cooperation (CEC), North American Climate Zones from the North American Environmental Atlas, based on Koppen-Geiger classification.",
    limitations: "This is the zone at one representative point, not the predominant zone by area. Coastal nearest-polygon assignments are estimates and can cross water or landmasses. Climate classes describe long-term conditions, not current weather.",
  },
  {
    label: "Population Density", group: "Geography", aliases: ["population density", "density"],
    meaning: "Estimated residents per square mile of land within a Census place, excluding water area.",
    calculation: "Converted ALAND from square meters to square miles by dividing by 2,589,988.11. Divided B01003_001E population by that land area. Sorted valid densities nationally and used nearest-rank breakpoints for six quantile classes from Very Low to Very High, keeping tied values together.",
    source: "U.S. Census Bureau, 2024 ACS 5-Year Estimates, B01003_001E; 2024 Census-place geography, ALAND field.",
    limitations: "Density uses all land within the boundary, including parks, forests, and other unpopulated land. It does not independently measure walkability, housing density, or transit access. ACS reflects 2020-2024; the density section explicitly uses 2024 geography, whereas the project's general place layer is documented as 2025.",
  },
];

const groupOrder = [
  "Demographics",
  "Geography",
  "Industry & Culture",
  "Housing & Infrastructure",
  "Other characteristics",
];

function normalize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(has|is|includes|contains)\s+/, "");
}

function findDefinition(dimension: CharacteristicDimension): CharacteristicDefinition | undefined {
  const searchableNames = [dimension.label, dimension.relationshipType, dimension.categoryType].map(normalize);
  return definitions.find((candidate) => {
    const aliases = [candidate.label, ...candidate.aliases].map(normalize);
    return searchableNames.some((name) => aliases.includes(name));
  });
}

export function getCharacteristicInfo(dimension: CharacteristicDimension): CharacteristicInfo {
  const definition = findDefinition(dimension);
  return {
    meaning: definition?.meaning ?? `The category represented by ${dimension.label} in the connected graph.`,
    calculation: definition?.calculation ?? "The graph's upstream formula is not included in its metadata. This app compares the category IDs assigned to each place using shared categories divided by the total distinct categories across both places (Jaccard similarity), then applies this characteristic's weight. Missing dimensions are excluded.",
    source: definition?.source ?? "Connected Knowledge Graph. The graph metadata does not include an original dataset citation.",
    limitations: definition?.limitations,
  };
}

export function groupSharedCharacteristics(dimensions: CharacteristicDimension[], scores: DimensionScore[]): SharedCharacteristicGroup[] {
  return groupCharacteristicDimensions(dimensions).flatMap((group) => {
    const characteristics = group.dimensions.flatMap((dimension) => {
      const score = scores.find((item) => item.dimensionKey === dimension.key);
      return score && score.sharedCount > 0
        ? [{ key: dimension.key, label: dimension.label, values: score.sharedValues ?? [], sharedCount: score.sharedCount }]
        : [];
    });
    return characteristics.length ? [{ label: group.label, characteristics }] : [];
  });
}

export function groupCharacteristicDimensions(dimensions: CharacteristicDimension[]): CharacteristicGroup[] {
  const groups = new Map(groupOrder.map((label) => [label, [] as CharacteristicDimension[]]));

  for (const dimension of dimensions) {
    const definition = findDefinition(dimension);
    const groupLabel = definition?.group ?? "Other characteristics";
    groups.get(groupLabel)?.push({ ...dimension, label: definition?.label ?? dimension.label });
  }

  return groupOrder.flatMap((label) => {
    const groupedDimensions = groups.get(label) ?? [];
    return groupedDimensions.length > 0 ? [{ label, dimensions: groupedDimensions }] : [];
  });
}