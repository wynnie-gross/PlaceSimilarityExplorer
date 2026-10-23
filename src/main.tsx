import "@arcgis/core/assets/esri/themes/light/main.css";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-link-chart";
import "@arcgis/map-components/components/arcgis-link-chart-layout-switcher";
import "@arcgis/map-components/components/arcgis-feature";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/map-components/components/arcgis-scale-bar";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./styles.css";
import "./auth.css";
import "./theme.css";

import React from "react";
import { createRoot } from "react-dom/client";
import esriConfig from "@arcgis/core/config.js";
import { environmentConfig } from "./config";
import App from "./App";

if (environmentConfig.portalUrl) {
  esriConfig.portalUrl = environmentConfig.portalUrl;
}

const apiKey = import.meta.env.VITE_ARCGIS_API_KEY?.trim();
if (apiKey) {
  esriConfig.apiKey = apiKey;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
