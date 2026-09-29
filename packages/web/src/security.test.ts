import { describe, it, expect } from "bun:test";
import { extraAllowedHosts, isAllowedHost, refuseRequest } from "./security.js";

function request(method: string, headers: Record<string, string>): Request {
  // Request forbids setting Host through its constructor in browsers, not in Bun.
  return new Request("http://localhost:3000/api/tasks", { method, headers });
}

describe("isAllowedHost", () => {
  it("accepts localhost, *.localhost and IP addresses, with or without a port", () => {
    for (const host of ["localhost", "localhost:3000", "app.localhost:3000", "127.0.0.1:3000", "[::1]:3000", "192.168.1.20:3000"]) {
      expect(isAllowedHost(host, [])).toBe(true);
    }
  });

  it("refuses other names (a DNS-rebinding page sends its own), a missing Host and garbage", () => {
    for (const host of ["evil.example", "evil.example:3000", "localhost.evil.example", "127.0.0.1.nip.io", "", null, "a b"]) {
      expect(isAllowedHost(host, [])).toBe(false);
    }
  });

  it("accepts the names AGENTQ_ALLOWED_HOSTS lists and AGENTQ_HOST when it is a name", () => {
    const extra = extraAllowedHosts({ AGENTQ_ALLOWED_HOSTS: " My-Mac.local , agentq.lan,", AGENTQ_HOST: "devbox" });
    expect(extra).toEqual(["my-mac.local", "agentq.lan", "devbox"]);
    expect(isAllowedHost("my-mac.local:3000", extra)).toBe(true);
    expect(isAllowedHost("DEVBOX:3000", extra)).toBe(true);
    expect(isAllowedHost("other.lan:3000", extra)).toBe(false);
    expect(extraAllowedHosts({ AGENTQ_HOST: "0.0.0.0" })).toEqual([]);
  });
});

describe("refuseRequest", () => {
  const json = { "Content-Type": "application/json", Host: "localhost:3000" };

  it("lets reads through without an Origin or Content-Type check", () => {
    expect(refuseRequest(request("GET", { Host: "localhost:3000", Origin: "http://evil.example" }))).toBeNull();
  });

  it("refuses any request to a Host that is not allowed", () => {
    expect(refuseRequest(request("GET", { Host: "evil.example:3000" }))?.status).toBe(403);
  });

  it("refuses a state-changing request from another origin, or from an opaque one", () => {
    for (const origin of ["http://evil.example", "http://localhost:5173", "https://localhost:3001", "null"]) {
      expect(refuseRequest(request("POST", { ...json, Origin: origin }))).toMatchObject({ status: 403 });
    }
    expect(refuseRequest(request("DELETE", { Host: "localhost:3000", Origin: "http://evil.example" }))?.status).toBe(403);
  });

  it("accepts the server's own origin and clients that send none (curl, scripts)", () => {
    expect(refuseRequest(request("POST", { ...json, Origin: "http://localhost:3000" }))).toBeNull();
    expect(refuseRequest(request("PUT", json))).toBeNull();
    expect(refuseRequest(request("DELETE", { Host: "localhost:3000" }))).toBeNull();
  });

  it("refuses a body-carrying request that is not JSON: a page can send those cross-origin without a preflight", () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      expect(refuseRequest(request("POST", { Host: "localhost:3000", "Content-Type": type }))).toMatchObject({ status: 415 });
    }
    expect(refuseRequest(request("POST", { Host: "localhost:3000" }))?.status).toBe(415);
    expect(refuseRequest(request("POST", { Host: "localhost:3000", "Content-Type": "Application/JSON; charset=utf-8" }))).toBeNull();
  });
});
