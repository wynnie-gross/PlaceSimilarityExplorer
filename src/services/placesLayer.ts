import type Graphic from "@arcgis/core/Graphic.js";
import type WebMap from "@arcgis/core/WebMap.js";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type Extent from "@arcgis/core/geometry/Extent.js";
import type SpatialReference from "@arcgis/core/geometry/SpatialReference.js";

export interface PlaceSearchResult {
  id: string;
  name: string;
  state: string;
  graphic: Graphic;
}

export async function findPlacesLayer(map: WebMap): Promise<FeatureLayer> {
  await map.load();
  const layers = map.allLayers.toArray().filter((layer) => layer.type === "feature") as FeatureLayer[];
  const namedLayers = layers.filter((layer) => /places/i.test(layer.title ?? ""));
  const candidates = namedLayers.length ? namedLayers : layers;
  const matchingLayers: FeatureLayer[] = [];
  for (const layer of candidates) {
    await layer.load();
    if (layer.geometryType !== "polygon" && layer.fields.some((field) => /^geoid(?:\d+)?$/i.test(field.name))) matchingLayers.push(layer);
  }
  if (matchingLayers.length !== 1) throw new Error("Could not identify a unique Places layer with a GEOID field in the web map.");
  const layer = matchingLayers[0];
  layer.outFields = ["*"];
  return layer;
}

export async function configurePlaceBoundaryFilter(map: WebMap): Promise<(geoid: string | null) => Promise<Extent | null>> {
  await map.load();
  const layers = map.allLayers.toArray().filter((layer) => layer.type === "feature") as FeatureLayer[];
  const namedLayers = layers.filter((layer) => /place.*boundar|boundar.*place/i.test(layer.title ?? ""));
  const matchingLayers: FeatureLayer[] = [];
  for (const layer of namedLayers.length ? namedLayers : layers) {
    await layer.load();
    if (layer.geometryType === "polygon" && layer.fields.some((field) => /^geoid(?:\d+)?$/i.test(field.name))) matchingLayers.push(layer);
  }
  if (matchingLayers.length !== 1) throw new Error("Could not identify a unique Place Boundaries polygon layer with a GEOID field.");
  const layer = matchingLayers[0];
  const field = layer.fields.find((candidate) => /^geoid(?:\d+)?$/i.test(candidate.name))!;
  const originalExpression = layer.definitionExpression;
  layer.definitionExpression = "1=0";

  return (geoid: string | null) => {
    if (geoid === null) {
      layer.definitionExpression = "1=0";
      return Promise.resolve(null);
    }
    const isNumeric = ["small-integer", "integer", "single", "double", "long", "big-integer"].includes(field.type);
    if (isNumeric && !/^\d+$/.test(geoid)) throw new Error("The selected GEOID is not valid for the boundary layer's numeric GEOID field.");
    const value = isNumeric ? geoid : `'${geoid.replaceAll("'", "''")}'`;
    const expression = `${field.name} = ${value}`;
    layer.definitionExpression = originalExpression ? `(${originalExpression}) AND (${expression})` : expression;
    const query = layer.createQuery();
    query.where = layer.definitionExpression;
    return layer.queryExtent(query).then((result) => result.extent ?? null);
  };
}

export async function searchLayerPlaces(layer: FeatureLayer, term: string): Promise<PlaceSearchResult[]> {
  const nameField = layer.fields.find((field) => /^(name|place_name|placename)$/i.test(field.name))?.name ?? layer.displayField;
  if (!nameField) throw new Error("The Places layer does not expose a name field for search.");
  const stateField = layer.fields.find((field) => /^(state_name|statename|state)$/i.test(field.name))?.name;
  const geoidField = layer.fields.find((field) => /^geoid(?:\d+)?$/i.test(field.name))!.name;
  const escapeTerm = (value: string) => value.trim().toUpperCase().replaceAll("'", "''").replace(/[%_]/g, "");
  const commaIndex = term.indexOf(",");
  let searchWhere: string;
  if (commaIndex >= 0) {
    const name = escapeTerm(term.slice(0, commaIndex));
    const state = escapeTerm(term.slice(commaIndex + 1));
    const clauses: string[] = [];
    if (name) clauses.push(`UPPER(${nameField}) LIKE '%${name}%'`);
    if (state) clauses.push(stateField ? `UPPER(${stateField}) LIKE '${state}%'` : "1=0");
    searchWhere = clauses.length ? clauses.join(" AND ") : "1=0";
  } else {
    const tokens = [...new Set(escapeTerm(term).split(/\s+/).filter(Boolean))];
    searchWhere = tokens.length ? tokens.map((token) => stateField
      ? `(UPPER(${nameField}) LIKE '%${token}%' OR UPPER(${stateField}) LIKE '%${token}%')`
      : `UPPER(${nameField}) LIKE '%${token}%'`).join(" AND ") : "1=0";
  }
  const query = layer.createQuery();
  query.where = query.where && query.where !== "1=1" ? `(${query.where}) AND (${searchWhere})` : searchWhere;
  query.outFields = ["*"];
  query.returnGeometry = true;
  query.num = 8;
  query.orderByFields = [`${nameField} ASC`, ...(stateField ? [`${stateField} ASC`] : []), `${layer.objectIdField} ASC`];
  const result = await layer.queryFeatures(query);
  return result.features.map((graphic) => ({
    id: String(graphic.attributes[layer.objectIdField]),
    name: String(graphic.attributes[nameField] ?? graphic.attributes[geoidField]),
    state: stateField ? String(graphic.attributes[stateField] ?? "") : "",
    graphic,
  }));
}

export function placeGeoidWhere(layer: FeatureLayer, geoids: string[]): string {
  const field = layer.fields.find((candidate) => /^geoid(?:\d+)?$/i.test(candidate.name));
  if (!field) throw new Error("The Places layer does not expose a GEOID field.");
  const ids = [...new Set(geoids.map((geoid) => geoid.trim()).filter(Boolean))];
  if (ids.length === 0) return "1=0";
  const numeric = ["small-integer", "integer", "single", "double", "long", "big-integer"].includes(field.type);
  const values = ids.map((geoid) => {
    if (numeric) {
      if (!/^\d+$/.test(geoid)) throw new Error("A comparison GEOID is not valid for the Places layer's numeric field.");
      return String(Number(geoid));
    }
    return `'${geoid.replaceAll("'", "''")}'`;
  });
  return `${field.name} IN (${values.join(", ")})`;
}

export async function queryPlacesByGeoids(layer: FeatureLayer, geoids: string[], spatialReference: SpatialReference): Promise<Graphic[]> {
  const query = layer.createQuery();
  const where = placeGeoidWhere(layer, geoids);
  query.where = query.where ? `(${query.where}) AND (${where})` : where;
  query.outFields = ["*"];
  query.returnGeometry = true;
  query.outSpatialReference = spatialReference;
  const result = await layer.queryFeatures(query);
  return result.features;
}