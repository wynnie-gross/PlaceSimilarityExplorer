import Graphic from "@arcgis/core/Graphic.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import type Point from "@arcgis/core/geometry/Point.js";
import Polyline from "@arcgis/core/geometry/Polyline.js";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import FeatureFilter from "@arcgis/core/layers/support/FeatureFilter.js";
import type MapView from "@arcgis/core/views/MapView.js";
import { placeGeoidWhere, queryPlacesByGeoids } from "./placesLayer";

export interface ComparisonMap {
  show(originGeoid: string, matchGeoids: string[]): Promise<void>;
  clear(): void;
  destroy(): void;
}

export async function createComparisonMap(view: MapView, places: FeatureLayer): Promise<ComparisonMap> {
  const layerView = await view.whenLayerView(places);
  const originalFilter = layerView.filter;
  const originalMinScale = places.minScale;
  const originalMaxScale = places.maxScale;
  const lines = new GraphicsLayer({ id: "comparison-connections", title: "Similar Place Connections", listMode: "hide" });
  view.map?.add(lines);
  let request = 0;
  let destroyed = false;
  let displaying = false;
  let fittedPoints: Point[] = [];
  let fitFrame = 0;

  const fit = () => {
    if (destroyed || !displaying || fittedPoints.length === 0) return;
    const coordinates = fittedPoints.map((point) => [point.x, point.y]);
    const extent = new Extent({
      xmin: Math.min(...coordinates.map((coordinate) => coordinate[0])),
      ymin: Math.min(...coordinates.map((coordinate) => coordinate[1])),
      xmax: Math.max(...coordinates.map((coordinate) => coordinate[0])),
      ymax: Math.max(...coordinates.map((coordinate) => coordinate[1])),
      spatialReference: view.spatialReference,
    });
    return extent.width === 0 && extent.height === 0
      ? view.goTo({ target: fittedPoints[0], scale: 150000 }, { animate: false })
      : view.goTo(extent.expand(1.3), { animate: false });
  };

  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => { void fit()?.catch(() => undefined); });
  });
  if (view.container) resizeObserver.observe(view.container);

  const clear = () => {
    request += 1;
    displaying = false;
    fittedPoints = [];
    cancelAnimationFrame(fitFrame);
    lines.removeAll();
    layerView.filter = originalFilter;
    places.minScale = originalMinScale;
    places.maxScale = originalMaxScale;
  };

  return {
    async show(originGeoid, matchGeoids) {
      const requestId = ++request;
      const geoids = [...new Set([originGeoid, ...matchGeoids])];
      const features = await queryPlacesByGeoids(places, geoids, view.spatialReference);
      if (destroyed || requestId !== request) return;
      const points = new Map<string, Point>();
      const field = places.fields.find((candidate) => /^geoid(?:\d+)?$/i.test(candidate.name))!;
      const numeric = field.type !== "string";
      const key = (geoid: string) => numeric ? String(Number(geoid)) : geoid;
      for (const feature of features) {
        if (feature.geometry?.type === "point") points.set(key(String(feature.attributes[field.name])), feature.geometry as Point);
      }
      const origin = points.get(key(originGeoid));
      if (!origin || geoids.some((geoid) => !points.has(key(geoid)))) {
        throw new Error("Some comparison places have no matching mapped point. The comparison map was not filtered.");
      }

      lines.removeAll();
      for (const geoid of [...new Set(matchGeoids)]) {
        if (key(geoid) === key(originGeoid)) continue;
        const point = points.get(key(geoid))!;
        lines.add(new Graphic({
          geometry: new Polyline({ paths: [[[origin.x, origin.y], [point.x, point.y]]], spatialReference: view.spatialReference }),
          symbol: { type: "simple-line", color: [35, 116, 93, 0.8], width: 2 },
        }));
      }
      layerView.filter = new FeatureFilter({
        ...(originalFilter?.toJSON() ?? {}),
        where: originalFilter?.where ? `(${originalFilter.where}) AND (${placeGeoidWhere(places, geoids)})` : placeGeoidWhere(places, geoids),
      });
      places.minScale = 0;
      places.maxScale = 0;
      displaying = true;
      fittedPoints = geoids.map((geoid) => points.get(key(geoid))!);
      await fit();
    },
    clear,
    destroy() {
      clear();
      destroyed = true;
      resizeObserver.disconnect();
      view.map?.remove(lines);
      lines.destroy();
    },
  };
}