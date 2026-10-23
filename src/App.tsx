import { useEffect, useRef, useState } from "react";
import EsriMap from "@arcgis/core/Map.js";
import type Extent from "@arcgis/core/geometry/Extent.js";
import type Graphic from "@arcgis/core/Graphic.js";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import WebMap from "@arcgis/core/WebMap.js";
import MapView from "@arcgis/core/views/MapView.js";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Database, Info, LoaderCircle, LogOut, MapPin, Network, Play, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import { configIsComplete, developmentRedirectUrl, environmentConfig, expectedPlaceType } from "./config";
import { getCharacteristicInfo, groupCharacteristicDimensions, groupSharedCharacteristics } from "./characteristics";
import { configureOAuth, checkSignIn, requestCredential, signOut } from "./services/auth";
import { connectGraph, createLinkChartQuery, findPlaceByGeoid, findSimilarPlaces, type LiveGraph } from "./services/knowledgeGraph";
import { configurePlaceBoundaryFilter, findPlacesLayer, searchLayerPlaces, type PlaceSearchResult } from "./services/placesLayer";
import { getScoreBreakdown, scoreGraphCandidates } from "./scoring";
import { comparisonProgress, estimateComparisonDuration } from "./comparisonProgress";
import { createComparisonMap, type ComparisonMap } from "./services/comparisonMap";
import type { CharacteristicDimension, GraphEntity, RankedPlace } from "./types";

interface ArcgisMapElement extends HTMLElement {
  map: EsriMap;
  view: MapView;
  viewOnReady(): Promise<void>;
  closePopup(): Promise<void>;
}

interface ArcgisLinkChartElement extends HTMLElement {
  serviceUrl: string;
  baseCypherQuery: string;
  viewOnReady(): Promise<void>;
  destroy?(): Promise<void>;
}

type AuthState = "checking" | "configuration-required" | "signed-out" | "connecting" | "connected" | "error";
const allGeographiesValue = "__all_geographies__";
const webMapItemId = "af99008bac81483badbf6b01c4d8ddef";

function entityName(entity: GraphEntity | RankedPlace["place"], field: string): string {
  return String(entity.properties[field] ?? entity.id);
}

function entityGeography(entity: GraphEntity | RankedPlace["place"], field?: string): string {
  return field ? String(entity.properties[field] ?? "") : "";
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed. Check Enterprise access and try again.";
}

function featureGeoid(attributes: Record<string, unknown>): string | undefined {
  const entry = Object.entries(attributes).find(([name, value]) => /^geoid(?:\d+)?$/i.test(name) && value != null);
  const value = entry ? String(entry[1]).trim() : "";
  return value || undefined;
}

function App() {
  const mapHost = useRef<HTMLDivElement>(null);
  const mapElementRef = useRef<ArcgisMapElement | null>(null);
  const linkChartHost = useRef<HTMLDivElement>(null);
  const originPopupHost = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const originSearchInput = useRef<HTMLInputElement>(null);
  const originSearchToggle = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountPopover = useRef<HTMLDivElement>(null);
  const startupStarted = useRef(false);
  const placesLayerRef = useRef<FeatureLayer | null>(null);
  const boundaryFilterRef = useRef<((geoid: string | null) => Promise<Extent | null>) | null>(null);
  const selectedMapGeoid = useRef<string | null>(null);
  const selectionRequest = useRef(0);
  const comparisonRequest = useRef(0);
  const comparisonMapRef = useRef<ComparisonMap | null>(null);
  const completedComparisonDurations = useRef<number[]>([]);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authMessage, setAuthMessage] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showWeightsInfo, setShowWeightsInfo] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [liveGraph, setLiveGraph] = useState<LiveGraph | null>(null);
  const [source, setSource] = useState<GraphEntity | null>(null);
  const [originGraphic, setOriginGraphic] = useState<Graphic | null>(null);
  const [showOriginPopup, setShowOriginPopup] = useState(false);
  const [mapShare, setMapShare] = useState(50);
  const [candidates, setCandidates] = useState<RankedPlace[]>([]);
  const [similarityPending, setSimilarityPending] = useState(false);
  const [comparisonStartedAt, setComparisonStartedAt] = useState<number | null>(null);
  const [comparisonElapsedMs, setComparisonElapsedMs] = useState(0);
  const [comparisonExpectedMs, setComparisonExpectedMs] = useState(70000);
  const [comparisonComplete, setComparisonComplete] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [activeCharacteristicInfo, setActiveCharacteristicInfo] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [originSearchExpanded, setOriginSearchExpanded] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeFilter, setActiveFilter] = useState(allGeographiesValue);
  const [mapReady, setMapReady] = useState(false);
  const [linkChartError, setLinkChartError] = useState("");
  const [linkChartPending, setLinkChartPending] = useState(false);

  const dimensions: CharacteristicDimension[] = liveGraph?.schema.dimensions ?? [];
  const characteristicGroups = groupCharacteristicDimensions(dimensions);
  const ranked = liveGraph ? scoreGraphCandidates(candidates, dimensions, weights, liveGraph.schema.nameField) : [];
  const results = ranked.map((result) => ({
    id: result.place.id,
    name: entityName(result.place, liveGraph?.schema.nameField ?? "name"),
    geography: entityGeography(result.place, liveGraph?.schema.geographyField),
    score: result.score,
    coverage: result.coverage,
    place: result.place,
    dimensionScores: result.dimensions,
  }));
  const geographyFilterLabel = /state/i.test(liveGraph?.schema.geographyField ?? "") ? "State" : "Region";
  const geographyValues = [...new Set(results.map((result) => result.geography).filter(Boolean))].sort();
  const filteredResults = results.filter((result) => activeFilter === allGeographiesValue || result.geography.toLowerCase() === activeFilter.toLowerCase());
  const filteredCandidates = filteredResults.slice(0, 5);
  const selectedCandidate = filteredCandidates.find((candidate) => candidate.id === selectedCandidateId);
  const showResults = similarityPending || comparisonComplete || Boolean(comparisonError);
  const showMatchDetails = Boolean(selectedCandidate);
  const scoreBreakdown = selectedCandidate
    ? getScoreBreakdown(selectedCandidate.dimensionScores, groupCharacteristicDimensions(dimensions).flatMap((group) => group.dimensions), weights)
    : [];
  const sharedCharacteristicGroups = selectedCandidate ? groupSharedCharacteristics(dimensions, selectedCandidate.dimensionScores) : [];
  const sharedCharacteristicCount = sharedCharacteristicGroups.reduce((count, group) => count + group.characteristics.length, 0);
  const activeWeightTotal = dimensions.reduce((total, dimension) => total + (weights[dimension.key] ?? 1), 0);
  const progress = comparisonProgress(comparisonElapsedMs, comparisonExpectedMs);
  const comparisonMapGeoids = comparisonComplete && source
    ? [featureGeoid(source.properties), ...(selectedCandidate ? [featureGeoid(selectedCandidate.place.properties)] : filteredCandidates.map((candidate) => featureGeoid(candidate.place.properties)))]
    : [];
  const comparisonMapKey = JSON.stringify(comparisonMapGeoids);

  useEffect(() => {
    if (originSearchExpanded || !source) originSearchInput.current?.focus();
  }, [originSearchExpanded, source]);

  useEffect(() => {
    if (!similarityPending || comparisonStartedAt === null) return;
    const interval = window.setInterval(() => setComparisonElapsedMs(performance.now() - comparisonStartedAt), 1000);
    return () => window.clearInterval(interval);
  }, [similarityPending, comparisonStartedAt]);

  const loadGraph = async () => {
    setAuthState("connecting");
    setAuthMessage("Inspecting the Knowledge Graph data model");
    try {
      const graph = await connectGraph(environmentConfig, expectedPlaceType);
      setLiveGraph(graph);
      setWeights(Object.fromEntries(graph.schema.dimensions.map((dimension) => [dimension.key, 1])));
      setCandidates([]);
      setSource(null);
      setSelectedCandidateId("");
      setAuthState("connected");
      setAuthMessage("");
    } catch (error) {
      setAuthState("error");
      setAuthMessage(errorMessage(error));
    }
  };

  useEffect(() => {
    if (startupStarted.current) return;
    startupStarted.current = true;
    if (!configIsComplete(environmentConfig)) {
      setAuthState("configuration-required");
      return;
    }

    configureOAuth(environmentConfig);
    void checkSignIn(environmentConfig.graphServiceUrl)
      .then(() => loadGraph())
      .catch(() => setAuthState("signed-out"));
  }, []);

  useEffect(() => {
    if (authState !== "connected" || !liveGraph || !mapHost.current) return;
    const map = new WebMap({ portalItem: { id: webMapItemId } });
    const element = document.createElement("arcgis-map") as ArcgisMapElement;
    element.map = map;

    const zoom = document.createElement("arcgis-zoom");
    zoom.slot = "top-left";
    const home = document.createElement("arcgis-home");
    home.slot = "top-left";
    home.label = "Home";
    const layers = document.createElement("arcgis-layer-list");
    layers.label = "Map Layers";
    const layerExpand = document.createElement("arcgis-expand");
    layerExpand.slot = "top-right";
    layerExpand.mode = "floating";
    layerExpand.expandIcon = "layers";
    layerExpand.expandTooltip = "Layers";
    layerExpand.collapseTooltip = "Close Layers";
    layerExpand.label = "Layers";
    layerExpand.group = "map-tools";
    layerExpand.append(layers);
    const legend = document.createElement("arcgis-legend");
    legend.label = "Map Legend";
    const legendExpand = document.createElement("arcgis-expand");
    legendExpand.slot = "top-right";
    legendExpand.mode = "floating";
    legendExpand.expandIcon = "legend";
    legendExpand.expandTooltip = "Legend";
    legendExpand.collapseTooltip = "Close Legend";
    legendExpand.label = "Legend";
    legendExpand.group = "map-tools";
    legendExpand.append(legend);
    const scaleBar = document.createElement("arcgis-scale-bar");
    scaleBar.slot = "bottom-left";
    scaleBar.unit = "dual";
    element.append(zoom, home, layerExpand, legendExpand, scaleBar);

    mapHost.current.replaceChildren(element);
    mapElementRef.current = element;

    const onMapClick = async (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      const hit = await element.view.hitTest({ x: detail.x, y: detail.y });
      const graphic = hit.results
        .map((result) => "graphic" in result ? result.graphic : undefined)
        .find((candidate) => candidate?.layer === placesLayerRef.current);
      if (!graphic) return;
      chooseSource(graphic);
    };

    element.addEventListener("arcgisViewClick", onMapClick);
    let disposed = false;
    void element.viewOnReady().then(async () => {
      const layer = await findPlacesLayer(map);
      if (disposed) return;
      placesLayerRef.current = layer;
      const comparisonMap = await createComparisonMap(element.view, layer);
      if (disposed) { comparisonMap.destroy(); return; }
      comparisonMapRef.current = comparisonMap;
      setMapReady(true);
      try {
        const filter = await configurePlaceBoundaryFilter(map);
        if (!disposed) {
          boundaryFilterRef.current = filter;
          const geoid = selectedMapGeoid.current;
          if (geoid) {
            const extent = await filter(geoid);
            if (!disposed && selectedMapGeoid.current === geoid && extent) await element.view.goTo(extent.clone().expand(1.2));
          }
        }
      } catch (error) {
        if (!disposed) setAuthMessage(errorMessage(error));
      }
    }).catch((error: unknown) => { if (!disposed) setAuthMessage(errorMessage(error)); });
    return () => {
      disposed = true;
      selectionRequest.current += 1;
      comparisonMapRef.current?.destroy();
      comparisonMapRef.current = null;
      placesLayerRef.current = null;
      boundaryFilterRef.current = null;
      selectedMapGeoid.current = null;
      element.removeEventListener("arcgisViewClick", onMapClick);
      element.map = null as unknown as EsriMap;
      element.remove();
      map.destroy();
      mapElementRef.current = null;
      setMapReady(false);
    };
  }, [authState, liveGraph]);

  useEffect(() => {
    const comparisonMap = comparisonMapRef.current;
    if (!mapReady || !comparisonMap) return;
    if (!comparisonComplete) { comparisonMap.clear(); return; }
    const geoids = JSON.parse(comparisonMapKey) as Array<string | null>;
    if (geoids.some((geoid) => !geoid)) {
      comparisonMap.clear();
      setAuthMessage("Some comparison places do not expose a GEOID for mapping.");
      return;
    }
    let cancelled = false;
    const [originGeoid, ...matchGeoids] = geoids as string[];
    void comparisonMap.show(originGeoid, matchGeoids).catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === "AbortError")) setAuthMessage(errorMessage(error));
    });
    return () => { cancelled = true; comparisonMap.clear(); };
  }, [mapReady, comparisonComplete, comparisonMapKey]);

  useEffect(() => {
    if (!mapReady || !placesLayerRef.current || !searchTerm.trim()) {
      setSearchResults([]);
      setSearchPending(false);
      setSearchError("");
      return;
    }
    if (searchTerm.trim().length < 2) {
      setSearchResults([]);
      setSearchPending(false);
      setSearchError("Enter at least two characters.");
      return;
    }
    let cancelled = false;
    setSearchPending(true);
    setSearchError("");
    const timeout = window.setTimeout(() => {
      void searchLayerPlaces(placesLayerRef.current!, searchTerm)
        .then((found) => {
          if (cancelled) return;
          setSearchResults(found);
          if (found.length === 0) setSearchError("No matching places.");
        })
        .catch((error: unknown) => { if (!cancelled) setSearchError(errorMessage(error)); })
        .finally(() => { if (!cancelled) setSearchPending(false); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [mapReady, searchTerm]);

  useEffect(() => {
    const host = linkChartHost.current;
    if (!host) return;
    host.replaceChildren();
    setLinkChartError("");
    setLinkChartPending(false);
    if (!liveGraph || !source?.id || !selectedCandidate) return;

    const element = document.createElement("arcgis-link-chart") as ArcgisLinkChartElement;
    element.serviceUrl = liveGraph.layerUrl;
    element.baseCypherQuery = createLinkChartQuery(source, selectedCandidate.place, liveGraph.schema);
    const layoutSwitcher = document.createElement("arcgis-link-chart-layout-switcher");
    layoutSwitcher.slot = "top-left";
    layoutSwitcher.appearance = "dropdown";
    layoutSwitcher.label = "Chart Layout";
    layoutSwitcher.messageOverrides = { layoutOptions: "Change Chart Layout" };
    element.append(layoutSwitcher);
    setLinkChartPending(true);
    host.append(element);
    let disposed = false;
    const onError = () => {
      if (disposed) return;
      setLinkChartPending(false);
      setLinkChartError("The graph link chart could not load. Check service permissions and the graph relationship schema.");
    };
    let defaultLayoutApplied = false;
    const applyDefaultLayout = () => {
      if (disposed || defaultLayoutApplied || layoutSwitcher.state !== "ready") return;
      defaultLayoutApplied = true;
      void layoutSwitcher.switchLayout("hierarchical-bottom-to-top")
        .then(() => { if (!disposed) setLinkChartPending(false); })
        .catch(onError);
    };
    layoutSwitcher.addEventListener("arcgisReady", applyDefaultLayout);
    layoutSwitcher.addEventListener("arcgisPropertyChange", applyDefaultLayout);
    element.addEventListener("arcgisLoadError", onError);
    void element.viewOnReady().then(applyDefaultLayout).catch(onError);
    return () => {
      disposed = true;
      layoutSwitcher.removeEventListener("arcgisReady", applyDefaultLayout);
      layoutSwitcher.removeEventListener("arcgisPropertyChange", applyDefaultLayout);
      element.removeEventListener("arcgisLoadError", onError);
      void element.destroy?.();
      element.remove();
    };
  }, [liveGraph, source?.id, selectedCandidate?.id]);

  useEffect(() => {
    const host = originPopupHost.current;
    const mapElement = mapElementRef.current;
    if ((!similarityPending && !showOriginPopup) || !originGraphic || !host || !mapElement) return;
    const feature = document.createElement("arcgis-feature");
    feature.graphic = originGraphic;
    feature.map = mapElement.map;
    feature.spatialReference = mapElement.view.spatialReference;
    feature.defaultPopupTemplateEnabled = true;
    feature.hideLastEditedInfo = true;
    host.replaceChildren(feature);
    return () => { feature.remove(); };
  }, [similarityPending, showOriginPopup, originGraphic]);

  useEffect(() => {
    if (!liveGraph || !searchTerm.trim() || searchTerm.trim().length < 2) return;
    if (searchResults.length === 0) return;
  }, [liveGraph, searchTerm, searchResults.length]);

  const signIn = async () => {
    if (!configIsComplete(environmentConfig)) {
      setAuthState("configuration-required");
      setShowConfig(true);
      return;
    }
    setAuthState("connecting");
    setAuthMessage("Opening Enterprise sign-in");
    try {
      configureOAuth(environmentConfig);
      await requestCredential(environmentConfig.graphServiceUrl);
      await loadGraph();
    } catch (error) {
      setAuthState("error");
      setAuthMessage(errorMessage(error));
    }
  };

  const chooseSource = (graphic: Graphic) => {
    if (!liveGraph) return;
    const geoid = featureGeoid(graphic.attributes as Record<string, unknown>);
    if (!geoid) { setAuthMessage("This Places feature has no GEOID."); return; }
    selectedMapGeoid.current = geoid;
    resetComparison();
    setOriginGraphic(graphic);
    const requestId = ++selectionRequest.current;
    setSource(null);
    setCandidates([]);
    setSearchTerm("");
    setSearchResults([]);
    setSelectedCandidateId("");
    setActiveFilter(allGeographiesValue);
    const view = mapElementRef.current?.view;
    if (view) {
      const navigate = async () => {
        const extent = await boundaryFilterRef.current?.(geoid);
        if (requestId !== selectionRequest.current) return;
        if (extent) await view.goTo(extent.clone().expand(1.2));
        else if (graphic.geometry) await view.goTo({ target: graphic.geometry, scale: 150000 });
      };
      void navigate().catch((error: unknown) => {
        if (requestId === selectionRequest.current && !(error instanceof Error && error.name === "AbortError")) setAuthMessage(errorMessage(error));
      });
    }
    setAuthMessage("");
    void findPlaceByGeoid(liveGraph, geoid).then((place) => {
      if (requestId !== selectionRequest.current) return;
      if (!place) throw new Error(`No graph Place matches GEOID ${geoid}.`);
      setSource(place);
      setOriginSearchExpanded(false);
    }).catch((error: unknown) => {
      if (requestId === selectionRequest.current) setAuthMessage(errorMessage(error));
    });
  };

  const disconnect = () => {
    resetComparison();
    signOut();
    setLiveGraph(null);
    setSource(null);
    setCandidates([]);
    setSelectedCandidateId("");
    setAuthState("signed-out");
    setOriginGraphic(null);
    setAuthMessage("");
  };

  const resetComparison = () => {
    comparisonMapRef.current?.clear();
    comparisonRequest.current += 1;
    setCandidates([]);
    setSelectedCandidateId("");
    setSimilarityPending(false);
    setComparisonComplete(false);
    setComparisonError("");
    setShowOriginPopup(false);
  };

  const runComparison = async () => {
    if (!liveGraph || !source || similarityPending || activeWeightTotal === 0) return;
    const requestId = ++comparisonRequest.current;
    setShowOriginPopup(false);
    const startedAt = performance.now();
    setComparisonStartedAt(startedAt);
    setComparisonElapsedMs(0);
    setComparisonExpectedMs(estimateComparisonDuration(completedComparisonDurations.current));
    setSimilarityPending(true);
    setComparisonComplete(false);
    setComparisonError("");
    setCandidates([]);
    setSelectedCandidateId("");
    try {
      const found = await findSimilarPlaces(liveGraph, source);
      if (requestId !== comparisonRequest.current) return;
      completedComparisonDurations.current = [...completedComparisonDurations.current, performance.now() - startedAt].slice(-5);
      setCandidates(found);
      setComparisonComplete(true);
    } catch (error) {
      if (requestId === comparisonRequest.current) setComparisonError(errorMessage(error));
    } finally {
      if (requestId === comparisonRequest.current) setSimilarityPending(false);
    }
  };

  const resetWeights = () => {
    resetComparison();
    setWeights(Object.fromEntries(dimensions.map((dimension) => [dimension.key, 1])));
  };

  const clearSelectedPlace = () => {
    selectionRequest.current += 1;
    selectedMapGeoid.current = null;
    resetComparison();
    setSource(null);
    setOriginGraphic(null);
    setOriginSearchExpanded(false);
    setSearchTerm("");
    setSearchResults([]);
    setSearchPending(false);
    setSearchError("");
    setActiveFilter(allGeographiesValue);
    setWeights(Object.fromEntries(dimensions.map((dimension) => [dimension.key, 1])));
    setComparisonStartedAt(null);
    setComparisonElapsedMs(0);
    setMapShare(50);
    setAuthMessage("");
    setLinkChartError("");
    setLinkChartPending(false);
    workspaceRef.current?.querySelectorAll<HTMLDetailsElement>(".weight-group").forEach((group) => { group.open = false; });
    void boundaryFilterRef.current?.(null);
    const element = mapElementRef.current;
    if (element) {
      void element.closePopup().catch(() => undefined);
      element.querySelectorAll("arcgis-expand").forEach((expand) => { expand.expanded = false; });
      const viewpoint = element.querySelector("arcgis-home")?.viewpoint;
      if (viewpoint) void element.view.goTo(viewpoint, { animate: false }).catch(() => undefined);
    }
    requestAnimationFrame(() => originSearchInput.current?.focus());
  };

  const setDimensionWeight = (key: string, value: number) => {
    resetComparison();
    setWeights((current) => ({ ...current, [key]: value }));
    setSelectedCandidateId("");
  };

  const resizeMatchDetails = (clientY: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const nextShare = (clientY - bounds.top - 5) / Math.max(1, bounds.height - 10) * 100;
    setMapShare(Math.min(75, Math.max(25, nextShare)));
  };

  const closeOriginSearch = () => {
    setOriginSearchExpanded(false);
    setSearchTerm("");
    setSearchResults([]);
    originSearchToggle.current?.focus();
  };

  if (authState !== "connected" || !liveGraph) {
    return <SignInScreen state={authState} message={authMessage} onSignIn={() => void signIn()} onConfig={() => setShowConfig(true)} configOpen={showConfig} onConfigClose={() => setShowConfig(false)} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <HeaderBrand onAbout={() => setShowAbout(true)} />
        <div className="topbar-actions">
          <button className="account-button" ref={accountButton} popoverTarget="enterprise-account" aria-label="Enterprise account" title="Enterprise account" aria-expanded={accountOpen} aria-controls="enterprise-account" onClick={() => {
            const bounds = accountButton.current?.getBoundingClientRect();
            if (!bounds || !accountPopover.current) return;
            accountPopover.current.style.top = `${bounds.bottom + 10}px`;
            accountPopover.current.style.right = `${Math.max(12, window.innerWidth - bounds.right)}px`;
          }}><ShieldCheck size={21} aria-hidden="true" /></button>
          <div className="account-popover" id="enterprise-account" popover="auto" ref={accountPopover} onToggle={(event) => setAccountOpen(event.newState === "open")}>
            <div className="account-popover-heading"><ShieldCheck size={18} aria-hidden="true" /><span>Signed in to ArcGIS Enterprise</span></div>
            <div className="account-portal">{environmentConfig.portalUrl.split("/")[2]}</div>
            <button className="account-sign-out" onClick={() => { accountPopover.current?.hidePopover(); disconnect(); }}><LogOut size={17} aria-hidden="true" /> Sign Out</button>
          </div>
        </div>
      </header>

      <div className={`workspace is-live${showResults ? " has-results" : ""}${showMatchDetails ? " has-match" : ""}`} ref={workspaceRef} style={{ "--map-share": `${mapShare}fr`, "--details-share": `${100 - mapShare}fr` } as React.CSSProperties}>
        <section className="comparison-panel" aria-label="Place comparison">
        <div className="origin-bar">
          {source && <div className="origin-summary-row"><div className="source-card">
            <div className="origin-selected-place">
              <MapPin size={26} aria-hidden="true" />
              <div className="origin-place-line" title={[entityName(source, liveGraph.schema.nameField), entityGeography(source, liveGraph.schema.geographyField)].filter(Boolean).join(", ")}>
                {[entityName(source, liveGraph.schema.nameField), entityGeography(source, liveGraph.schema.geographyField)].filter(Boolean).join(", ")}
              </div>
            </div>
          </div><button className="origin-search-toggle" ref={originSearchToggle} aria-label={originSearchExpanded ? "Close place search" : "Search for another place"} title={originSearchExpanded ? "Close place search" : "Search for another place"} aria-expanded={originSearchExpanded} aria-controls="origin-search-field" onClick={() => originSearchExpanded ? closeOriginSearch() : setOriginSearchExpanded(true)}>{originSearchExpanded ? <X size={17} aria-hidden="true" /> : <Search size={17} aria-hidden="true" />}</button></div>}
          {(!source || originSearchExpanded) && <div className="origin-search" id="origin-search-field">
            <div className="map-search-box">
              <Search size={16} aria-hidden="true" />
              <input id="origin-place-search" ref={originSearchInput} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && source) { event.preventDefault(); closeOriginSearch(); } }} placeholder={source ? "Select a new place" : "Select a place"} aria-label="Search for an origin place" autoComplete="off" />
              {searchTerm && <button aria-label="Clear origin search" onClick={() => setSearchTerm("")}><X size={14} /></button>}
            </div>
            {searchTerm.trim().length > 0 && (
              <div className="search-results" aria-label="Origin search results">
                {searchPending ? <div className="search-empty"><LoaderCircle size={13} className="spin" /> Searching places</div> : searchResults.length ? searchResults.map((place) => (
                  <button className="search-result" key={place.id} onClick={() => chooseSource(place.graphic)}>
                    <MapPin size={15} aria-hidden="true" />
                    <span><strong className="place-suggestion-label">{[place.name, place.state].filter(Boolean).join(", ")}</strong></span>
                  </button>
                )) : <div className="search-empty">{searchError || "No matching places."}</div>}
              </div>
            )}
          </div>}
        </div>
        <aside className="controls-panel" aria-label="Similarity controls">
          <div className="weights-heading"><div><h2>Characteristic weights</h2></div></div>
          <div className="weight-groups">
            {characteristicGroups.map((group, groupIndex) => {
              return (
                <details className="weight-group" key={group.label}>
                  <summary>
                    <span>{group.label}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </summary>
                  <div className="weight-list">
                    {group.dimensions.map((dimension, index) => {
                      const weight = weights[dimension.key] ?? 1;
                      const infoId = `characteristic-info-${groupIndex}-${index}`;
                      const info = getCharacteristicInfo(dimension);
                      return (
                        <div className={`weight-row ${weight === 0 ? "is-muted" : ""}`} key={dimension.key}>
                          <div className="weight-row-top">
                            <span className={`dimension-swatch swatch-${index % 5}`} />
                            <label htmlFor={`weight-${dimension.key}`}>{dimension.label}</label>
                            <button type="button" className="characteristic-info-button" aria-label={`Information about ${dimension.label}`} aria-expanded={activeCharacteristicInfo === infoId} aria-controls={infoId} title={`About ${dimension.label}`} onClick={() => setActiveCharacteristicInfo(activeCharacteristicInfo === infoId ? null : infoId)}>
                              <Info size={13} aria-hidden="true" />
                            </button>
                            <output htmlFor={`weight-${dimension.key}`} className="weight-value">{weight === 0 ? "OFF" : `${weight.toFixed(1)}×`}</output>
                          </div>
                          <input id={`weight-${dimension.key}`} aria-label={`${dimension.label} weight`} type="range" min="0" max="2" step="0.1" value={weight} onChange={(event) => setDimensionWeight(dimension.key, Number(event.target.value))} style={{ "--range-value": `${(weight / 2) * 100}%` } as React.CSSProperties} />
                          {activeCharacteristicInfo === infoId && (
                            <section className="characteristic-info-panel" id={infoId} aria-label={`${dimension.label} information`}>
                              <div><h3>Meaning</h3><p>{info.meaning}</p></div>
                              <div><h3>{info.limitations ? "Documented Computation" : "Calculation"}</h3><p>{info.calculation}</p></div>
                              <div><h3>Data source</h3><p>{info.source}</p></div>
                            </section>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
          <div className="comparison-actions">
            <button className="run-comparison-button" onClick={() => void runComparison()} disabled={!source || similarityPending || activeWeightTotal === 0}>
              {similarityPending ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {similarityPending ? "Running comparison" : "Run comparison"}
            </button>
            <button className="reset-button" onClick={resetWeights} disabled={similarityPending} title="Reset all weights" aria-label="Reset all weights"><RotateCcw size={15} aria-hidden="true" /></button>
          </div>
          <button className="clear-place-button" onClick={clearSelectedPlace} disabled={!originGraphic && !source && !similarityPending}><X size={16} aria-hidden="true" /> Clear Selected Place</button>
          <button className="weights-info-button" onClick={() => setShowWeightsInfo(true)} aria-haspopup="dialog" aria-controls="weights-info-dialog"><Info size={15} aria-hidden="true" /> How Weights Affect Results</button>
        </aside>

        <aside className="results-panel" aria-label="Similarity results" hidden={!showResults}>
          <div className="results-heading"><div><h2>Similar places</h2></div></div>
          {geographyValues.length > 0 && <div className="result-toolbar"><label className="filter-select-wrap"><span className="visually-hidden">Filter by {geographyFilterLabel.toLowerCase()}</span><select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setSelectedCandidateId(""); }}><option value={allGeographiesValue}>All {geographyFilterLabel.toLowerCase()}s</option>{geographyValues.map((geography) => <option key={geography} value={geography}>{geography}</option>)}</select><ChevronDown size={13} /></label></div>}
          {similarityPending && (
            <div className="comparison-progress">
              <span>Querying Knowledge Graph</span>
              <div className="comparison-progress-track" role="progressbar" aria-label="Estimated comparison progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext="Querying Knowledge Graph. Progress is estimated." style={{ "--comparison-progress": `${progress.percent}%` } as React.CSSProperties} />
            </div>
          )}
          <div className="candidate-list" aria-label="Ranked place matches" aria-busy={similarityPending}>{filteredCandidates.map((candidate) => <button className={`candidate-row ${selectedCandidate?.id === candidate.id ? "is-selected" : ""}`} key={candidate.id} aria-pressed={selectedCandidate?.id === candidate.id} onClick={() => setSelectedCandidateId(candidate.id)}><span className="candidate-main"><strong title={[candidate.name, candidate.geography].filter(Boolean).join(", ")}>{[candidate.name, candidate.geography].filter(Boolean).join(", ")}</strong><span className="candidate-meter"><i style={{ width: `${candidate.score * 100}%` }} /></span></span><span className="candidate-score">{percent(candidate.score)}<small>{percent(candidate.coverage)} data</small></span></button>)}{!similarityPending && filteredCandidates.length === 0 && <div className="empty-results"><Search size={22} aria-hidden="true" /><strong role="status">{comparisonError ? "Comparison failed" : !source ? "No origin selected" : comparisonComplete ? "No matching places" : "Ready to compare"}</strong><p>{comparisonError || (!source ? "No comparison results yet." : comparisonComplete ? "No comparable places in this selection." : "Comparison not run.")}</p></div>}</div>
          {!similarityPending && originGraphic && <button className="view-origin-popup-button" onClick={() => setShowOriginPopup((visible) => !visible)} aria-expanded={showOriginPopup} aria-controls="origin-place-popup"><MapPin size={15} aria-hidden="true" />{showOriginPopup ? "Hide Origin Popup" : "View Origin Popup"}</button>}
          {(similarityPending || showOriginPopup) && originGraphic && <section className="origin-popup" id="origin-place-popup" aria-label="Origin place information"><div ref={originPopupHost} /></section>}
          <div className="coverage-note"><span className="coverage-mark" /><span>Coverage is the share of active dimensions comparable for this result.</span></div>
        </aside>
        </section>

        <section className="map-stage" aria-label="Place map">
          <div className="map-frame"><div className="map-grid" aria-hidden="true" /><div className="map-host" ref={mapHost} aria-label="Interactive ArcGIS map" />{!mapReady && <div className="map-loading"><LoaderCircle size={18} className="spin" /> Loading map</div>}</div>
        </section>

        <div className="match-resizer" role="separator" aria-label="Resize Shared Characteristics" aria-orientation="horizontal" aria-controls="shared-characteristics-panel" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(100 - mapShare)} aria-valuetext={`Shared Characteristics uses ${Math.round(100 - mapShare)} percent of the height`} tabIndex={0} hidden={!showMatchDetails} onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeMatchDetails(event.clientY);
        }} onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setMapShare((current) => event.key === "Home" ? 75 : event.key === "End" ? 25 : Math.min(75, Math.max(25, current + (event.key === "ArrowUp" ? -5 : 5))));
        }} title="Drag to resize Shared Characteristics" />
        <section className="inspection-panel" id="shared-characteristics-panel" aria-label="Selected match details" hidden={!showMatchDetails}>
          <div className="match-heading"><div><h2>Shared characteristics</h2><p>{selectedCandidate && source ? `${entityName(source, liveGraph.schema.nameField)} and ${selectedCandidate.name}` : ""}</p></div><button className="origin-chart-button" onClick={() => setSelectedCandidateId("")}><X size={14} aria-hidden="true" /> Close details</button></div>
          {selectedCandidate && <div className="connection-panel">
            <details className="score-breakdown" open>
              <summary><span>Why this match?</span><strong>{percent(selectedCandidate.score)} overall</strong><ChevronDown size={14} aria-hidden="true" /></summary>
              <p className="score-breakdown-note">Contributions are percentage points of the overall score and add up to the score shown above.</p>
              <table className="score-breakdown-table" aria-label={`Score breakdown for ${selectedCandidate.name}`}>
                <thead><tr><th scope="col">Characteristic</th><th scope="col">Similarity</th><th scope="col">Contribution</th></tr></thead>
                <tbody>{scoreBreakdown.map((row) => <tr key={row.dimension.key}>
                  <th scope="row">{row.dimension.label}<small>Weight {row.weight.toFixed(1)}</small></th>
                  <td>{row.status === "comparable" && row.similarity !== null ? percent(row.similarity) : row.status === "excluded" ? "Excluded" : "No data"}</td>
                  <td>{row.contribution === null ? "-" : `${row.contribution.toFixed(1)} pts`}</td>
                </tr>)}</tbody>
              </table>
            </details>
            <div className="chart-head"><span className="micro-label">{sharedCharacteristicCount} Shared</span></div>
            <div className="shared-trait-list">
              {sharedCharacteristicGroups.map((group) => <details className="weight-group shared-characteristic-group" key={group.label} open>
                <summary><span>{group.label}</span><ChevronDown size={14} aria-hidden="true" /></summary>
                <dl className="shared-characteristic-values">
                  {group.characteristics.map((characteristic) => <div className="shared-characteristic" key={characteristic.key}>
                    <dt><span className="dimension-swatch" aria-hidden="true" />{characteristic.label}</dt>
                    <dd>{characteristic.values.length ? characteristic.values.map((value) => <p key={value}>{value}</p>) : `${characteristic.sharedCount} shared ${characteristic.sharedCount === 1 ? "category" : "categories"}`}</dd>
                  </div>)}
                </dl>
              </details>)}
              {sharedCharacteristicCount === 0 && <span className="no-shared">No shared characteristics.</span>}
            </div>
          </div>}
          <div className="link-chart-panel"><div className="chart-head"><span className="micro-label">Link chart</span></div><div className="chart-workspace"><div className="link-chart-host" ref={linkChartHost} />{!source && <div className="search-empty chart-empty chart-placeholder">No origin selected.</div>}{linkChartPending && <div className="chart-loading chart-placeholder" role="status"><LoaderCircle size={15} className="spin" /> Loading characteristics</div>}</div>{linkChartError && <p className="chart-error">{linkChartError}</p>}</div>
        </section>
      </div>

      {authMessage && <div className="toast-message toast-error" role="status"><span className="toast-indicator" />{authMessage}<button aria-label="Dismiss" onClick={() => setAuthMessage("")}><X size={14} /></button></div>}
      {showConfig && <ConnectionDialog onClose={() => setShowConfig(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showWeightsInfo && <WeightsInfoDialog onClose={() => setShowWeightsInfo(false)} />}
      
    </main>
  );
}

function HeaderBrand({ onAbout }: { onAbout: () => void }) {
  return <div className="header-brand">
    <Network size={52} className="header-brand-icon" aria-hidden="true" />
    <div className="header-title"><h1>COMMON GROUND</h1><span className="header-product">Place Similarity Explorer</span></div>
    <button className="icon-button help-button" aria-label="About this Application" title="About this Application" onClick={onAbout}><CircleHelp size={16} aria-hidden="true" /><span className="header-help-label">About</span></button>
  </div>;
}

function WeightsInfoDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialogRef.current?.showModal(); }, []);

  return (
    <dialog className="config-dialog weights-info-dialog" id="weights-info-dialog" ref={dialogRef} aria-labelledby="weights-info-title" onClose={onClose} onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dialogRef.current?.close();
    }} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialogRef.current?.close();
    }}>
      <button className="config-close" aria-label="Close weight information" onClick={() => dialogRef.current?.close()} autoFocus><X size={17} aria-hidden="true" /></button>
      <h2 id="weights-info-title">How Weights Affect Results</h2>
      <div className="weight-explanation-content">
        <dl>
          <div><dt>Relative Importance</dt><dd>Every characteristic has a default weight of 1. Increase a weight to give that characteristic more influence, decrease it to give it less influence, or set it to 0 to exclude it from the comparison.</dd></div>
          <div><dt>Characteristic Similarity</dt><dd>Each characteristic compares the categories assigned to both places, rather than their raw numeric values. Similarity is calculated using the Jaccard index: shared categories divided by all unique categories across both places. Identical categories score 100%, no shared categories score 0%, and partial overlap produces a score in between.</dd></div>
          <div><dt>Overall Similarity Score</dt><dd>Each characteristic's similarity score is multiplied by its weight. The weighted scores are added together and divided by the total weight of characteristics with data for both places. For example, if climate has a weight of 2 and income has a weight of 1, a 100% climate match and a 0% income match produce an overall score of 67%.</dd></div>
          <div><dt>Missing Data and Coverage</dt><dd>If either place is missing data for a characteristic, that characteristic is excluded from the score rather than counted as a mismatch. Coverage measures how much of the total active weight is represented by comparable data. For example, if 3 of 4 possible weight points are comparable, coverage is 75%. A high similarity score with low coverage means the match is based on fewer characteristics.</dd></div>
          <div><dt>Ranking Results</dt><dd>Run a comparison to apply your current weights and rank the five most similar places. Ties are resolved by higher coverage, then alphabetical order by place name. Weights are relative, so multiplying all active weights by the same amount does not change the scores. At least one characteristic must have a weight greater than 0 to run a comparison.</dd></div>
        </dl>
      </div>
    </dialog>
  );
}

function ConnectionDialog({ onClose }: { onClose: () => void }) {
  return <div className="config-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="config-dialog" role="dialog" aria-modal="true" aria-labelledby="config-title"><button className="config-close" aria-label="Close" onClick={onClose}><X size={17} /></button><h2 id="config-title">Connection requirements.</h2><p>OAuth and graph settings are loaded from the ignored local environment file; no client secret is used in this browser app.</p><ol className="config-steps"><li><span>01</span><p>Register a user-authentication OAuth application in Enterprise Portal.</p></li><li><span>02</span><p>Add this exact redirect URL to the app item: <code>{developmentRedirectUrl}</code></p></li><li><span>03</span><p>Restart Vite after updating <code>.env.local</code> with Portal, client ID, and graph service URL.</p></li></ol><div className="config-callout"><Info size={15} /><span>This development server uses HTTPS on localhost:5173 to match the redirect.</span></div><div className="config-actions"><button className="button-primary" onClick={onClose}>Close</button></div></section></div>;
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const pages: {
    title: string;
    description: string;
    sections: { title: string; text: string }[];
  }[] = [
    {
      title: "About Common Ground",
      description: "Identify similar places based on shared characteristics",
      sections: [
        { title: "Choose What Matters", text: "Weight characteristics to find your closest matches." },
        { title: "See Why Places Match", text: "Explore the top five results and their shared connections in the ArcGIS Knowledge Graph." },
      ],
    },
    {
      title: "How to Use Common Ground",
      description: "Select, compare, and explore",
      sections: [
        { title: "Select a Place", text: "Search by name or click a place on the map." },
        { title: "Adjust Weights", text: "Expand a category. Set 0 to ignore a characteristic, 1 for default influence, or 2 for double." },
        { title: "Run Comparison", text: "Run the query to see the five closest matches." },
        { title: "Explore Results", text: "Select a match to open its shared characteristics and link chart. Drag the divider to resize." },
      ],
    },
    {
      title: "Data & Methods",
      description: "Similarity is based on shared categories",
      sections: [
        { title: "Method", text: "Each characteristic is compared using Jaccard similarity: shared categories divided by all unique categories. Similarity scores are multiplied by their weights and averaged across characteristics with data for both places. Missing data are excluded; coverage shows how much active weight is represented. The five places rank by similarity, then coverage, then alphabetical order. Category computation methods are available from the information icon beside each characteristic in the left panel. Learn more at How Weights Affect Results." },
        { title: "Sources", text: "Census place boundaries, 2024 ACS 5-Year Estimates, Esri/USGS landforms, CEC climate zones, Natural Earth water features, National Transit Map routes, and IPEDS colleges." },
      ],
    },
  ];
  const currentPage = pages[pageIndex];
  const lastPage = pageIndex === pages.length - 1;

  useEffect(() => { dialogRef.current?.showModal(); }, []);
  useEffect(() => {
    headingRef.current?.focus();
    bodyRef.current?.scrollTo({ top: 0 });
  }, [pageIndex]);

  return (
    <dialog className={`config-dialog about-dialog${pageIndex === 1 ? " about-dialog-instructions" : ""}`} ref={dialogRef} aria-labelledby="about-title" aria-describedby="about-description" onClose={onClose} onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dialogRef.current?.close();
    }} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialogRef.current?.close();
    }}>
      <header className="about-header">
        <span className={`about-brand${pageIndex === 0 ? " about-brand-primary" : ""}`}><Network size={pageIndex === 0 ? 32 : 18} aria-hidden="true" /> COMMON GROUND</span>
        <button className="config-close" aria-label="Close About" onClick={() => dialogRef.current?.close()}><X size={18} aria-hidden="true" /></button>
        <h2 id="about-title" ref={headingRef} tabIndex={-1}>{currentPage.title}</h2>
        <p id="about-description">{currentPage.description}</p>
      </header>
      <div className="about-body" ref={bodyRef}>
        <ol className={`about-sections${pageIndex === 1 ? " about-instructions" : ""}${pageIndex === 2 ? " about-methods" : ""}`}>
          {currentPage.sections.map((section, index) => (
            <li key={section.title}>
              {pageIndex === 1 && <span className="about-step-number" aria-hidden="true">{index + 1}</span>}
              <div><h3>{section.title}</h3><p>{section.text}</p></div>
            </li>
          ))}
        </ol>
      </div>
      <footer className="about-footer">
        <button className="about-back" disabled={pageIndex === 0} onClick={() => setPageIndex((current) => current - 1)}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
        <span className="about-page-status" aria-live="polite">Page {pageIndex + 1} of {pages.length}</span>
        <button className="about-next" onClick={() => lastPage ? dialogRef.current?.close() : setPageIndex((current) => current + 1)}>{lastPage ? "Done" : "Next"}{lastPage ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}</button>
      </footer>
    </dialog>
  );
}

function SignInScreen({ state, message, onSignIn, onConfig, configOpen, onConfigClose }: { state: AuthState; message: string; onSignIn: () => void; onConfig: () => void; configOpen: boolean; onConfigClose: () => void }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const configRequired = state === "configuration-required";
  const busy = state === "checking" || state === "connecting";
  let portalName = "Not configured";
  let graphName = "Not configured";
  try { portalName = new URL(environmentConfig.portalUrl).hostname; } catch {}
  try { graphName = decodeURIComponent(new URL(environmentConfig.graphServiceUrl).pathname.split("/").filter(Boolean).at(-2) ?? "Knowledge Graph"); } catch {}

  return <main className="auth-shell">
    <header className="topbar"><HeaderBrand onAbout={() => setAboutOpen(true)} /><span className="sign-in-platform"><ShieldCheck size={18} aria-hidden="true" /><span>ArcGIS Enterprise</span></span></header>
    <div className="sign-in-main">
      <section className="sign-in-panel" aria-labelledby="sign-in-title">
        <ShieldCheck size={30} className="sign-in-symbol" aria-hidden="true" />
        <h2 id="sign-in-title">Sign In to Continue</h2>
        <p className="sign-in-description">Use your ArcGIS Enterprise account.</p>
        <dl className="sign-in-connection">
          <div><dt>Portal</dt><dd title={portalName}>{portalName}</dd></div>
          <div><dt><Database size={14} aria-hidden="true" /> Knowledge Graph</dt><dd title={graphName}>{graphName}</dd></div>
        </dl>
        {(message || configRequired) && <p className={`sign-in-notice${state === "error" || configRequired ? " is-error" : ""}`} role={state === "error" || configRequired ? "alert" : "status"}>{message || "Connection settings are required."}</p>}
        <button className="sign-in-primary" disabled={busy || configRequired} onClick={onSignIn}>
          {busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
          {busy ? state === "checking" ? "Checking Session" : "Connecting" : state === "error" ? "Try Again" : "Sign In to Enterprise"}
          {!busy && <ArrowUpRight size={17} aria-hidden="true" />}
        </button>
        <button className="sign-in-settings" onClick={onConfig}><Info size={15} aria-hidden="true" /> Connection Requirements</button>
      </section>
    </div>
    {configOpen && <ConnectionDialog onClose={onConfigClose} />}
    {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
  </main>;
}

export default App;
