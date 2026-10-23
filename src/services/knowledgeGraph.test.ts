import { describe, expect, it, vi } from "vitest";
import { createLinkChartQuery, createOriginChartQuery } from "./knowledgeGraph";
import type { GraphEntity, PlaceSchema } from "../types";

vi.mock("@arcgis/core/rest/knowledgeGraph/GraphQueryStreaming.js", () => ({ default: vi.fn() }));
vi.mock("@arcgis/core/rest/knowledgeGraph/GraphSearch.js", () => ({ default: vi.fn() }));
vi.mock("@arcgis/core/rest/knowledgeGraphService.js", () => ({
  executeQueryStreaming: vi.fn(),
  executeSearch: vi.fn(),
  fetchKnowledgeGraph: vi.fn(),
}));

const schema: PlaceSchema = {
  typeName: "Place",
  idField: "globalid",
  nameField: "NAME",
  dimensions: [{ key: "Has_Climate", label: "Climate", relationshipType: "Has_Climate", categoryType: "Climate", categoryNameField: "name" }],
};
const source: GraphEntity = { id: "source-id", typeName: "Place", properties: { globalid: "origin-guid" } };
const candidate: GraphEntity = { id: "candidate-id", typeName: "Place", properties: { globalid: "candidate-guid" } };

describe("link chart queries", () => {
  it("shows the origin's characteristic connections without requiring a candidate", () => {
    const query = createOriginChartQuery(source, schema);
    expect(query).toContain('source.`globalid` = "origin-guid"');
    expect(query).toContain('type(relationship) IN ["Has_Climate"]');
    expect(query).toContain("RETURN source, relationship, trait");
    expect(query).not.toContain("candidate");
  });

  it("includes all characteristic connections for both cities, not only matches", () => {
    const query = createLinkChartQuery(source, candidate, schema);
    expect(query).toContain('city.`globalid` IN ["origin-guid", "candidate-guid"]');
    expect(query).toContain("OPTIONAL MATCH (city)-[relationship]-(trait)");
    expect(query).toContain('WHERE type(relationship) IN ["Has_Climate"]');
    expect(query).toContain("RETURN city, relationship, trait");
    expect(query).not.toContain("candidateRelationship");
    expect(query).not.toContain("LIMIT");
  });

  it("escapes source IDs and falls back to the entity ID", () => {
    const query = createOriginChartQuery({ ...source, id: 'origin"id', properties: {} }, schema);
    expect(query).toContain('source.`globalid` = "origin\\"id"');
  });
});