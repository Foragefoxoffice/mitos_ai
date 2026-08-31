// Second step of the one-time Hindi reference extraction — see
// extractHindiReference.js for the full context. Consolidates its raw
// per-page output into deduplicated, frequency-sorted .md files for
// human review (this is what produced the files sent to the client).
const fs = require("fs");
const OUT_DIR = process.env.HINDI_EXTRACTION_OUT_DIR || "/tmp/hindi_extraction";

const templates = JSON.parse(fs.readFileSync(`${OUT_DIR}/raw_templates.json`, "utf8"));
const terms = JSON.parse(fs.readFileSync(`${OUT_DIR}/raw_terms.json`, "utf8"));

const normalize = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

const consolidate = (items) => {
  const map = new Map(); // normalizedEnglish -> { english, variants: Map(hindi -> count) }
  for (const item of items) {
    if (!item.english || !item.hindi) continue;
    const key = normalize(item.english);
    if (!map.has(key)) map.set(key, { english: item.english.trim(), variants: new Map() });
    const entry = map.get(key);
    const hindiTrim = item.hindi.trim();
    entry.variants.set(hindiTrim, (entry.variants.get(hindiTrim) || 0) + 1);
  }
  // Convert to array, sorted by total occurrence count descending
  const arr = [...map.values()].map((e) => {
    const variantList = [...e.variants.entries()].sort((a, b) => b[1] - a[1]);
    const totalCount = variantList.reduce((s, [, c]) => s + c, 0);
    return { english: e.english, variantList, totalCount };
  });
  arr.sort((a, b) => b.totalCount - a.totalCount);
  return arr;
};

const consolidatedTemplates = consolidate(templates);
const consolidatedTerms = consolidate(terms);

const inconsistentTemplates = consolidatedTemplates.filter((e) => e.variantList.length > 1);
const inconsistentTerms = consolidatedTerms.filter((e) => e.variantList.length > 1);

console.log("=== SUMMARY ===");
console.log("unique templates:", consolidatedTemplates.length, "| with multiple Hindi variants:", inconsistentTemplates.length);
console.log("unique terms:", consolidatedTerms.length, "| with multiple Hindi variants:", inconsistentTerms.length);

// Write templates.md
let md = "# NEET Hindi Exam Templates — Extracted from 8 Real Past-Year Papers (2018-2026)\n\n";
md += `Source: ${templates.length} raw mentions across 369 bilingual exam pages, consolidated to ${consolidatedTemplates.length} unique instructional phrases.\n\n`;
md += "Sorted by frequency (most-repeated boilerplate first — highest priority to get exactly right).\n\n";
for (const e of consolidatedTemplates) {
  md += `## "${e.english}"\n`;
  md += `(seen ${e.totalCount}x)\n\n`;
  if (e.variantList.length === 1) {
    md += `**Standard Hindi:** ${e.variantList[0][0]}\n\n`;
  } else {
    md += `⚠️ **${e.variantList.length} different Hindi variants observed:**\n\n`;
    for (const [hindi, count] of e.variantList) {
      md += `- (${count}x) ${hindi}\n`;
    }
    md += "\n";
  }
}
fs.writeFileSync(`${OUT_DIR}/hindi-exam-templates.md`, md);

// Write terminology glossary.md
let gmd = "# NEET Hindi Terminology Glossary — Extracted from 8 Real Past-Year Papers (2018-2026)\n\n";
gmd += `Source: ${terms.length} raw mentions across 369 bilingual exam pages, consolidated to ${consolidatedTerms.length} unique terms.\n\n`;
gmd += "Sorted by frequency. Terms with multiple observed Hindi variants are flagged — these are the highest-risk spots for inconsistent AI translation.\n\n";
for (const e of consolidatedTerms) {
  if (e.variantList.length === 1) {
    gmd += `- **${e.english}** → ${e.variantList[0][0]} (${e.totalCount}x)\n`;
  } else {
    gmd += `- **${e.english}** ⚠️ ${e.variantList.length} variants: ${e.variantList.map(([h, c]) => `${h} (${c}x)`).join(", ")}\n`;
  }
}
fs.writeFileSync(`${OUT_DIR}/hindi-terminology-glossary.md`, gmd);

console.log("\nwritten:", `${OUT_DIR}/hindi-exam-templates.md`, "and", `${OUT_DIR}/hindi-terminology-glossary.md`);

// Show top 15 most common terms as a quick sanity sample
console.log("\n=== top 15 most-common terms ===");
for (const e of consolidatedTerms.slice(0, 15)) {
  console.log(`${e.english} -> ${e.variantList.map(([h,c])=>h).join(" | ")} (${e.totalCount}x total)`);
}
