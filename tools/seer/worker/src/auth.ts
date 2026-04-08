// Same pattern as Glade Core `routes/auth.ts`: optional bearer when `API_BEARER_TOKEN` is set.
export function checkBearerAuth(
  request: Request,
  env: { API_BEARER_TOKEN?: string }
):
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
    } {
  const header = request.headers.get("Authorization");
  if (!header) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "Missing or invalid bearer token"
    };
  }
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "Missing or invalid bearer token"
    };
  }
  const token = match[1];
  if (!env.API_BEARER_TOKEN || token !== env.API_BEARER_TOKEN) {
    return {
      ok: false,
      status: 403,
      error: "unauthorized",
      message: "Missing or invalid bearer token"
    };
  }
  return { ok: true };
}

/** When token is configured, require valid Bearer; otherwise allow. */
export function authRequired(env: { API_BEARER_TOKEN?: string }): boolean {
  return Boolean(env.API_BEARER_TOKEN?.length);
}
