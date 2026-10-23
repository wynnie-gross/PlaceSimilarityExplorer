import type { ConnectionConfig } from "./types";

export const environmentConfig: ConnectionConfig = {
  portalUrl: import.meta.env.VITE_PORTAL_URL?.trim() ?? "",
  clientId: import.meta.env.VITE_OAUTH_CLIENT_ID?.trim() ?? "",
  graphServiceUrl: import.meta.env.VITE_KNOWLEDGE_GRAPH_URL?.trim() ?? "",
  characteristicRelationshipNames: (import.meta.env.VITE_CHARACTERISTIC_RELATIONSHIPS ?? "")
    .split(",")
    .map((name: string) => name.trim())
    .filter(Boolean),
};

export const expectedPlaceType = import.meta.env.VITE_PLACE_TYPE?.trim() || "Place";
export const developmentRedirectUrl = "https://localhost:5173/";

export function configIsComplete(config: ConnectionConfig): boolean {
  return Boolean(config.portalUrl && config.clientId && config.graphServiceUrl);
}
