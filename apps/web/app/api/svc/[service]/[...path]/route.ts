/**
 * Browser → service proxy. The browser never sees CC_INTERNAL_SECRET: this handler
 * runs on the server, checks the path against an allowlist, and adds X-CC-Secret.
 */
import { NextResponse, type NextRequest } from "next/server";
import { BROWSER_ALLOWED, CHECKOUT_PATH, CHECKOUT_PHRASE, serviceBaseUrl, type ServiceName } from "@/lib/services";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ service: string; path: string[] }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

async function proxy(req: NextRequest, { params }: Params, method: "GET" | "POST") {
  const { service, path } = await params;
  if (!(service in BROWSER_ALLOWED)) return err(404, "UNKNOWN_SERVICE", `No service named "${service}".`);
  const svc = service as ServiceName;
  const subpath = "/" + path.map(encodeURIComponent).join("/");
  if (!BROWSER_ALLOWED[svc][method].some((re) => re.test(subpath)))
    return err(403, "PATH_NOT_ALLOWED", `${method} ${svc}${subpath} isn't exposed to the browser.`);

  let reqBody = method === "POST" ? await req.text() : undefined;
  if (svc === "delivery" && CHECKOUT_PATH.test(subpath)) {
    const b = (() => { try { return JSON.parse(reqBody ?? ""); } catch { return undefined; } })();
    if (b?.confirmPhrase !== CHECKOUT_PHRASE)
      return err(403, "CONFIRMATION_REQUIRED", `A real order needs the typed phrase "${CHECKOUT_PHRASE}".`);
    if (typeof b.confirmedBy !== "string" || !b.confirmedBy.trim())
      return err(400, "CONFIRMATION_REQUIRED", "Type the name of the person approving this order.");
    reqBody = JSON.stringify({ confirmedBy: b.confirmedBy.trim() });
  }

  const url = `${serviceBaseUrl(svc)}${subpath}${req.nextUrl.search}`;
  try {
    const upstream = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "x-cc-secret": process.env.CC_INTERNAL_SECRET ?? "" },
      body: reqBody,
      cache: "no-store",
      // Voice demo turns can wait on a live DoorDash grocery quote.
      signal: AbortSignal.timeout(svc === "voice" && subpath.startsWith("/demo/converse") ? 240_000 : 15_000),
    });
    const body = await upstream.text();
    return new NextResponse(body || null, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return err(502, "UPSTREAM_UNREACHABLE", `${svc} isn't answering at ${serviceBaseUrl(svc)} (${(e as Error).name}).`);
  }
}

export const GET = (req: NextRequest, ctx: Params) => proxy(req, ctx, "GET");
export const POST = (req: NextRequest, ctx: Params) => proxy(req, ctx, "POST");
