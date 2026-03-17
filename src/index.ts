import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "../../data");

const AFFILIATE_TAG = "verifiedsupp2-20";
const BASE_URL = "https://verifiedsupplementdata.com";

// Load data files
const products = JSON.parse(readFileSync(resolve(dataDir, "products.json"), "utf-8"));
const evidence = JSON.parse(readFileSync(resolve(dataDir, "evidence-engine.json"), "utf-8"));
const matrix = JSON.parse(readFileSync(resolve(dataDir, "matrix.json"), "utf-8"));

function amazonUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}?tag=${AFFILIATE_TAG}`;
}

// Add-to-Cart URL — extends cookie from 24 hours to 90 DAYS
function amazonCartUrl(asin: string): string {
  return `https://www.amazon.com/gp/aws/cart/add.html?AssociateTag=${AFFILIATE_TAG}&ASIN.1=${asin}&Quantity.1=1`;
}

function formatProducts(categoryKey: string) {
  const items = products.categories?.[categoryKey] || [];
  return [...items]
    .sort((a: any, b: any) => a.costPerDay - b.costPerDay)
    .map((p: any, i: number) => ({
      rank: i + 1,
      name: p.name,
      brand: p.brand,
      dose_per_serving: `${p.mgPerServing}${p.unit || "mg"}`,
      serving_size: p.servingSize,
      price_usd: p.price,
      cost_per_day_usd: Number(p.costPerDay.toFixed(2)),
      certification: p.certification || "None",
      editorial_pick: p.pick || null,
      buy_url: p.amazonAsin ? `${BASE_URL}/go/${p.slug}/` : null,
      amazon_url: p.amazonAsin ? amazonUrl(p.amazonAsin) : null,
      add_to_cart_url: p.amazonAsin ? amazonCartUrl(p.amazonAsin) : null,
    }));
}

// Supplement ID → product category key mapping
const SUPP_TO_CATEGORY: Record<string, string> = {
  magnesium: "magnesium-glycinate",
  "vitamin-d": "vitamin-d3",
  "omega-3": "omega-3",
  creatine: "creatine",
  iron: "iron-bisglycinate",
  "vitamin-b12": "vitamin-b12",
  coq10: "coq10",
  collagen: "collagen",
  multivitamin: "multivitamin",
  protein: "protein",
  biotin: "biotin",
  "calcium-citrate": "calcium-citrate",
  "vitamin-c": "vitamin-c",
  methylfolate: "methylfolate",
};

// Evidence engine key mapping
const SUPP_TO_EVIDENCE: Record<string, string> = {
  magnesium: "magnesium",
  "vitamin-d": "vitamin-d",
  "omega-3": "omega-3",
  creatine: "creatine",
  iron: "iron",
  "vitamin-b12": "vitamin-b12",
  coq10: "coq10",
  calcium: "calcium",
  probiotics: "probiotics",
  ashwagandha: "ashwagandha",
  electrolytes: "electrolytes",
};

const server = new McpServer({
  name: "supplement-advisor",
  version: "1.0.0",
});

// Tool 1: Recommend supplements for a condition
server.tool(
  "recommend_supplement",
  "Get evidence-based supplement recommendations for a specific condition. Returns ranked products with clinical evidence, dosing, cost-per-dose, and purchase links.",
  {
    supplement: z.enum([
      "magnesium", "vitamin-d", "omega-3", "creatine", "iron",
      "vitamin-b12", "coq10", "collagen", "multivitamin", "protein",
      "biotin", "calcium-citrate", "vitamin-c", "methylfolate",
      "probiotics", "ashwagandha", "electrolytes",
    ]).describe("The supplement to recommend"),
    condition: z.string().optional().describe("The health condition or goal (e.g., 'sleep', 'anxiety', 'deficiency', 'muscle-building'). Omit for general recommendation."),
  },
  async ({ supplement, condition }) => {
    const categoryKey = SUPP_TO_CATEGORY[supplement];
    if (!categoryKey) {
      return { content: [{ type: "text" as const, text: `Unknown supplement: ${supplement}` }] };
    }

    const productList = formatProducts(categoryKey);
    const evidenceKey = SUPP_TO_EVIDENCE[supplement];
    const evidenceInfo = evidenceKey ? evidence.supplement_categories?.[evidenceKey] : null;

    let doseInfo = "";
    if (evidenceInfo?.clinical_doses) {
      const condKey = condition?.replace(/-/g, "_") || "general";
      const dose = evidenceInfo.clinical_doses[condKey] || evidenceInfo.clinical_doses.general || evidenceInfo.clinical_doses.maintenance;
      if (dose) {
        doseInfo = `\n\nRecommended dose: ${dose.min}-${dose.max} ${dose.unit}${dose.note ? ` (${dose.note})` : ""}${dose.timing ? `. Timing: ${dose.timing}` : ""}`;
        if (dose.pmid) doseInfo += ` [PMID: ${dose.pmid}](https://pubmed.ncbi.nlm.nih.gov/${dose.pmid}/)`;
      }
    }

    let formInfo = "";
    if (evidenceInfo?.forms) {
      const forms = Object.entries(evidenceInfo.forms).map(([key, f]: [string, any]) => {
        let line = `- **${key}**: ${f.verdict} — absorption: ${f.absorption}. Best for: ${f.best_for?.join(", ") || "general use"}`;
        if (f.warning) line += ` ⚠️ ${f.warning}`;
        return line;
      });
      formInfo = `\n\nForm comparison:\n${forms.join("\n")}`;
    }

    const text = `## ${supplement.replace(/-/g, " ")} recommendation${condition ? ` for ${condition}` : ""}
${doseInfo}${formInfo}

### Top products (ranked by cost per effective daily dose):

${productList.map((p: any) => `${p.rank}. **${p.name}** — $${p.cost_per_day_usd}/day | ${p.dose_per_serving}/serving | ${p.certification}${p.editorial_pick ? ` | 🏆 ${p.editorial_pick}` : ""}
   Buy: ${p.buy_url || "N/A"}`).join("\n\n")}

Source: ${BASE_URL}
Affiliate disclosure: Product links use Amazon Associates tags. Rankings are based on cost-per-dose, certification, and clinical evidence.
*This is not medical advice. Consult a healthcare provider.*`;

    return { content: [{ type: "text" as const, text }] };
  }
);

// Tool 2: Compare supplement forms
server.tool(
  "compare_forms",
  "Compare different forms of a supplement (e.g., magnesium glycinate vs citrate vs oxide). Shows absorption, best uses, warnings, and which form to buy.",
  {
    supplement: z.enum([
      "magnesium", "vitamin-d", "omega-3", "iron", "vitamin-b12",
      "coq10", "calcium", "creatine", "probiotics", "ashwagandha",
      "electrolytes",
    ]).describe("The supplement to compare forms for"),
  },
  async ({ supplement }) => {
    const evidenceKey = SUPP_TO_EVIDENCE[supplement];
    const info = evidenceKey ? evidence.supplement_categories?.[evidenceKey] : null;

    if (!info?.forms) {
      return { content: [{ type: "text" as const, text: `No form comparison data available for ${supplement}.` }] };
    }

    const forms = Object.entries(info.forms).map(([key, f]: [string, any]) => {
      let entry = `### ${key}
- **Verdict:** ${f.verdict}
- **Absorption:** ${f.absorption}
- **Best for:** ${f.best_for?.join(", ") || "general use"}
- **Side effects:** ${f.side_effects || "None noted"}`;
      if (f.warning) entry += `\n- **⚠️ Warning:** ${f.warning}`;
      if (f.better_alternative) entry += `\n- **Better alternative:** ${f.better_alternative}`;
      if (f.page_url) entry += `\n- **Full comparison:** ${BASE_URL}${f.page_url}`;
      return entry;
    });

    const text = `## ${info.name} — Form Comparison

${forms.join("\n\n")}

Source: ${BASE_URL}
*This is not medical advice.*`;

    return { content: [{ type: "text" as const, text }] };
  }
);

// Tool 3: Check medication-nutrient interactions
server.tool(
  "check_interactions",
  "Check if medications deplete nutrients, creating supplement needs. Returns depleted nutrients, mechanisms, severity, and recommended supplements.",
  {
    medication: z.string().describe("Medication name or class (e.g., 'statin', 'metformin', 'PPI', 'birth-control', 'omeprazole')"),
  },
  async ({ medication }) => {
    const medLower = medication.toLowerCase();
    const depletions = (matrix.depletions || []).filter((d: any) => {
      const medName = (d.medication_name || "").toLowerCase();
      const medId = (d.medication || "").toLowerCase();
      return medName.includes(medLower) || medId.includes(medLower) ||
        medLower.includes(medId) || medLower.includes(medName);
    });

    if (depletions.length === 0) {
      // Try fuzzy matching common drug names to classes
      const aliases: Record<string, string> = {
        omeprazole: "ppis", prilosec: "ppis", nexium: "ppis", esomeprazole: "ppis",
        prevacid: "ppis", lansoprazole: "ppis", pantoprazole: "ppis", protonix: "ppis",
        atorvastatin: "statins", lipitor: "statins", rosuvastatin: "statins", crestor: "statins",
        simvastatin: "statins", zocor: "statins", pravastatin: "statins",
        "birth control": "birth-control", "the pill": "birth-control", "oral contraceptive": "birth-control",
        glucophage: "metformin",
      };
      const aliasKey = aliases[medLower];
      if (aliasKey) {
        const aliasResults = (matrix.depletions || []).filter((d: any) =>
          d.medication?.toLowerCase() === aliasKey || d.medication_name?.toLowerCase() === aliasKey
        );
        if (aliasResults.length > 0) {
          return formatInteractions(aliasResults);
        }
      }
      return { content: [{ type: "text" as const, text: `No nutrient depletion data found for "${medication}". Available medications: statins, metformin, PPIs (omeprazole/pantoprazole/etc), birth control.` }] };
    }

    return formatInteractions(depletions);
  }
);

function formatInteractions(depletions: any[]) {
  const medName = depletions[0]?.medication_name || "Unknown";
  const usersM = depletions[0]?.us_users_millions;

  const entries = depletions.map((d: any) => {
    let entry = `- **${d.nutrient.toUpperCase()}** (severity: ${d.severity})\n  Mechanism: ${d.mechanism}`;
    if (d.effect_size) entry += `\n  Effect: ${d.effect_size}`;
    if (d.pmid) entry += `\n  Evidence: [PMID ${d.pmid}](https://pubmed.ncbi.nlm.nih.gov/${d.pmid}/)`;
    return entry;
  });

  const pageUrl = depletions[0]?.page_url ? `${BASE_URL}${depletions[0].page_url}` : null;

  const text = `## ${medName} — Nutrient Depletion
${usersM ? `Affects ${usersM}M+ Americans` : ""}

${entries.join("\n\n")}
${pageUrl ? `\nFull guide: ${pageUrl}` : ""}

Source: ${BASE_URL}
*This is not medical advice. Discuss supplements with your prescribing physician.*`;

  return { content: [{ type: "text" as const, text }] };
}

// Tool 4: Get dosage guidance
server.tool(
  "get_dosage",
  "Get evidence-based dosage recommendations for a supplement, with clinical trial doses by condition, timing, and safety considerations.",
  {
    supplement: z.enum([
      "magnesium", "vitamin-d", "omega-3", "iron", "vitamin-b12",
      "coq10", "calcium", "creatine", "probiotics", "ashwagandha",
      "electrolytes",
    ]).describe("The supplement to get dosage for"),
    condition: z.string().optional().describe("Specific condition for targeted dose (e.g., 'sleep', 'anxiety', 'deficiency')"),
  },
  async ({ supplement, condition }) => {
    const evidenceKey = SUPP_TO_EVIDENCE[supplement];
    const info = evidenceKey ? evidence.supplement_categories?.[evidenceKey] : null;

    if (!info?.clinical_doses) {
      return { content: [{ type: "text" as const, text: `No dosage data available for ${supplement}.` }] };
    }

    let text = `## ${info.name} — Dosage Guide\n\n`;

    if (condition) {
      const condKey = condition.replace(/-/g, "_");
      const dose = info.clinical_doses[condKey];
      if (dose) {
        text += `### For ${condition}:\n- **Dose:** ${dose.min}-${dose.max} ${dose.unit}`;
        if (dose.note) text += `\n- **Note:** ${dose.note}`;
        if (dose.timing) text += `\n- **Timing:** ${dose.timing}`;
        if (dose.pmid) text += `\n- **Evidence:** [PMID ${dose.pmid}](https://pubmed.ncbi.nlm.nih.gov/${dose.pmid}/)`;
      } else {
        text += `No specific dose data for "${condition}". Available conditions:\n`;
        text += Object.keys(info.clinical_doses).map(k => `- ${k}`).join("\n");
      }
    } else {
      // Show all doses
      for (const [condName, dose] of Object.entries(info.clinical_doses) as [string, any][]) {
        text += `### ${condName.replace(/_/g, " ")}:\n- **Dose:** ${dose.min}-${dose.max} ${dose.unit}`;
        if (dose.note) text += `\n- **Note:** ${dose.note}`;
        if (dose.timing) text += `\n- **Timing:** ${dose.timing}`;
        if (dose.pmid) text += `\n- **Evidence:** [PMID ${dose.pmid}](https://pubmed.ncbi.nlm.nih.gov/${dose.pmid}/)`;
        text += "\n\n";
      }
    }

    text += `\nSource: ${BASE_URL}\n*This is not medical advice.*`;
    return { content: [{ type: "text" as const, text }] };
  }
);

// Tool 5: Classify supplement form quality
server.tool(
  "classify_form",
  "Check if a supplement product uses a good or bad form. Paste any product name or ingredient list and get a quality verdict. Example: 'Nature Made Magnesium Oxide 250mg' → verdict: poor, absorption: ~4%, better alternative: glycinate.",
  {
    product_text: z.string().describe("The product name, title, or ingredient text to classify"),
    category: z.enum([
      "magnesium", "iron", "vitamin-b12", "omega-3", "coq10",
      "calcium", "creatine", "vitamin-d", "probiotics", "ashwagandha",
      "electrolytes",
    ]).describe("The supplement category"),
  },
  async ({ product_text, category }) => {
    const evidenceKey = SUPP_TO_EVIDENCE[category] || category;
    const catData = evidence.supplement_categories?.[evidenceKey];

    if (!catData?.forms) {
      return { content: [{ type: "text" as const, text: `No form classification data for ${category}.` }] };
    }

    const textLower = product_text.toLowerCase();
    let bestMatch: { key: string; data: any; keywords: string[]; specificity: number } | null = null;

    for (const [formKey, formData] of Object.entries(catData.forms) as [string, any][]) {
      const keywords: string[] = formData.detection_keywords || [];
      const matched = keywords.filter((kw: string) => textLower.includes(kw.toLowerCase()));
      if (matched.length > 0) {
        const specificity = Math.max(...matched.map((m: string) => m.length));
        if (!bestMatch || specificity > bestMatch.specificity) {
          bestMatch = { key: formKey, data: formData, keywords: matched, specificity };
        }
      }
    }

    if (!bestMatch) {
      const defaults: Record<string, string> = {
        magnesium: "No form specified — likely oxide (~4% absorption). Check the Supplement Facts panel.",
        iron: "No form specified — likely ferrous sulfate (cheapest, worst tolerability).",
        "vitamin-b12": "No form specified — likely cyanocobalamin (synthetic, requires conversion).",
        "omega-3": "No form specified — likely ethyl ester (70% less bioavailable than triglyceride form).",
        coq10: "No form specified — likely ubiquinone. Ubiquinol has 72% better absorption for adults 50+.",
        calcium: "No form specified — likely carbonate. Requires stomach acid — useless for PPI users, elderly.",
      };
      return { content: [{ type: "text" as const, text: `## Form Classification: "${product_text}"\n\n**⚠️ Form not detected**\n${defaults[category] || "Check the Supplement Facts panel for the specific form used."}\n\nSource: ${BASE_URL}` }] };
    }

    const f = bestMatch.data;
    let text = `## Form Classification: "${product_text}"

**Form detected:** ${bestMatch.key}
**Verdict:** ${f.verdict}
**Absorption:** ${f.absorption}
**Best for:** ${(f.best_for || []).join(", ")}`;

    if (f.warning) text += `\n\n**⚠️ Warning:** ${f.warning}`;
    if (f.better_alternative) text += `\n**💡 Better alternative:** ${f.better_alternative}`;
    if (f.page_url) text += `\n\n**Full comparison:** ${BASE_URL}${f.page_url}`;

    text += `\n\nSource: ${BASE_URL}\n*This is not medical advice.*`;

    return { content: [{ type: "text" as const, text }] };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
