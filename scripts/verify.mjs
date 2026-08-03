// Verification for the MCP server's two failure modes: stale prices and dead links.
// Run after `npm run build`:  node scripts/verify.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolveBuy } from "../dist/buyLink.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const fails = [];
const ok = [];

// ---- offline path: bundled snapshot ----
const raw = JSON.parse(readFileSync(resolve(ROOT, "data/products.json"), "utf-8"));
const bySlug = new Map();
for (const items of Object.values(raw.categories)) for (const p of items) bySlug.set(p.slug, p);

const count = [...bySlug.values()].length;
count >= 700 ? ok.push(`bundled catalog: ${count} products`) : fails.push(`bundled catalog only ${count}`);
raw.pricesAsOf >= "2026-07-01"
  ? ok.push(`bundled prices as of ${raw.pricesAsOf}`)
  : fails.push(`bundled prices stale: ${raw.pricesAsOf}`);

let dead = 0, repointed = 0, searchFallback = 0, untagged = 0;
const deadAsins = new Set([...bySlug.values()].filter((p) => p.availability && p.availability !== "ok" && p.amazonAsin).map((p) => p.amazonAsin));
for (const p of bySlug.values()) {
  const b = resolveBuy(p, bySlug);
  if (!b.url.includes("tag=verifiedsupp2-20")) untagged++;
  const m = /\/dp\/([A-Z0-9]{10})/.exec(b.url);
  if (m && deadAsins.has(m[1])) dead++;
  if (b.usedFallback) repointed++;
  if (b.isSearch ?? !m) searchFallback++;
}
untagged === 0 ? ok.push("offline path: all buy urls affiliate-tagged") : fails.push(`${untagged} untagged urls offline`);
dead === 0 ? ok.push("offline path: 0 links to known-dead ASINs") : fails.push(`${dead} dead-ASIN links offline`);
ok.push(`offline path: ${repointed} repointed to verified alternatives`);

// ---- live path + tool behaviour, over real stdio ----
const rpc = (msgs, ms = 12000) =>
  new Promise((res) => {
    const p = spawn("node", [resolve(ROOT, "dist/index.js")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "v", version: "1" } } }) + "\n");
    setTimeout(() => {
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      for (const m of msgs) p.stdin.write(JSON.stringify(m) + "\n");
    }, 800);
    setTimeout(() => {
      p.kill();
      const results = {};
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id > 1) results[m.id] = m.result?.content?.[0]?.text ?? JSON.stringify(m); } catch {}
      }
      res({ results, err });
    }, ms);
  });

const calls = [
  ["probiotics", 2], ["ashwagandha", 3], ["electrolytes", 4], ["tongkat-ali", 5], ["magnesium", 6],
].map(([s, id]) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "recommend_supplement", arguments: { supplement: s } } }));

const { results, err } = await rpc(calls);
err.includes("from live") ? ok.push("startup: fetched LIVE catalog") : fails.push(`startup did not use live catalog: ${err.trim().slice(0, 120)}`);

for (const [name, id] of [["probiotics", 2], ["ashwagandha", 3], ["electrolytes", 4], ["tongkat-ali", 5], ["magnesium", 6]]) {
  const t = results[id] || "";
  if (!t) { fails.push(`${name}: no response`); continue; }
  if (/No catalog entry|Unknown supplement/.test(t)) fails.push(`${name}: NOT RESOLVED (this was the enum/map drift bug)`);
  else if (!/verifiedsupplementdata\.com\/go\//.test(t)) fails.push(`${name}: no buy links in response`);
  else ok.push(`${name}: resolved with buy links`);
}
const mg = results[6] || "";
/Prices and availability fetched live/.test(mg) ? ok.push("responses carry price provenance") : fails.push("no price provenance in response");

console.log(ok.map((s) => "  PASS  " + s).join("\n"));
if (fails.length) {
  console.error("\nFAILURES:");
  for (const f of fails) console.error("  FAIL  " + f);
  process.exit(1);
}
console.log("\nAll checks passed.");
