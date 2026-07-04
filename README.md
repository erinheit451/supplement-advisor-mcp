# Supplement Advisor MCP Server

Evidence-based supplement recommendation MCP server. 19 supplements, 40+ conditions, medication interaction checking, form quality classification. Data sourced from NIH DSLD, PubMed, NSF, and USP.

Built for use with Claude, Cursor, Windsurf, and any MCP-compatible client.

## Tools

| Tool | Description |
|------|-------------|
| `recommend_supplement` | Get ranked supplement recommendations for a condition with clinical evidence, dosing, cost-per-dose, and purchase links |
| `compare_forms` | Compare different forms of a supplement (e.g., magnesium glycinate vs citrate vs oxide) with absorption data and warnings |
| `check_interactions` | Check if medications deplete nutrients — covers statins, metformin, PPIs, birth control, and more |
| `get_dosage` | Get evidence-based dosage recommendations by condition, with clinical trial references and timing guidance |
| `classify_form` | Paste any product name or ingredient list and get a quality verdict on the supplement form used |

## Supplements Covered

Magnesium (glycinate), Vitamin D3, Omega-3, Creatine, Iron (bisglycinate), Vitamin B12, CoQ10, Collagen, Multivitamin, Protein, Biotin, Calcium Citrate, Vitamin C, Methylfolate, Probiotics, Ashwagandha, L-Theanine, Tongkat Ali, Zinc

## Quick Start (npx)

```bash
npx supplement-advisor-mcp
```

## Claude Desktop / Claude Code Configuration

Add to your MCP config:

```json
{
  "mcpServers": {
    "supplement-advisor": {
      "command": "npx",
      "args": ["-y", "supplement-advisor-mcp"]
    }
  }
}
```

## Installation (from source)

```bash
git clone https://github.com/erinheit451/supplement-advisor-mcp.git
cd supplement-advisor-mcp
npm install
npm run build
npm start
```

## Data Sources

- [NIH Dietary Supplement Label Database (DSLD)](https://dsld.od.nih.gov/)
- [PubMed](https://pubmed.ncbi.nlm.nih.gov/) — clinical trial references with PMIDs
- [NSF International](https://www.nsf.org/) — third-party certification data
- [USP (United States Pharmacopeia)](https://www.usp.org/) — quality standards

Full comparison pages and product rankings: [verifiedsupplementdata.com](https://verifiedsupplementdata.com)

## How It Works

The server loads structured evidence data (clinical doses, form comparisons, medication-nutrient interactions) and exposes it through MCP tools. When an AI assistant receives a supplement question, it calls the appropriate tool and gets back formatted, citation-backed recommendations.

Product rankings are based on cost-per-effective-daily-dose, third-party certification status, and clinical evidence — not sponsorship.

## License

MIT
