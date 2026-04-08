import type { Env } from "../db";

/**
 * Smarkets Trading API OAuth2 helpers (place orders in a follow-up sprint).
 *
 * Set secrets: SMARKETS_CLIENT_ID, SMARKETS_CLIENT_SECRET, SMARKETS_REDIRECT_URI.
 * Optional overrides if Smarkets changes host paths: SMARKETS_OAUTH_AUTHORIZE_URL,
 * SMARKETS_OAUTH_TOKEN_URL.
 *
 * Wire `GET /api/smarkets/oauth/start` → redirect to buildSmarketsAuthorizeUrl(state)
 * and `GET /api/smarkets/oauth/callback?code=&state=` → exchangeSmarketsOAuthCode.
 */

const DEFAULT_AUTHORIZE =
  "https://api.smarkets.com/v3/oauth2/authorize/";
const DEFAULT_TOKEN = "https://api.smarkets.com/v3/oauth2/token/";

function authorizeBase(env: Env): string {
  return (env.SMARKETS_OAUTH_AUTHORIZE_URL?.trim() || DEFAULT_AUTHORIZE).replace(
    /\/?$/,
    "/"
  );
}

function tokenUrl(env: Env): string {
  return (env.SMARKETS_OAUTH_TOKEN_URL?.trim() || DEFAULT_TOKEN).replace(/\/?$/, "");
}

export function buildSmarketsAuthorizeUrl(env: Env, state: string): string | null {
  const clientId = env.SMARKETS_CLIENT_ID?.trim();
  const redirect = env.SMARKETS_REDIRECT_URI?.trim();
  if (!clientId || !redirect) return null;

  const u = new URL(authorizeBase(env));
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

export type SmarketsTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

export async function exchangeSmarketsOAuthCode(
  env: Env,
  code: string
): Promise<{ ok: true; tokens: SmarketsTokenResponse } | { ok: false; error: string }> {
  const clientId = env.SMARKETS_CLIENT_ID?.trim();
  const secret = env.SMARKETS_CLIENT_SECRET?.trim();
  const redirect = env.SMARKETS_REDIRECT_URI?.trim();
  if (!clientId || !secret || !redirect) {
    return { ok: false, error: "missing_smarkets_oauth_env" };
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", clientId);
  body.set("client_secret", secret);
  body.set("redirect_uri", redirect);
  body.set("code", code);

  const res = await fetch(tokenUrl(env), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, error: "invalid_token_response" };
  }

  if (!res.ok) {
    const msg =
      json &&
      typeof json === "object" &&
      json !== null &&
      "error" in json &&
      typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : text.slice(0, 200);
    return { ok: false, error: msg };
  }

  const tokens = json as SmarketsTokenResponse;
  if (!tokens?.access_token) {
    return { ok: false, error: "no_access_token" };
  }
  return { ok: true, tokens };
}
