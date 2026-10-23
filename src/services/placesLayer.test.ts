import { describe, expect, it, vi } from "vitest";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type WebMap from "@arcgis/core/WebMap.js";
import type SpatialReference from "@arcgis/core/geometry/SpatialReference.js";
import { configurePlaceBoundaryFilter, findPlacesLayer, placeGeoidWhere, queryPlacesByGeoids, searchLayerPlaces } from "./placesLayer";

describe("Places layer search", () => {
  it("preserves leading zeros and escapes and deduplicates comparison GEOIDs", () => {
    const layer = { fields: [{ name: "GEOID", type: "string" }] } as unknown as FeatureLayer;
    expect(placeGeoidWhere(layer, ["0123456", "0123456", "O'Brien"])).toBe("GEOID IN ('0123456', 'O''Brien')");
    expect(placeGeoidWhere(layer, [])).toBe("1=0");
  });

  it("uses valid numeric literals for numeric GEOID fields", () => {
    const layer = { fields: [{ name: "geoid", type: "integer" }] } as unknown as FeatureLayer;
    expect(placeGeoidWhere(layer, ["0123456"])).toBe("geoid IN (123456)");
    expect(() => placeGeoidWhere(layer, ["invalid"])).toThrow("numeric field");
  });

  it("queries comparison geometry without changing the searchable layer definition", async () => {
    const queryFeatures = vi.fn().mockResolvedValue({ features: [] });
    const spatialReference = { wkid: 3857 } as SpatialReference;
    const layer = {
      fields: [{ name: "GEOID", type: "string" }],
      definitionExpression: "ACTIVE = 1",
      createQuery: () => ({ where: "ACTIVE = 1" }),
      queryFeatures,
    } as unknown as FeatureLayer;
    await queryPlacesByGeoids(layer, ["0123456", "0765432"], spatialReference);
    expect(queryFeatures).toHaveBeenCalledWith({
      where: "(ACTIVE = 1) AND (GEOID IN ('0123456', '0765432'))",
      outFields: ["*"], returnGeometry: true, outSpatialReference: spatialReference,
    });
    expect(layer.definitionExpression).toBe("ACTIVE = 1");
  });

  it("queries place names and retains feature geometry and GEOIDs", async () => {
    const graphic = {
      attributes: { OBJECTID: 7, NAME: "O'Brien", STATE_NAME: "Texas", GEOID: "0123456" },
      geometry: { type: "point", x: -100, y: 30 },
    };
    const queryFeatures = vi.fn().mockResolvedValue({ features: [graphic] });
    const layer = {
      fields: [{ name: "NAME" }, { name: "STATE_NAME" }, { name: "GEOID" }],
      objectIdField: "OBJECTID",
      createQuery: () => ({}),
      queryFeatures,
    } as unknown as FeatureLayer;

    const results = await searchLayerPlaces(layer, "O'Brien");

    expect(queryFeatures).toHaveBeenCalledWith({
      where: "(UPPER(NAME) LIKE '%O''BRIEN%' OR UPPER(STATE_NAME) LIKE '%O''BRIEN%')",
      outFields: ["*"],
      returnGeometry: true,
      num: 8,
      orderByFields: ["NAME ASC", "STATE_NAME ASC", "OBJECTID ASC"],
    });
    expect(results[0]).toMatchObject({ id: "7", name: "O'Brien", state: "Texas" });
    expect(results[0].graphic).toBe(graphic);
    expect(results[0].graphic.attributes.GEOID).toBe("0123456");
  });

  it.each([
    ["Portland, Or", "UPPER(NAME) LIKE '%PORTLAND%' AND UPPER(STATE_NAME) LIKE 'OR%'"],
    ["Portland Oregon", "(UPPER(NAME) LIKE '%PORTLAND%' OR UPPER(STATE_NAME) LIKE '%PORTLAND%') AND (UPPER(NAME) LIKE '%OREGON%' OR UPPER(STATE_NAME) LIKE '%OREGON%')"],
    ["Portland,", "UPPER(NAME) LIKE '%PORTLAND%'"],
  ])("narrows city/state suggestions for %s", async (term, expectedWhere) => {
    const queryFeatures = vi.fn().mockResolvedValue({ features: [] });
    const layer = {
      fields: [{ name: "NAME" }, { name: "STATE_NAME" }, { name: "GEOID" }],
      objectIdField: "OBJECTID",
      createQuery: () => ({ where: "ACTIVE = 1" }),
      queryFeatures,
    } as unknown as FeatureLayer;
    await searchLayerPlaces(layer, term);
    expect(queryFeatures).toHaveBeenCalledWith(expect.objectContaining({ where: `(ACTIVE = 1) AND (${expectedWhere})` }));
  });

  it("rejects ambiguous Places layers", async () => {
    const layer = {
      type: "feature",
      title: "Places",
      fields: [{ name: "GEOID" }],
      load: vi.fn().mockResolvedValue(undefined),
    };
    const map = {
      load: vi.fn().mockResolvedValue(undefined),
      allLayers: { toArray: () => [layer, { ...layer }] },
    } as unknown as WebMap;

    await expect(findPlacesLayer(map)).rejects.toThrow("unique Places layer");
  });

  it("shows only the selected boundary without accumulating filters or changing the point layer", async () => {
    const extent = { xmin: -101, ymin: 29, xmax: -99, ymax: 31 };
    const boundary = {
      type: "feature",
      title: "Place Boundaries",
      geometryType: "polygon",
      fields: [{ name: "GEOID", type: "string" }],
      definitionExpression: "ACTIVE = 1",
      load: vi.fn().mockResolvedValue(undefined),
      createQuery: () => ({}),
      queryExtent: vi.fn().mockResolvedValue({ extent }),
    };
    const points = { ...boundary, title: "Places", geometryType: "point", definitionExpression: "" };
    const map = {
      load: vi.fn().mockResolvedValue(undefined),
      allLayers: { toArray: () => [points, boundary] },
    } as unknown as WebMap;

    const filter = await configurePlaceBoundaryFilter(map);
    expect(boundary.definitionExpression).toBe("1=0");
    expect(await filter("0123456")).toBe(extent);
    expect(boundary.definitionExpression).toBe("(ACTIVE = 1) AND (GEOID = '0123456')");
    expect(boundary.queryExtent).toHaveBeenLastCalledWith({ where: "(ACTIVE = 1) AND (GEOID = '0123456')" });
    await filter("0765432");
    expect(boundary.definitionExpression).toBe("(ACTIVE = 1) AND (GEOID = '0765432')");
    expect(points.definitionExpression).toBe("");
    expect(await filter(null)).toBeNull();
    expect(boundary.definitionExpression).toBe("1=0");
    expect(boundary.queryExtent).toHaveBeenCalledTimes(2);
  });
});