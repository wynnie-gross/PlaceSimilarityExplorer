import OAuthInfo from "@arcgis/core/identity/OAuthInfo.js";
import IdentityManager from "@arcgis/core/identity/IdentityManager.js";
import esriConfig from "@arcgis/core/config.js";
import type Credential from "@arcgis/core/identity/Credential.js";
import type { ConnectionConfig } from "../types";

let registeredConfigKey = "";
let credentialRequest: Promise<Credential> | undefined;

export function configureOAuth(config: ConnectionConfig): void {
  const key = `${config.portalUrl}|${config.clientId}`;
  esriConfig.portalUrl = config.portalUrl;

  if (registeredConfigKey === key) return;

  IdentityManager.registerOAuthInfos([
    new OAuthInfo({
      appId: config.clientId,
      portalUrl: config.portalUrl,
      flowType: "authorization-code",
      popup: false,
    }),
  ]);
  registeredConfigKey = key;
}

export function checkSignIn(serviceUrl: string): Promise<Credential> {
  return IdentityManager.checkSignInStatus(serviceUrl);
}

export function requestCredential(serviceUrl: string): Promise<Credential> {
  if (!credentialRequest) {
    credentialRequest = IdentityManager.getCredential(serviceUrl).finally(() => {
      credentialRequest = undefined;
    });
  }
  return credentialRequest;
}

export function signOut(): void {
  IdentityManager.destroyCredentials();
  credentialRequest = undefined;
}
