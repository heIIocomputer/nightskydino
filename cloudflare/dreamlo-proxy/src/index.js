const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
};

function withCors(headers = {}) {
  const result = new Headers(headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    result.set(key, value);
  }
  result.set("Vary", "Origin");
  return result;
}

function sanitizeName(name) {
  return String(name ?? "")
    .replace(/\*/g, "_")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 16);
}

function clampLimit(value) {
  const parsed = Number.parseInt(String(value ?? "10"), 10);
  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.min(10, Math.max(1, parsed));
}

async function proxyDreamlo(path) {
  // Dreamlo rejects HTTPS for this leaderboard, so the Worker fetches HTTP
  // upstream server-side and republishes the result over HTTPS.
  const response = await fetch(`http://dreamlo.com${path}`, {
    method: "GET",
    headers: {
      Accept: "text/plain, application/json;q=0.9, */*;q=0.8",
      "User-Agent": "nightskydino-dreamlo-proxy/1.0",
    },
  });

  const body = await response.text();
  const headers = withCors({
    "Content-Type": response.headers.get("Content-Type") || "text/plain; charset=utf-8",
  });

  return new Response(body, {
    status: response.status,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCors(),
      });
    }

    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: withCors(),
      });
    }

    if (url.pathname === "/health") {
      return new Response("ok", {
        headers: withCors(),
      });
    }

    if (url.pathname === "/leaderboard") {
      const limit = clampLimit(url.searchParams.get("limit"));
      return proxyDreamlo(`/${env.DREAMLO_PUBLIC_CODE}/json/0/${limit}`);
    }

    if (url.pathname === "/submit") {
      const name = sanitizeName(url.searchParams.get("name"));
      const score = Math.max(0, Math.floor(Number(url.searchParams.get("score") ?? 0)));

      if (!name) {
        return new Response("Missing name", {
          status: 400,
          headers: withCors(),
        });
      }

      return proxyDreamlo(`/${env.DREAMLO_PRIVATE_CODE}/add/${encodeURIComponent(name)}/${score}`);
    }

    return new Response("Not Found", {
      status: 404,
      headers: withCors(),
    });
  },
};
