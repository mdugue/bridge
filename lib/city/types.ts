/**
 * Minimal CityJSON 2.0 typing — only the fields the POC touches.
 * https://www.cityjson.org/specs/2.0.1/
 */

export interface CityObject {
  attributes?: Record<string, unknown>;
  /** ids of child objects, e.g. BuildingParts of a Building */
  children?: string[];
  geometry?: unknown[];
  /** ids of parent objects (a BuildingPart points at its Building) */
  parents?: string[];
  type: string;
}

export interface CityJsonDocument {
  CityObjects: Record<string, CityObject>;
  metadata?: { referenceSystem?: string };
  transform?: {
    scale: [number, number, number];
    translate: [number, number, number];
  };
  type: "CityJSON";
  version: string;
  vertices: [number, number, number][];
}
