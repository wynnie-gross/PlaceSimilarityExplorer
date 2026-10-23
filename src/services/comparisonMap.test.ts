import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type MapView from "@arcgis/core/views/MapView.js";
import { createComparisonMap } from "./comparisonMap";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./placesLayer", async (importOriginal) => ({
  ...await importOriginal<typeof import("./placesLayer")>(),
  queryPlacesByGeoids: mocks.query,
}));
vi.mock("@arcgis/core/Graphic.js", () => ({ default: class { constructor(properties: object) { Object.assign(this, properties); } } }));
vi.mock("@arcgis/core/geometry/Polyline.js", () => ({ default: class { constructor(properties: object) { Object.assign(this, properties); } } }));
vi.mock("@arcgis/core/layers/support/FeatureFilter.js", () => ({ default: class { constructor(properties: object) { Object.assign(this, properties); } } }));
vi.mock("@arcgis/core/geometry/Extent.js", () => ({ default: class {
  xmin!: number;
  xmax!: number;
  ymin!: number;
  ymax!: number;
  constructor(properties: object) { Object.assign(this, properties); }
  get width() { return this.xmax - this.xmin; }
  get height() { return this.ymax - this.ymin; }
  expand() { return this; }
} }));
vi.mock("@arcgis/core/layers/GraphicsLayer.js", () => ({ default: class {
  graphics: unknown[] = [];
  add(graphic: unknown) { this.graphics.push(graphic); }
  removeAll() { this.graphics = []; }
  destroy() {}
} }));

function fixture() {
  const features = Array.from({ length: 6 }, (_value, index) => ({
    attributes: { GEOID: String(index).padStart(7, "0") },
    geometry: { type: "point", x: index * 10, y: index * 5 },
  }));
  const places = { fields: [{ name: "GEOID", type: "string" }], minScale: 2000, maxScale: 500000 } as unknown as FeatureLayer;
  const layerView: { filter: unknown } = { filter: null };
  const map = { add: vi.fn(), remove: vi.fn() };
  const goTo = vi.fn().mockResolvedValue(undefined);
  const view = { whenLayerView: vi.fn().mockResolvedValue(layerView), map, goTo, spatialReference: { wkid: 3857 }, container: null } as unknown as MapView;
  mocks.query.mockResolvedValue(features);
  return { features, places, layerView, map, view, goTo, matches: features.slice(1).map((feature) => feature.attributes.GEOID) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("comparison map", () => {
  it("filters six points, draws five lines, and fits their extent", async () => {
    const setup = fixture();
    const controller = await createComparisonMap(setup.view, setup.places);
    await controller.show("0000000", setup.matches);
    const lines = setup.map.add.mock.calls[0][0];
    expect(lines.graphics).toHaveLength(5);
    expect(setup.layerView.filter).toEqual(expect.objectContaining({ where: "GEOID IN ('0000000', '0000001', '0000002', '0000003', '0000004', '0000005')" }));
    expect(setup.places.minScale).toBe(0);
    expect(setup.places.maxScale).toBe(0);
    expect(setup.goTo).toHaveBeenCalledWith(expect.objectContaining({ xmin: 0, xmax: 50, ymin: 0, ymax: 25 }), { animate: false });
    controller.destroy();
  });

  it("focuses a selected pair and restores the complete comparison", async () => {
    const setup = fixture();
    const controller = await createComparisonMap(setup.view, setup.places);
    await controller.show("0000000", ["0000001"]);
    const lines = setup.map.add.mock.calls[0][0];
    expect(lines.graphics).toHaveLength(1);
    expect(setup.layerView.filter).toEqual(expect.objectContaining({ where: "GEOID IN ('0000000', '0000001')" }));
    expect(setup.goTo).toHaveBeenLastCalledWith(expect.objectContaining({ xmin: 0, xmax: 10, ymin: 0, ymax: 5 }), { animate: false });
    await controller.show("0000000", setup.matches);
    expect(lines.graphics).toHaveLength(5);
    expect(setup.layerView.filter).toEqual(expect.objectContaining({ where: "GEOID IN ('0000000', '0000001', '0000002', '0000003', '0000004', '0000005')" }));
    controller.destroy();
  });

  it("restores the previous filter and scale limits when cleared", async () => {
    const setup = fixture();
    const originalFilter = { where: "ACTIVE = 1", toJSON: () => ({ where: "ACTIVE = 1" }) };
    setup.layerView.filter = originalFilter;
    const controller = await createComparisonMap(setup.view, setup.places);
    await controller.show("0000000", setup.matches);
    expect(setup.layerView.filter).toEqual(expect.objectContaining({ where: expect.stringContaining("(ACTIVE = 1) AND") }));
    controller.clear();
    expect(setup.layerView.filter).toBe(originalFilter);
    expect(setup.places.minScale).toBe(2000);
    expect(setup.places.maxScale).toBe(500000);
    expect(setup.map.add.mock.calls[0][0].graphics).toHaveLength(0);
    controller.destroy();
  });

  it("does not silently omit a match with no mapped point", async () => {
    const setup = fixture();
    mocks.query.mockResolvedValue(setup.features.slice(0, 1));
    const controller = await createComparisonMap(setup.view, setup.places);
    await expect(controller.show("0000000", setup.matches)).rejects.toThrow("no matching mapped point");
    expect(setup.layerView.filter).toBeNull();
    expect(setup.map.add.mock.calls[0][0].graphics).toHaveLength(0);
    controller.destroy();
  });

  it("ignores an old point query after the comparison is reset", async () => {
    const setup = fixture();
    let resolveQuery!: (features: typeof setup.features) => void;
    mocks.query.mockReturnValue(new Promise((resolve) => { resolveQuery = resolve; }));
    const controller = await createComparisonMap(setup.view, setup.places);
    const pending = controller.show("0000000", setup.matches);
    controller.clear();
    resolveQuery(setup.features);
    await pending;
    expect(setup.layerView.filter).toBeNull();
    expect(setup.goTo).not.toHaveBeenCalled();
    expect(setup.map.add.mock.calls[0][0].graphics).toHaveLength(0);
    controller.destroy();
  });
});