/**
 * Browser → service proxy. The browser never sees CC_INTERNAL_SECRET: this handler
 * runs on the server, checks the path against an allowlist, and adds X-CC-Secret.
 */
import { NextResponse, type NextRequest } from "next/server";
import { BROWSER_ALLOWED, serviceBaseUrl, type ServiceName } from "@/lib/services";

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

  const url = `${serviceBaseUrl(svc)}${subpath}${req.nextUrl.search}`;
  try {
    const upstream = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "x-cc-secret": process.env.CC_INTERNAL_SECRET ?? "" },
      body: method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
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
