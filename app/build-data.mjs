// Builds app/data.json for the ChatGPT app from VSD's third-party-tested database.
// Policy: Amazon prices, price-derived numbers and ASINs never leave verifiedsupplementdata.com, so they are
// dropped here. Cost per dose survives only as a RANK within a category (1 = cheapest per effective dose).
//   node app/build-data.mjs <path-to-supplements-repo>/data/tested-index.json
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://verifiedsupplementdata.com';
const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fix = (s) => (s || '').replace(/Â®/g, '®').replace(/Â/g, '');

const byCat = {};
for (const p of src.products) (byCat[p.category] ||= []).push(p);
const rank = {};
for (const rows of Object.values(byCat)) {
  rows.filter((r) => r.availability === 'ok' && r.costPerDay > 0)
    .sort((a, b) => a.costPerDay - b.costPerDay)
    .forEach((r, i, arr) => { rank[r.slug] = { rank: i + 1, of: arr.length }; });
}

const products = src.products.map((p) => ({
  slug: p.slug,
  name: fix(p.name),
  brand: p.brand,
  category: p.category,
  status: p.status, // PRODUCT_CERTIFIED | BRAND_ONLY | BRAND_ABSENT
  program: p.program, // NSF | USP | Informed | IFOS | null
  registry: p.registry,
  brand_registries: p.brandRegistries,
  coa: p.coa ? { lab: p.coa.lab, lot_specific: !!p.coa.lotSpecific, url: p.coa.url } : null,
  dose: p.mgPerServing ? `${p.mgPerServing} ${p.unit} per serving` : null,
  cost_rank: rank[p.slug] || null,
  on_sale_at_amazon: p.availability === 'ok',
  page: SITE + (p.testedHref || p.hubHref || `/supplements/${p.category}/`),
}));

const out = {
  generated_at: src.generatedAt,
  registry_as_of: src.registryAsOf,
  method: 'Each product was checked against the public NSF, USP and Informed Sport registries. Ranks are by cost per effective daily dose at current Amazon prices; see the linked page for prices.',
  totals: src.totals,
  programs: src.programs.map(({ key, label, listings, orgs, asOf, url }) => ({ key, label, listings, orgs, as_of: asOf, url })),
  categories: src.categories,
  brands: src.brands,
  products,
};
const banned = JSON.stringify(out).match(/"(price|costPerDay|asin|amazon_asin)"|amazon\.com\/(dp|gp|s\?)/);
if (banned) throw new Error('price/ASIN/Amazon link leaked into app data: ' + banned[0]);
writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(out));
console.log(`app/data.json: ${products.length} products, ${src.categories.length} categories, registries as of ${src.registryAsOf}`);
