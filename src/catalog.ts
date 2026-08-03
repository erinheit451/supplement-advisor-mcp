// Catalog loading: LIVE first, bundled snapshot only as a fallback.
//
// The bundled data/products.json used to be the only source, and it drifted to
// 4.5 months stale (85 products at March prices, no verification dates) while the
// site tracked 730 products with weekly price refreshes. An agent quoting those
// prices to a human is quoting fiction, and there was no mechanism that would ever
// have corrected it.
//
// So: fetch the site's ACP feed at startup. That feed is generated from the same
// catalog the site renders from, and its buy urls are already resolved through the
// dead-ASIN guard — so this server inherits price freshness AND link correctness
// automatically, instead of re-implementing both and drifting again.
//
// If the fetch fails (offline, site down, sandboxed host), fall back to the bundled
// snapshot and apply the guard locally. Either path is honest about which it used.

import { readFileSync } from "fs";
import { resolve } from "path";
import { resolveBuy, type CatalogProduct } from "./buyLink.js";

const FEED_URL = "https://verifiedsupplementdata.com/api/v1/feed/acp.jsonl";
const FETCH_TIMEOUT_MS = 6000;

export interface Product {
  slug: string;
  name: string;
  brand: string;
  dosePerServing: string;
  servingSize: string;
  servingsPerContainer: number | null;
  price: number;
  costPerDay: number;
  certification: string;
  pick: string | null;
  buyUrl: string;
  cartUrl: string | null;
  substituteFor: string | null;
  clinicalDose: string | null;
  formVerdict: string | null;
  sourcePage: string | null;
}

export interface Catalog {
  categories: Record<string, Product[]>;
  source: "live" | "bundled";
  productCount: number;
  /** ISO date the prices were last verified, when known. */
  pricesAsOf: string | null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

async function loadLive(): Promise<Catalog | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(FEED_URL, {
      signal: ctl.signal,
      headers: { "User-Agent": "supplement-advisor-mcp" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const categories: Record<string, Product[]> = {};
    let count = 0;
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      const a = o.custom_attributes || {};
      const cat = a.supplement_category;
      if (!cat) continue;
      // The feed carries the slug in the affiliate subtag it stamps
      // (…&ascsubtag=<slug>__acp), which is how orders are attributed.
      const subtag = /[?&]ascsubtag=([^&]+?)__[a-z]+/.exec(o.url || "");
      (categories[cat] ||= []).push({
        slug: subtag ? decodeURIComponent(subtag[1]) : String(a.slug || o.title),
        name: o.title,
        brand: o.brand,
        dosePerServing: a.elemental_dose_per_serving ?? "",
        servingSize: a.serving_size ?? "",
        servingsPerContainer: a.servings_per_container ?? null,
        price: num(o.price?.amount),
        costPerDay: num(a.cost_per_clinical_dose_usd),
        certification: a.certification || "None",
        pick: a.editorial_pick ?? null,
        // Already resolved through the site's dead-ASIN guard and affiliate-tagged.
        buyUrl: o.url,
        cartUrl: null,
        substituteFor: a.substituted_for_unavailable ?? null,
        clinicalDose: a.clinical_dose ?? null,
        formVerdict: a.form_verdict ?? null,
        sourcePage: a.source_page ?? null,
      });
      count++;
    }
    if (!count) return null;
    return { categories, source: "live", productCount: count, pricesAsOf: null };
  } catch {
    return null;
  }
}

function loadBundled(dataDir: string): Catalog {
  const raw = JSON.parse(readFileSync(resolve(dataDir, "products.json"), "utf-8"));
  const cats = raw.categories || {};
  const bySlug = new Map<string, CatalogProduct>();
  for (const items of Object.values(cats) as CatalogProduct[][])
    for (const p of items) bySlug.set(p.slug, p);

  const categories: Record<string, Product[]> = {};
  let count = 0;
  let newest: string | null = null;
  for (const [cat, items] of Object.entries(cats) as [string, any[]][]) {
    categories[cat] = items.map((p) => {
      const buy = resolveBuy(p, bySlug);
      if (p.priceVerifiedOn && (!newest || p.priceVerifiedOn > newest)) newest = p.priceVerifiedOn;
      count++;
      return {
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        dosePerServing: `${p.mgPerServing}${p.unit ? " " + p.unit : " mg"}`,
        servingSize: p.servingSize,
        servingsPerContainer: p.servingsPerContainer ?? null,
        price: num(p.price),
        costPerDay: num(p.costPerDay),
        certification: p.certification || "None",
        pick: p.pick ?? null,
        buyUrl: buy.url,
        cartUrl: buy.cartUrl,
        substituteFor: buy.usedFallback ? p.name : null,
        clinicalDose: null,
        formVerdict: null,
        sourcePage: null,
      };
    });
  }
  return { categories, source: "bundled", productCount: count, pricesAsOf: raw.pricesAsOf ?? newest };
}

export async function loadCatalog(dataDir: string): Promise<Catalog> {
  return (await loadLive()) ?? loadBundled(dataDir);
}
