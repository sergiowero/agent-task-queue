import { isIP } from "net";

/**
 * The HTTP API has no login: whoever reaches it can approve code, answer
 * blockers and create runners. So it only serves the local user. The server
 * listens on loopback (AGENTQ_HOST), and requests a web page could forge are
 * refused before any route runs:
 * - a Host that is not localhost, an IP address or listed in AGENTQ_ALLOWED_HOSTS
 *   (a DNS-rebinding page names its own domain) → 403, on every request;
 * - a state-changing request whose Origin is not the server's own → 403;
 * - a POST/PUT/PATCH that is not `application/json` (text and form bodies are
 *   what a page can send cross-origin without a CORS preflight) → 415.
 * Clients without a browser (curl, scripts, tests) send no Origin and pass.
 */

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

export interface RequestRefusal {
  status: 403 | 415;
  error: string;
}

/** Host names accepted besides localhost and IP addresses: AGENTQ_ALLOWED_HOSTS, plus AGENTQ_HOST when it is a name. */
export function extraAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = (env.AGENTQ_ALLOWED_HOSTS ?? "").split(",");
  if (env.AGENTQ_HOST && !isIP(env.AGENTQ_HOST)) names.push(env.AGENTQ_HOST);
  return names.map((n) => n.trim().toLowerCase()).filter(Boolean);
}

/** Whether a Host header names this machine: localhost, an IP address, or an allowed name. */
export function isAllowedHost(host: string | null, extra: string[] = extraAllowedHosts()): boolean {
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (isIP(hostname.replace(/^\[(.*)\]$/, "$1"))) return true;
  return extra.includes(hostname);
}

/** Why a request is refused, or null when it may go on to its route. */
export function refuseRequest(req: Request): RequestRefusal | null {
  const host = req.headers.get("host");
  if (!isAllowedHost(host)) {
    return {
      status: 403,
      error: `Host ${host ?? "(none)"} is not allowed: add it to AGENTQ_ALLOWED_HOSTS to reach AgentQ by that name`,
    };
  }
  if (!STATE_CHANGING.has(req.method)) return null;

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {}
    if (originHost !== host!.toLowerCase()) {
      return { status: 403, error: `Cross-origin request refused (Origin ${origin})` };
    }
  }

  if (WITH_BODY.has(req.method)) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return { status: 415, error: "Content-Type must be application/json" };
    }
  }
  return null;
}
