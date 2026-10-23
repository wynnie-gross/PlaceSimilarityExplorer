import type Geometry from "@arcgis/core/geometry/Geometry.js";

export interface ConnectionConfig {
  portalUrl: string;
  clientId: string;
  graphServiceUrl: string;
  characteristicRelationshipNames: string[];
}

export interface GraphEntity {
  id: string;
  typeName: string;
  properties: Record<string, unknown>;
}

export interface PlaceSchema {
  typeName: string;
  idField: string;
  nameField: string;
  geoidField?: string;
  geographyField?: string;
  dimensions: CharacteristicDimension[];
}

export interface CharacteristicDimension {
  key: string;
  label: string;
  relationshipType: string;
  categoryType: string;
  categoryNameField: string;
}

export interface DimensionScore {
  dimensionKey: string;
  sharedCount: number;
  sourceCount: number;
  candidateCount: number;
  sharedValues?: string[];
  sourceCategoryIds?: string[];
  candidateCategoryIds?: string[];
}

export interface RankedPlace {
  place: GraphEntity;
  score: number;
  coverage: number;
  dimensions: DimensionScore[];
}

export interface MapPlace {
  id: string;
  name: string;
  geometry?: Geometry;
  geography?: string;
}
