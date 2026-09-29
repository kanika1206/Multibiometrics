// CORS policy: only configured browser origins may reach the API.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { parseOrigins, allowedOrigins, corsPolicy, DEV_ORIGINS } from "../corsPolicy.js";

const APP = "https://app.example.com";
const EVIL = "https://phish.example.net";

test("parseOrigins accepts exact origins, strips a trailing slash, de-duplicates", () => {
  assert.deepEqual(parseOrigins(` ${APP}/ , http://localhost:3999,${APP}`),
    [APP, "http://localhost:3999"]);
});

test("parseOrigins rejects paths, wildcards and non-URLs", () => {
  for (const bad of ["*", "https://*.example.com", `${APP}/login`, "app.example.com", "null"]) {
    assert.throws(() => parseOrigins(bad), /not an origin/, bad);
  }
});

test("allowedOrigins: explicit list wins; dev defaults to local servers; production to none", () => {
  assert.deepEqual(allowedOrigins({ CORS_ORIGINS: APP }, true), [APP]);
  assert.deepEqual(allowedOrigins({}, false), [...DEV_ORIGINS]);
  assert.deepEqual(allowedOrigins({}, true), []);
  assert.deepEqual(allowedOrigins({ CORS_ORIGINS: "  " }, true), []);
});

async function withServer(origins, fn) {
  let hits = 0;
  const app = express();
  app.use(corsPolicy(origins));
  app.get("/captcha", (req, res) => { hits++; res.json({ svg: "<svg/>" }); });
  app.post("/upload-video-login", (req, res) => { hits++; res.send("ok"); });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, () => hits);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("allowed origin gets the response and a matching CORS header", async () => {
  await withServer([APP], async (base) => {
    const r = await fetch(`${base}/captcha`, { headers: { Origin: APP } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), APP);
  });
});

test("foreign origin is refused with 403 and no CORS header", async () => {
  await withServer([APP], async (base) => {
    const r = await fetch(`${base}/captcha`, { headers: { Origin: EVIL } });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  });
});

test("foreign multipart POST (a simple request, never preflighted) never reaches the handler",
  async () => {
    await withServer([APP], async (base, hits) => {
      const body = new FormData();
      body.append("video", new Blob(["x"]), "victim_l.mp4");
      const r = await fetch(`${base}/upload-video-login`, {
        method: "POST", body, headers: { Origin: EVIL } });
      assert.equal(r.status, 403);
      assert.equal(hits(), 0);
    });
  });

test("preflight: allowed origin is answered, foreign origin refused", async () => {
  await withServer([APP], async (base) => {
    const pre = (origin) => fetch(`${base}/upload-video-login`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "authorization,content-type" } });
    const ok = await pre(APP);
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), APP);
    assert.equal((await pre(EVIL)).status, 403);
  });
});

test("no Origin header (curl, same-origin GET) is unaffected and gets no CORS header",
  async () => {
    await withServer([APP], async (base) => {
      const r = await fetch(`${base}/captcha`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("access-control-allow-origin"), null);
    });
  });

test("empty allow-list (production, unset) refuses every browser origin", async () => {
  await withServer([], async (base) => {
    assert.equal((await fetch(`${base}/captcha`, { headers: { Origin: APP } })).status, 403);
  });
});
