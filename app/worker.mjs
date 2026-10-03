// Verified Supplement Data - ChatGPT app (MCP over Streamable HTTP, stateless JSON responses).
// Read-only lookups over VSD's third-party-tested database. Every result links to a VSD page; no Amazon links,
// prices or ASINs are ever returned (Amazon Associates: links and prices only on our own Site).
import data from './data.json' with { type: 'json' };

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const STATUS = {
  PRODUCT_CERTIFIED: 'This exact product is listed by a certifier',
  BRAND_ONLY: 'Brand is listed, but this exact product was not found in the NSF, USP or Informed Sport listings we checked',
  BRAND_ABSENT: 'Not found in the NSF, USP or Informed Sport listings we checked (other programs, such as Informed Choice, may still cover it)',
};
const SYN = [[/\bbisglycinate\b/g, 'glycinate'], [/\bfish oil\b/g, 'omega 3'], [/\bvit(amin)? ?d3?\b/g, 'vitamin d3'], [/\bb ?12\b/g, 'vitamin b12'],
  [/\bcoq ?10\b/g, 'coq10'], [/\bwhey\b/g, 'protein'], [/\bnsf certified for sport\b/g, '']];
const norm = (s) => SYN.reduce((t, [a, b]) => t.replace(a, b), (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ')).replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter((w) => w.length > 1);

function match(query, rows, key = (r) => `${r.brand} ${r.name} ${r.category}`) {
  const q = words(query);
  if (!q.length) return [];
  return rows
    .map((r) => { const h = norm(key(r)); const hits = q.filter((w) => h.includes(w)).length; return { r, s: hits / q.length + (hits === q.length ? 0.5 : 0) + (h.startsWith(q[0]) ? 0.1 : 0) }; })
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}

const row = (p) => ({
  product: p.name, brand: p.brand, category: p.category,
  verification: STATUS[p.status], program: p.program, registry: p.registry,
  certificate_of_analysis: p.coa ? `${p.coa.lot_specific ? 'Lot-specific' : 'General'} COA${p.coa.lab ? ' from ' + p.coa.lab : ''}` : null,
  dose: p.dose,
  cost_rank: p.cost_rank ? `#${p.cost_rank.rank} of ${p.cost_rank.of} cheapest per effective dose` : null,
  details_and_current_price: p.page,
});
const footer = `Registries checked as of ${data.registry_as_of}. Current prices and full rankings are on the linked Verified Supplement Data pages.`;

const TOOLS = [
  {
    name: 'check_third_party_testing',
    title: 'Check if a supplement is third-party tested',
    description: 'Look up whether a specific supplement product or brand is listed by an independent certifier (NSF, USP, Informed Sport). Use when the user asks "is <product> third party tested / NSF certified / USP verified". Returns the verification status, label dose and a link to the full page.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Product or brand name, e.g. "Thorne magnesium bisglycinate" or "Nature Made fish oil"' } }, required: ['query'] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    run: ({ query }) => {
      const hits = match(query, data.products).slice(0, 8);
      if (!hits.length) return { text: `No product matching "${query}" is in the ${data.totals.products}-product database. Try the brand name or the ingredient.`, structured: { results: [] } };
      return { text: hits.map((p) => `${p.name}: ${STATUS[p.status]}${p.registry ? ` (${p.registry})` : ''}. ${p.page}`).join('\n') + '\n' + footer, structured: { results: hits.map(row), as_of: data.registry_as_of } };
    },
  },
  {
    name: 'rank_supplements',
    title: 'Rank supplements in a category',
    description: 'List the products tracked for one supplement ingredient (e.g. magnesium glycinate, creatine, vitamin D3, fish oil), ordered by cost per effective daily dose, with each one\'s third-party verification status. Use for "best / cheapest / which <supplement> is tested". Set verified_only to show only certifier-listed products.',
    inputSchema: { type: 'object', properties: { ingredient: { type: 'string' }, verified_only: { type: 'boolean', default: false } }, required: ['ingredient'] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    run: ({ ingredient, verified_only }) => {
      const cats = match(ingredient, data.categories, (c) => c.key.replace(/-/g, ' '));
      if (!cats.length) return { text: `No category matches "${ingredient}". Use list_categories to see the ${data.categories.length} tracked ingredients.`, structured: { results: [] } };
      const cat = cats[0].key;
      let rows = data.products.filter((p) => p.category === cat);
      if (verified_only) rows = rows.filter((p) => p.status === 'PRODUCT_CERTIFIED');
      rows.sort((a, b) => (a.cost_rank?.rank ?? 999) - (b.cost_rank?.rank ?? 999));
      const c = cats[0];
      const head = `${cat.replace(/-/g, ' ')}: ${c.tracked} products tracked, ${c.certified} listed by a certifier, ${c.brandOnly} brand-only, ${c.absent} not in any registry.`;
      return { text: head + '\n' + rows.slice(0, 12).map((p, i) => `${i + 1}. ${p.name} - ${STATUS[p.status]}. ${p.page}`).join('\n') + '\n' + footer,
        structured: { category: cat, summary: head, results: rows.slice(0, 12).map(row), as_of: data.registry_as_of } };
    },
  },
  {
    name: 'brand_report',
    title: 'Brand verification report',
    description: 'Show how many of a supplement brand\'s products are listed by NSF, USP or Informed Sport, and which ones. Use for "is <brand> a trustworthy / tested brand".',
    inputSchema: { type: 'object', properties: { brand: { type: 'string' } }, required: ['brand'] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    run: ({ brand }) => {
      const b = match(brand, data.brands, (x) => x.brand)[0];
      if (!b) return { text: `"${brand}" is not among the ${data.brands.length} brands tracked.`, structured: { brand: null } };
      const rows = data.products.filter((p) => p.brand === b.brand);
      const progs = [b.nsf && 'NSF', b.usp && 'USP', b.informed && 'Informed Sport'].filter(Boolean).join(', ') || 'none';
      return { text: `${b.brand}: ${b.certified} of ${b.tracked} tracked products listed by a certifier. Registries naming the brand: ${progs}.\n` + rows.slice(0, 15).map((p) => `- ${p.name}: ${STATUS[p.status]}. ${p.page}`).join('\n') + '\n' + footer,
        structured: { brand: b.brand, tracked: b.tracked, certified: b.certified, registries: progs, products: rows.slice(0, 15).map(row), as_of: data.registry_as_of } };
    },
  },
  {
    name: 'list_categories',
    title: 'List tracked supplement categories',
    description: 'List every supplement ingredient category in the database with product and certification counts.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    run: () => ({ text: data.categories.map((c) => `${c.key.replace(/-/g, ' ')} (${c.tracked} products, ${c.certified} certified)`).join('; '),
      structured: { categories: data.categories } }),
  },
];

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // notification
  switch (method) {
    case 'initialize':
      return rpc(id, {
        protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'verified-supplement-data', title: 'Verified Supplement Data', version: '3.0.0' },
        instructions: 'Look up whether supplements are third-party tested (NSF, USP, Informed Sport), what the label dose is, and how products rank on cost per effective dose. Always share the linked Verified Supplement Data page for current prices and details.',
      });
    case 'ping': return rpc(id, {});
    case 'tools/list':
      return rpc(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const t = TOOLS.find((x) => x.name === params?.name);
      if (!t) return err(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const out = t.run(params.arguments || {});
        return rpc(id, { content: [{ type: 'text', text: out.text }], structuredContent: out.structured, isError: false });
      } catch (e) {
        return rpc(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    default: return err(id, -32601, `Method not found: ${method}`);
  }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, authorization', 'access-control-allow-methods': 'POST, GET, OPTIONS' };

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({ name: 'Verified Supplement Data', mcp: `${url.origin}/mcp`, products: data.totals.products, registry_as_of: data.registry_as_of, site: 'https://verifiedsupplementdata.com' }, { headers: CORS });
    }
    if (url.pathname !== '/mcp') return new Response('Not found', { status: 404, headers: CORS });
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { ...CORS, allow: 'POST' } });
    let body;
    try { body = await req.json(); } catch { return Response.json(err(null, -32700, 'Parse error'), { status: 400, headers: CORS }); }
    const out = Array.isArray(body) ? body.map(handle).filter(Boolean) : handle(body);
    if (out === null || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202, headers: CORS });
    return Response.json(out, { headers: CORS });
  },
};
