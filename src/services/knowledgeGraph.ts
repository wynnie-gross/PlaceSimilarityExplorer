import type KnowledgeGraph from "@arcgis/core/rest/knowledgeGraph/KnowledgeGraph.js";
import GraphQueryStreaming from "@arcgis/core/rest/knowledgeGraph/GraphQueryStreaming.js";
import GraphSearch from "@arcgis/core/rest/knowledgeGraph/GraphSearch.js";
import { executeQueryStreaming, executeSearch, fetchKnowledgeGraph } from "@arcgis/core/rest/knowledgeGraphService.js";
import type { CharacteristicDimension, ConnectionConfig, GraphEntity, PlaceSchema, RankedPlace } from "../types";

interface CandidateRow {
  candidate: GraphEntity;
  dimensionKey: string;
  sharedCount: number;
  sourceCount: number;
  candidateCount: number;
  sharedValues: string[];
}

export interface LiveGraph {
  graph: KnowledgeGraph;
  schema: PlaceSchema;
  layerUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toGraphEntity(value: unknown): GraphEntity | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.typeName !== "string") return;
  return {
    id: value.id,
    typeName: value.typeName,
    properties: isRecord(value.properties) ? value.properties : {},
  };
}

function quoteIdentifier(value: string): string {
  return `\`${value.replaceAll("`", "``")}\``;
}

function quoteString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function discoverNameField(properties: Array<{ name: string; alias?: string | null; fieldType?: string }>): string {
  const byCanonicalName = properties.find((property) => {
    const name = property.name.toLowerCase();
    return name === "name" || name === "place_name" || name === "placename";
  });
  if (byCanonicalName) return byCanonicalName.name;

  const byAlias = properties.find((property) => property.alias?.toLowerCase() === "name");
  if (byAlias) return byAlias.name;

  return properties.find((property) => property.fieldType === "esriFieldTypeString" && !property.name.toLowerCase().includes("id"))?.name ?? "name";
}

function discoverGeographyField(properties: Array<{ name: string; alias?: string | null }>): string | undefined {
  return properties.find((property) => {
    const fieldName = property.name.toLowerCase();
    const alias = property.alias?.toLowerCase() ?? "";
    return ["state", "state_name", "territory", "geography", "region"].includes(fieldName) ||
      ["state", "territory", "geography"].includes(alias);
  })?.name;
}

function discoverGeoidField(properties: Array<{ name: string; alias?: string | null }>): string | undefined {
  return properties.find((property) => /^geoid(?:\d+)?$/i.test(property.name) || /^geoid(?:\s+\d+)?$/i.test(property.alias ?? ""))?.name;
}

export function discoverPlaceSchema(
  graph: KnowledgeGraph,
  expectedPlaceType = "Place",
  characteristicRelationshipNames: string[] = [],
): PlaceSchema {
  const entityTypes = graph.dataModel.entityTypes;
  const placeType = entityTypes.find((type) => type.name.toLowerCase() === expectedPlaceType.toLowerCase()) ??
    entityTypes.find((type) => type.alias?.toLowerCase() === expectedPlaceType.toLowerCase());

  if (!placeType) {
    const available = entityTypes.map((type) => type.name).join(", ");
    throw new Error(`Could not find the ${expectedPlaceType} entity type. Available types: ${available || "none"}.`);
  }

  const identifierInfo = graph.dataModel.identifierInfo?.identifierMappingInfo;
  const idField = identifierInfo?.uniformPropertyIdentifier?.identifierPropertyName ?? "globalid";
  const relationshipTypes = graph.dataModel.relationshipTypes;
  const dimensions: CharacteristicDimension[] = [];

  for (const relationship of relationshipTypes) {
    if (characteristicRelationshipNames.length > 0 &&
      !characteristicRelationshipNames.some((name) => name.toLowerCase() === relationship.name.toLowerCase())) continue;

    for (const endpoints of relationship.endPoints) {
      const otherType = endpoints.originEntityType === placeType.name
        ? endpoints.destinationEntityType
        : endpoints.destinationEntityType === placeType.name
          ? endpoints.originEntityType
          : undefined;

      if (!otherType || otherType === placeType.name) continue;
      const categoryType = entityTypes.find((type) => type.name === otherType);
      if (!categoryType) continue;

      dimensions.push({
        key: relationship.name,
        label: relationship.alias || relationship.name.replaceAll("_", " "),
        relationshipType: relationship.name,
        categoryType: categoryType.name,
        categoryNameField: discoverNameField(categoryType.properties),
      });
    }
  }

  if (dimensions.length === 0) {
    throw new Error(`No relationships from ${placeType.name} to another entity type were found.`);
  }

  return {
    typeName: placeType.name,
    idField,
    nameField: discoverNameField(placeType.properties),
    geoidField: discoverGeoidField(placeType.properties),
    geographyField: discoverGeographyField(placeType.properties),
    dimensions,
  };
}

export async function connectGraph(config: ConnectionConfig, expectedPlaceType: string): Promise<LiveGraph> {
  const graph = await fetchKnowledgeGraph(config.graphServiceUrl);
  const schema = discoverPlaceSchema(graph, expectedPlaceType, config.characteristicRelationshipNames);
  return { graph, schema, layerUrl: config.graphServiceUrl };
}

export async function findPlaceByGeoid(liveGraph: LiveGraph, geoid: string): Promise<GraphEntity | undefined> {
  const { graph, schema } = liveGraph;
  if (!schema.geoidField) {
    throw new Error(`The ${schema.typeName} graph entity type does not expose a GEOID field.`);
  }

  const response = await executeQueryStreaming(graph, new GraphQueryStreaming({
    openCypherQuery: `MATCH (place:${quoteIdentifier(schema.typeName)}) WHERE toString(place.${quoteIdentifier(schema.geoidField)}) = $geoid RETURN place LIMIT 1`,
    bindParameters: { geoid },
  }));

  const reader = response.resultRowsStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return undefined;
      for (const row of value) {
        const place = toGraphEntity(row[0]);
        if (place) return place;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function searchPlaces(graph: KnowledgeGraph, schema: PlaceSchema, term: string): Promise<GraphEntity[]> {
  const result = await executeSearch(graph, new GraphSearch({
    searchQuery: term,
    typeCategoryFilter: "entity",
  }));
  const entities = result.resultRows.flatMap((row) => row.map(toGraphEntity).filter((entity): entity is GraphEntity => !!entity));
  const query = term.trim().toLocaleLowerCase();
  return entities
    .filter((entity) => entity.typeName === schema.typeName)
    .filter((entity) => String(entity.properties[schema.nameField] ?? entity.id).toLocaleLowerCase().includes(query))
    .slice(0, 8);
}

export async function findSimilarPlaces(liveGraph: LiveGraph, source: GraphEntity): Promise<RankedPlace[]> {
  const { graph, schema } = liveGraph;
  const placeType = quoteIdentifier(schema.typeName);
  const idField = quoteIdentifier(schema.idField);
  const sourceId = source.properties[schema.idField] ?? source.id;

  const branches = schema.dimensions.map((dimension) => {
    const relationshipType = quoteIdentifier(dimension.relationshipType);
    const categoryType = quoteIdentifier(dimension.categoryType);
    const key = quoteString(dimension.key);
    return `MATCH (source:${placeType})\n` +
      `WHERE source.${idField} = $sourceId\n` +
      `OPTIONAL MATCH (source)-[:${relationshipType}]-(sourceTrait:${categoryType})\n` +
      `WITH source, collect(DISTINCT sourceTrait.${idField}) AS sourceTraitIds, ` +
      `collect(DISTINCT sourceTrait.${quoteIdentifier(dimension.categoryNameField)}) AS sourceTraitNames\n` +
      `MATCH (candidate:${placeType})\n` +
      `WHERE candidate.${idField} <> $sourceId\n` +
      `OPTIONAL MATCH (candidate)-[:${relationshipType}]-(candidateTrait:${categoryType})\n` +
      `WITH candidate, sourceTraitIds, sourceTraitNames, ` +
      `collect(DISTINCT candidateTrait.${idField}) AS candidateTraitIds, ` +
      `collect(DISTINCT candidateTrait.${quoteIdentifier(dimension.categoryNameField)}) AS candidateTraitNames\n` +
      `RETURN candidate, ${key} AS dimensionKey, ` +
      `size([traitId IN sourceTraitIds WHERE traitId IN candidateTraitIds]) AS sharedCount, ` +
      `size(sourceTraitIds) AS sourceCount, size(candidateTraitIds) AS candidateCount, ` +
      `[traitName IN sourceTraitNames WHERE traitName IN candidateTraitNames] AS sharedValues`;
  });

  const response = await executeQueryStreaming(graph, new GraphQueryStreaming({
    openCypherQuery: branches.join("\nUNION ALL\n"),
    bindParameters: { sourceId: String(sourceId) },
  }));

  const candidateRows: CandidateRow[] = [];
  const reader = response.resultRowsStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const row of value) {
        const candidate = toGraphEntity(row[0]);
        if (!candidate || typeof row[1] !== "string") continue;
        candidateRows.push({
          candidate,
          dimensionKey: row[1],
          sharedCount: Number(row[2] ?? 0),
          sourceCount: Number(row[3] ?? 0),
          candidateCount: Number(row[4] ?? 0),
          sharedValues: Array.isArray(row[5]) ? row[5].map(String) : [],
        });
      }
    }
  } finally {
    reader.releaseLock();
  }

  const grouped = new Map<string, { place: GraphEntity; dimensions: RankedPlace["dimensions"] }>();
  for (const row of candidateRows) {
    const existing = grouped.get(row.candidate.id) ?? { place: row.candidate, dimensions: [] };
    existing.dimensions.push({
      dimensionKey: row.dimensionKey,
      sharedCount: row.sharedCount,
      sourceCount: row.sourceCount,
      candidateCount: row.candidateCount,
      sharedValues: row.sharedValues,
    });
    grouped.set(row.candidate.id, existing);
  }

  return [...grouped.values()].map((candidate) => ({ place: candidate.place, score: 0, coverage: 0, dimensions: candidate.dimensions }));
}

export function createOriginChartQuery(source: GraphEntity, schema: PlaceSchema): string {
  const placeType = quoteIdentifier(schema.typeName);
  const idField = quoteIdentifier(schema.idField);
  const sourceId = quoteString(String(source.properties[schema.idField] ?? source.id));
  const relationshipTypes = schema.dimensions.map((dimension) => quoteString(dimension.relationshipType)).join(", ");
  return `MATCH (source:${placeType})-[relationship]-(trait)\n` +
    `WHERE source.${idField} = ${sourceId}\n` +
    `AND type(relationship) IN [${relationshipTypes}]\n` +
    `RETURN source, relationship, trait`;
}

export function createLinkChartQuery(source: GraphEntity, candidate: GraphEntity, schema: PlaceSchema): string {
  const placeType = quoteIdentifier(schema.typeName);
  const idField = quoteIdentifier(schema.idField);
  const relationshipTypes = schema.dimensions.map((dimension) => quoteString(dimension.relationshipType)).join(", ");
  const sourceId = quoteString(String(source.properties[schema.idField] ?? source.id));
  const candidateId = quoteString(String(candidate.properties[schema.idField] ?? candidate.id));
  return `MATCH (city:${placeType})\n` +
    `WHERE city.${idField} IN [${sourceId}, ${candidateId}]\n` +
    `OPTIONAL MATCH (city)-[relationship]-(trait)\n` +
    `WHERE type(relationship) IN [${relationshipTypes}]\n` +
    `RETURN city, relationship, trait`;
}
