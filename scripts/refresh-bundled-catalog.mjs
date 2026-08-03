// Regenerates data/products.json — the OFFLINE fallback catalog shipped in the
// npm package — from the live site catalog.
//
//   node scripts/refresh-bundled-catalog.mjs [path-to-site-products.json]
//
// The server prefers the live feed at runtime (src/catalog.ts); this snapshot only
// serves hosts that cannot reach the network. It still has to be current, because
// the previous snapshot silently aged 4.5 months and there was no step that would
// ever have refreshed it. Run this before publishing.
//
// Keeps availability + fallbackSlug so the offline path can run the same
// dead-ASIN guard the site does.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = process.argv[2] || resolve(ROOT, "..", "supplements", "data", "products.json");

const raw = JSON.parse(readFileSync(SRC, "utf-8"));
const cats = raw.categories || {};

const KEEP = [
  "slug", "name", "brand", "mgPerServing", "unit", "servingSize", "servingsPerContainer",
  "price", "costPerDay", "certification", "pick", "amazonAsin",
  "availability", "fallbackSlug", "priceVerifiedOn",
];

const out = {};
let count = 0;
let newest = null;
const slugs = new Set();
const dupes = [];
for (const [cat, items] of Object.entries(cats)) {
  out[cat] = items.map((p) => {
    if (slugs.has(p.slug)) dupes.push(p.slug);
    slugs.add(p.slug);
    if (p.priceVerifiedOn && (!newest || p.priceVerifiedOn > newest)) newest = p.priceVerifiedOn;
    count++;
    const o = {};
    for (const k of KEEP) if (p[k] !== undefined) o[k] = p[k];
    return o;
  });
}

// Same invariants the site gate enforces — a snapshot that violates them would
// reintroduce exactly the bugs this work fixed.
const problems = [];
if (dupes.length) problems.push(`duplicate slugs: ${dupes.join(", ")}`);
if (count < 500) problems.push(`only ${count} products — expected ~730`);
for (const items of Object.values(out))
  for (const p of items) {
    if (p.availability && p.availability !== "ok" && !p.fallbackSlug && p.amazonAsin)
      problems.push(`${p.slug}: unavailable with no fallback (offline path will send buyers to search)`);
  }
if (problems.length) {
  console.error("REFRESH WARNINGS:");
  for (const p of problems.slice(0, 10)) console.error("  " + p);
}

const payload = {
  generatedFrom: "https://verifiedsupplementdata.com",
  pricesAsOf: newest,
  note: "Offline fallback only. The server fetches the live feed first; see src/catalog.ts.",
  count,
  categories: out,
};

mkdirSync(resolve(ROOT, "data"), { recursive: true });
writeFileSync(resolve(ROOT, "data", "products.json"), JSON.stringify(payload, null, 1), "utf-8");
console.log(`wrote data/products.json — ${count} products, ${Object.keys(out).length} categories, prices as of ${newest}`);
