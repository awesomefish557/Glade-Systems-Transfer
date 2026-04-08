export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Seer-Admin"
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

export function corsJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function corsCsv(
  body: string,
  status = 200,
  extra?: Record<string, string>
): Response {
  return new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="seer-tax-export.csv"',
      ...extra
    }
  });
}
