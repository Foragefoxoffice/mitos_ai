const { runTask } = require("../router/aiRouter");
const { buildKeywordExtractionPrompt } = require("../prompts/keywordExtractionPrompt");
const { parseJsonResponse } = require("../utils/parseJson");
const { stripHtml } = require("../utils/stripHtml");
const { stripLatex } = require("../utils/stripLatex");
const { stripCitations } = require("../utils/stripCitations");

// A returned "term" that still looks like LaTeX/math (backslash, bare
// digits, or a command name with NO standalone English/scientific meaning)
// gets dropped even if the model returned it anyway — output-side safety
// net on top of the input-side stripping and the prompt instruction, so a
// formula fragment can't slip through all three. Deliberately does NOT
// block Greek-letter names (alpha, beta, theta, omega, ...) — those are
// legitimate standalone physics/chemistry vocabulary (e.g. "alpha
// particle") as well as LaTeX command names, so blocking them by name
// would remove genuinely valid terms, not just formula leakage.
const LATEX_LIKE = /\\|^\d+$|^(dfrac|frac|sqrt|cdot|infty|nabla|partial|leq|geq|neq)$/i;

// A single bare letter/symbol (e.g. "m", "t", "l") is never a valid
// dictionary term on its own — no false-positive risk, since no real
// vocabulary word is one character. Caught real garbage from the local
// Ollama model (weaker instruction-following than Gemini): question 624's
// dimensional-formula hint ("[MLT⁻²][L] = [ML²T⁻²]") produced "m"/"l"/"t"
// as standalone "terms" despite the prompt explicitly excluding them.
const SINGLE_CHAR = /^.$/;

// Bracket characters and the literal words "superscript"/"subscript" only
// ever show up when a model is describing a dimensional-formula fragment
// it couldn't fully strip out (e.g. "[ml2t-2]" or the observed
// "ml superscript negative one t superscript negative two") — never in a
// genuine vocabulary term, so safe to hard-block.
const FORMULA_NOTATION = /[[\]{}]|superscript|subscript/i;

// Words that only ever describe a formula variable spoken aloud (e.g. "v
// squared", "u squared", "x prime") — never legitimate standalone
// vocabulary modifiers on their own. Narrow and conservative on purpose: a
// real compound term built on a single letter (e.g. "g force", "c value")
// still passes through fine below, since its second word isn't in this set.
const FORMULA_DESCRIPTOR_WORDS = new Set(["squared", "cubed", "prime"]);

// A term where EVERY space-separated token is either a single letter, a
// bare (possibly signed) number, or one of the formula-descriptor words
// above is a formula fragment rather than a word — either dimensional
// notation spelled with spaces (e.g. "mlt −2" as two tokens, "ml 2 t −2" as
// four) or a variable name spoken as a phrase ("v squared" as two tokens).
// No legitimate multi-word technical phrase is built entirely out of these.
const isFormulaFragment = (term) => {
  const tokens = term.split(/\s+/).filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.every((t) => /^[a-z]$/i.test(t) || /^[-−+]?\d+$/.test(t) || FORMULA_DESCRIPTOR_WORDS.has(t))
  );
};

// Bare generic measurement/geometry nouns the prompt already explicitly
// names as always-exclude — the local Ollama model (weaker
// instruction-following than Gemini) still returns these sometimes anyway
// (verified: "distance", "time", "volume", "area" leaked through on a
// 12-question re-test even with the strengthened prompt). Exact-match only,
// so a genuine compound phrase built on one of these (e.g. "distance-time
// graph", "surface area") is untouched — only the bare generic noun itself
// is blocked.
const GENERIC_NOUNS = new Set([
  "distance",
  "time",
  "mass",
  "length",
  "area",
  "volume",
  "radius",
  "direction",
  "second",
  "minute",
  "units",
  "unit",
  "differentiate",
  "differentiating",
  // Compass directions leaking from word-problem scenario setup (verified
  // live on DeepSeek: "northwest", "eastwards" extracted from a navigation
  // question) — same failure class already seen on the local Ollama model
  // ("north"/"south"/"east").
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "northward",
  "southward",
  "eastward",
  "westward",
  "northwards",
  "southwards",
  "eastwards",
  "westwards",
  // The exam subject name itself — verified live on DeepSeek ("physics"
  // extracted as a standalone term from an SHM question).
  "physics",
  "chemistry",
  "biology",
  // Sub-field names, same failure class as the top-level subject names
  // above — verified live on DeepSeek from a Katherine Esau question
  // ("zoology"/"animal physiology" extracted from a FALSE statement being
  // corrected, instead of her name and her real, correct field). The
  // prompt now explicitly instructs excluding these, but that instruction
  // isn't followed 100% of the time ("botany" still leaked from a
  // statement-evaluation question in the same re-test that motivated this
  // filter), so this is the backup.
  "zoology",
  "botany",
  "genetics",
  "ecology",
  "biochemistry",
  "evolutionary biology",
  "plant biology",
  "animal physiology",
  "experimental biology",
  "natural history",
  // Vague category/description phrases that describe something without
  // naming one specific thing — fail the prompt's own "glossary headword"
  // test, verified live to still leak on DeepSeek even when used as the
  // prompt's explicit negative example ("structural organization" is
  // named directly in the prompt as what NOT to extract, and still showed
  // up in a re-test on the exact question that motivated adding it there).
  "structural organization",
  "structural organisation",
  "morphological features",
  "physiological functions",
  "cellular level",
  "gross morphological features",
  // Bare generic words/vague scenario fragments, verified live on DeepSeek
  // across the same 250-question batch: "maximum", "string", "particles",
  // "cosine" as standalone terms, and multi-word fragments that only make
  // sense embedded in one specific question's sentence rather than as an
  // independent glossary headword.
  "maximum",
  "minimum",
  "string",
  "particles",
  "particle",
  "cosine",
  "sine",
  "tangent",
  "end point",
  "finishing point",
  "cut-off",
  "cutoff",
  // Solution-narration words — the prompt already instructs excluding these
  // ("simplifying", "hence", "therefore", "final answer"), but verified
  // live on gpt-5-mini that the instruction isn't followed 100% of the
  // time ("simplifying" still leaked on a re-test of question 553, the
  // exact question that motivated the prompt rule in the first place) —
  // same story as every other prompt-only rule in this file, needs an
  // output-side backup.
  "simplifying",
  "hence",
  "therefore",
  "final answer",
  "successive order",
  "perpendicular directions",
  // Bare generic nouns that slipped past the existing list — verified live
  // on DeepSeek from a Pteridophyta/Bryophyta batch ("water", "root",
  // "roots" extracted as standalone terms).
  "water",
  "root",
  "roots",
  // Vague descriptive phrases (adjective/modifier + generic category noun)
  // from the same batch — the same failure class as "structural
  // organization"/"morphological features" above, recurring with fresh
  // wording. Exact-match backstop for these specific instances; the
  // prompt's core test has been strengthened to generalize against the
  // whole pattern, but whack-a-mole on the exact phrases already seen
  // costs nothing and catches anything the prompt still misses.
  "structural adaptation",
  "terrestrial adaptation",
  "dominant plant body",
  "dominant life cycle stage",
  "reproductive mechanism",
  "evolutionary significance",
  "leafy members",
  "leafy shoots",
  "leaf-like appendages",
  "stem-like structures",
  "female organs",
  "water dependency",
  "water availability",
  // More bare generic nouns/verb-forms and modifier+generic-noun phrases,
  // same two established failure classes, verified live on DeepSeek from a
  // redox/qualitative-analysis chemistry batch: "percentage", "separation",
  // "cooling", "heating", "priority" are generic lab-procedure/measurement
  // words with no subject-specific meaning on their own; "reduced"/
  // "oxidised" are the bare adjective form of a redox concept whose
  // genuinely useful compound forms ("reducing agent", "oxidising agent")
  // already exist separately; bare "fission" is dangerously ambiguous in a
  // chemistry context specifically (could mean either homolytic or
  // heterolytic bond fission, or get confused with nuclear fission) without
  // the qualifier that makes it a real specific term; "ionic charge",
  // "negative charge", "dispersal of charge" are the modifier+generic-noun
  // pattern with "charge" as the generic tail this time.
  "percentage",
  "separation",
  "cooling",
  "heating",
  "priority",
  "reduced",
  "oxidised",
  "oxidized",
  "fission",
  "ionic charge",
  "negative charge",
  "dispersal of charge",
  // Same two patterns again, verified live on DeepSeek from a leaf-anatomy/
  // muscle-tissue biology batch: modifier+generic-noun phrases
  // ("anatomical feature", "anatomical variation", "epidermal adaptations",
  // "protective adaptations", "epidermal structures", "compact
  // arrangement"), and bare generic words that have better, more specific
  // compound forms already present in the SAME batch ("spongy" alongside
  // "spongy tissue"/"spongy parenchyma"/"spongy cells", "contract"
  // alongside "contraction", plus bare "parallel" and "regenerate" which
  // have no specific standalone meaning here).
  "anatomical feature",
  "anatomical variation",
  "epidermal adaptations",
  "protective adaptations",
  "epidermal structures",
  "compact arrangement",
  "spongy",
  "parallel",
  "contract",
  "regenerate",
  // Same "structures"/"structure" generic-tail-noun pattern again, verified
  // live on DeepSeek from a cell-membrane/bacterial-ultrastructure biology
  // batch, plus bare generic words with no specific standalone meaning here.
  "cytoskeletal structures",
  "cytoplasmic structures",
  "locomotory structures",
  "bacterial surface structures",
  "photosynthetic structure",
  "membranous extension",
  "membranous extensions",
  "arrangement",
  "infection",
  "deposition",
  "adherence",
  "non-membranous",
  // Bare generic pH/reaction-state adjectives (procedural, matching the
  // "reduced"/"oxidised" pattern) and an overly-broad bare category noun
  // (matching the "particles"/"particle" pattern) — verified live on
  // DeepSeek from a colligative-properties/d-block chemistry batch.
  "acidified",
  "basic",
  "acidic",
  "acids",
  "acid",
  // Bare generic words with no specific standalone meaning, and word-
  // problem scenario-example objects (not vocabulary) — verified live on
  // DeepSeek from a thermodynamics/kinetic-theory-of-gases physics batch.
  "transfer",
  "point",
  "coiling",
  "deviation",
  "car engine",
  "tyre bursting",
  // Coordinate-axis direction references, same pattern as compass
  // directions (setup/orientation detail, not vocabulary) — verified live
  // on DeepSeek from an EM-waves physics batch ("z-direction"; "x-direction"
  // and "y-direction" seen as the same pattern in earlier batches, added
  // now for consistency). Plus a bare generic word ("filter") and a bare
  // verb-form with a better existing compound already present in the same
  // batch ("repelled" alongside "repulsion"/"repulsive force").
  "x-direction",
  "y-direction",
  "z-direction",
  "filter",
  "repelled",
  "energetic",
  // Same modifier+generic-noun pattern again, verified live on DeepSeek
  // from a biomolecules biology batch, plus bare generic words/verb-forms.
  "destructive process",
  "physiological processes",
  "physiological role",
  "biochemical reactions",
  "ecological interactions",
  "cellular mass",
  "drugs",
  "immune",
  "catalyze",
  // From a photosynthesis/chemiosmosis + meiosis biology batch: modifier +
  // generic-tail-noun descriptive phrases lifted straight from the hint's
  // own explanatory prose ("photosynthesis is a physico-chemical process",
  // "CF1, the catalytic part of the enzyme", "this energy is utilized in
  // various metabolic reactions") — same failure class as "biochemical
  // reactions" above, not itself a named headword.
  "physico-chemical process",
  "catalytic part",
  "metabolic reactions",
  // Bare adjective/gerund forms of a concept that already has a more
  // specific compound term extracted from the SAME source question in this
  // batch ("chemiosmotic" alongside "chemiosmosis"/"chemiosmotic
  // mechanism"/"chemiosmotic hypothesis"; "pairing" alongside "chromosome
  // pairing"/"homologous pair") — a redundant weaker duplicate, not a
  // distinct concept worth its own entry.
  "chemiosmotic",
  "pairing",
  // From an NCERT "Plant Growth and Development" biology batch — an
  // unusually definition-dense chapter (lots of "which statement is
  // correct/incorrect", "odd one out w.r.t X" questions that restate the
  // textbook's own definitional prose almost verbatim). Modifier +
  // generic-tail-noun descriptive/definitional fragments, not headwords —
  // same failure class as "biochemical reactions"/"physico-chemical
  // process" above:
  "protoplasmic modifications",
  "protoplasmic modification",
  "protoplasmic changes",
  "growth measures",
  "dense cytoplasm",
  "cell type",
  "specialized roles",
  "irreversible increase",
  "irreversible increase in size and mass",
  "physiological trait",
  "quantitative increase",
  "permanent increase",
  "growth parameters",
  "zones of growth",
  "cell size",
  "cell number",
  "growth phases",
  "quantitative aspects of growth",
  // Bare generic words/adjectives from the same batch — some duplicate a
  // more specific compound already extracted from the same source question
  // ("differentiated" alongside "differentiated cells"/"cell
  // differentiation"; "meristematic" alongside "meristematic cells"/
  // "meristematic tissues"/"meristematic zone"; "quantitative" alongside
  // "quantitative growth"), others are the same generic-measurement-noun
  // category the prompt already excludes (distance/length/mass/etc.),
  // just with fresh wording ("weight", "height", "meter" as a bare unit
  // name alongside "decibel"/"gram"/"micrometer" in an odd-one-out
  // question).
  "division",
  "increase",
  "parameters",
  "quantitative",
  "measurable",
  "colour",
  "meter",
  "weight",
  "height",
  "self-perpetuate",
  "differentiated",
  "meristematic",
  // Scenario-prop (word-problem setting, not a concept) — "watermelon" is
  // the everyday fruit example used to illustrate cell-size-driven growth,
  // same class as train/swimmer/ball props already excluded for physics.
  "watermelon",
  // From a plant-hormones biology batch (auxins/gibberellins/cytokinins/
  // ethylene/ABA, ids ~13860-14005) + an AC-circuits physics batch mixed
  // into the same run. Modifier + generic-tail-noun descriptive fragments
  // lifted from the hint's own scenario/outcome narration, not named
  // headwords — same failure class as "hormone/quantitative growth"
  // batches above: "in breeding programs", "what does this imply about
  // the hormone balance", "maintaining hormonal balance", "enhanced stem
  // bending", "enhancing sugar yield", "seed formation" (one item in a
  // plain list of processes, unlike the genuinely named "hook formation"
  // that's part of ethylene's canonical triple response, which stays):
  "breeding programs",
  "hormone balance",
  "hormonal balance",
  "hormonal imbalance",
  "stem bending",
  "sugar yield",
  "seed formation",
  // "current in circuit" is formula-derivation narration ("current in
  // circuit, I=V/Z"), not vocabulary — same class as the existing
  // solution-narration exclusions (simplifying/hence/therefore) above.
  // "mains"/"lamp" are word-problem apparatus/scenario props (the
  // household supply and the bulb in a transformer-efficiency problem),
  // same class as train/swimmer/ball/watermelon. "sharp" is a bare
  // descriptive adjective from the hint's own narration ("peak of current
  // growth must be sharp"), not a technical term.
  "current in circuit",
  "mains",
  "lamp",
  "sharp",
  // From a semiconductor-electronics physics batch (transistors/diodes/
  // logic gates) — this chapter is unusually vocabulary-dense with
  // genuinely specific terms (verified "base"/"collector" bare ARE valid:
  // they're the actual named transistor terminals, not generic duplicates
  // of "base region"/"collector current" — left unblocked). Two real
  // leaks: "circuit diagram" is a generic modifier+noun reference to the
  // question's own attached figure ("the circuit diagram drawn"), not a
  // named concept; "led bulb" bolts the generic everyday word "bulb" onto
  // the already-valid technical term "led", adding no specificity.
  "circuit diagram",
  "led bulb",
  // From a cardiovascular-regulation biology batch + a nuclear-physics
  // batch (ids ~19192-19291). Modifier + generic-tail-noun descriptive
  // fragments, not headwords: "circulatory problems", "cardiovascular
  // stability", "cardiac activity", "autonomous function", "intrinsic
  // regulation", "nervous control", "cardiac regulation", "four chambers".
  "circulatory problems",
  "cardiovascular stability",
  "cardiac activity",
  "autonomous function",
  "intrinsic regulation",
  "nervous control",
  "cardiac regulation",
  "four chambers",
  // Redundant duplicates of a more specific compound already established
  // in the same subject ("neural signal"/"sympathetic signals"/
  // "parasympathetic neural signals" alongside "sympathetic nerve(s)"/
  // "parasympathetic nerve(s)"; bare "sympathetic"/"parasympathetic"
  // alongside "sympathetic system"/those same nerve compounds; "human
  // heart" alongside plain "heart"; bare "oxygenated" alongside
  // "oxygenated blood"/"deoxygenated blood"):
  "neural signal",
  "sympathetic signals",
  "parasympathetic signals",
  "parasympathetic neural signals",
  "sympathetic",
  "parasympathetic",
  "human heart",
  "oxygenated",
  // Plain English adverb, zero subject-specificity:
  "synergistically",
  // Nuclear-physics formula/problem narration, not vocabulary — same
  // class as "current in circuit" above: "fraction remaining" restates
  // the problem's own phrasing ("the fraction... that would remain"),
  // "energy liberated" and "gain in binding energy" restate the specific
  // numeric problem's setup rather than naming a distinct concept (the
  // real headword, "binding energy", is already a separate established
  // term). Bare "atoms" is the same generic-measurement-noun category
  // already excluded (particles/etc.), used here as a formula-narration
  // variable ("number of atoms left after n half-lives").
  "fraction remaining",
  "fraction",
  "energy liberated",
  "gain in binding energy",
  "atoms",
  // Incomplete/ambiguous: doesn't name WHICH conservation law (of charge,
  // mass number, momentum, energy...), so it fails the "one stable
  // definition" test even though the underlying named laws are valid
  // terms in their own right.
  "law of conservation",
  // From an organic-chemistry batch (haloalkanes/alcohols/SN1-SN2/EAS
  // directing effects) + an ecology/energy-flow biology batch, ids
  // ~24900-24980. Redundant duplicates of a more specific compound
  // already established in the same subject: bare "covalent" (alongside
  // "covalent bond"), "ortho and para positions" (alongside the real
  // named effect "ortho-para directing"), "nutrient movement" (alongside
  // "nutrient cycling"), and three separate paraphrases of the same
  // already-established "energy flow" concept — "flow of energy",
  // "energy flow in ecosystems", "transfer of energy":
  "covalent",
  "ortho and para positions",
  "nutrient movement",
  "flow of energy",
  "energy flow in ecosystems",
  "transfer of energy",
  // Modifier + generic-tail-noun / generic-category-noun descriptive
  // phrases, not headwords: "one-step process" (restates a property of
  // SN2 mechanism, itself a separate established term), "isomeric
  // alcohol"/"isomeric haloalkanes" (purely relational — "isomeric" can
  // combine with any compound class, not a distinct named concept),
  // "energy loss" (restates the 10% law's effect, itself a separate term):
  "one-step process",
  "isomeric alcohol",
  "isomeric alcohols",
  "isomeric haloalkanes",
  "energy loss",
  // Bare generic words — basic English, not subject vocabulary a NEET
  // student would need defined: "recycle", "cyclic" (both from a hint
  // explaining energy flow is NOT cyclic, contrasted with nutrient
  // cycling), "sun" (the literal answer to a question, but the word
  // itself needs no dictionary definition — same "common-knowledge word"
  // exclusion the prompt already applies elsewhere).
  "recycle",
  "cyclic",
  "sun",
  // Three spelled-out variants of the same well-known ecological law
  // (Lindeman's 10% law) fragmenting one concept across near-duplicate
  // entries — standardized on the concise "10% law" form already
  // established; blocking the verbose spelled-out duplicates so future
  // extractions converge on the one canonical spelling.
  "ten percent law",
  "10 percent law",
  // From a plant-histology/cell-organelle biology batch + a
  // biomolecules/photosynthesis biochemistry batch, ids ~26076-26137.
  // Modifier + generic-tail-noun descriptive phrases and formula/question
  // narration, not headwords: "cell organelles" (describing what
  // ribosomes categorically are, not a distinct concept), "cell
  // mobility", "acid soluble"/"acid solution"/"alkaline solution" (basic
  // chemistry properties, not headwords), "flow of electrons" (the
  // question's own phrasing; the real term, "electron transport chain",
  // is already separate), "first stable product" (circular question
  // narration — describes oxaloacetate without naming it), "reduced
  // co-enzyme" (generic reference to NADH/FADH2 without naming them),
  // "fixation of co2"/"primary fixation" (paraphrase of the established
  // "co2 fixation"/"carbon fixation"), "photosynthetic cycle" (vague
  // paraphrase — the real named cycles are "calvin cycle"/"c3 cycle"/
  // "c4 cycle").
  "cell organelles",
  "cell mobility",
  "acid soluble",
  "acid solution",
  "alkaline solution",
  "flow of electrons",
  "first stable product",
  "reduced co-enzyme",
  "fixation of co2",
  "primary fixation",
  "photosynthetic cycle",
  // Verb-phrase function descriptions, not named concepts (same class as
  // the bare-verb exclusions above):
  "synthesize proteins",
  "secrete proteins",
  // Generic descriptive phrase, not a single stable-definition concept:
  "exchange of genetic material",
  // Common-knowledge phrases/words needing no dictionary definition (same
  // class as "sun" above):
  "inanimate objects",
  "living organisms",
  "water molecule",
  // Bare "acceptor" is too polysemous/generic standalone across biology
  // (electron acceptor, CO2 acceptor, hydrogen acceptor, oxygen
  // acceptor...) — only meaningful with a qualifier.
  "acceptor",
]);

// A term containing "ncert" or exactly "neet" is always leaked citation
// text, never real vocabulary — safe to hard-block regardless of how it's
// mangled. stripCitations() should catch the clean form before the model
// ever sees it, but a model that garbles a citation into something
// unrecognizable (observed live: "ncertainc?") can still slip past
// input-side stripping; this catches it either way. "neet" is exact-match
// rather than substring — unlike "ncert" it's a real 4-letter word/acronym
// on its own, but nothing in the actual vocabulary space here would ever
// contain it as a substring, so exact-match is the more conservative
// choice. Also verified live to be a genuine whack-a-mole: the exam-year
// citation this catches ("[NEET 2021]", "(NEET2019)", ...) has already
// been observed in three different bracket/spacing styles across
// different questions in the same bank — this filter is the backstop for
// whichever shape stripCitations() hasn't been taught yet.
const CITATION_LIKE = /ncert/i;
const isCitationLeak = (term) => CITATION_LIKE.test(term) || term === "neet";

// Consistency pass: the AI's own per-question judgment about which terms
// are "worth extracting" isn't perfectly deterministic — the same word,
// meaning the same thing, can get extracted in one question and skipped in
// a near-identical one (verified live: question 631's bullet/wooden-block
// problem extracted "initial velocity"/"final velocity" but not bare
// "velocity", even though the question literally introduces "velocity u"
// as a variable). Once a term is an ESTABLISHED dictionary entry for a
// subject, any future question in that same subject containing that exact
// word/phrase should reliably get it too — otherwise the same concept ends
// up tappable in one question and not another for no principled reason,
// which is confusing for a student and was reported directly as an issue.
// `\b` word-boundary matching (not a bare substring check) so a short known
// term like "cell" doesn't spuriously match inside an unrelated word.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findKnownTermsInText = (text, knownTerms) => {
  if (!knownTerms || knownTerms.length === 0) return [];
  return knownTerms.filter((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text));
};

// One AI call per question — replaces the old rule-based extraction, which
// could only filter by word length/a fixed stopword list and had no way to
// tell "mitochondria" (worth explaining) apart from "containing" (not).
// An LLM can actually judge technical-vs-everyday, which is the point.
//
// `knownTerms` (optional): already-established dictionary terms for this
// question's subject — see the consistency-pass comment above. Callers
// (dictionaryBatchRunner.js) fetch this once per batch, not per question.
const extractKeywordsWithAI = async (questionText, hintText, knownTerms = []) => {
  const cleanQuestion = stripCitations(stripLatex(stripHtml(questionText)));
  const cleanHint = stripCitations(stripLatex(stripHtml(hintText)));

  const { system, prompt } = buildKeywordExtractionPrompt(cleanQuestion, cleanHint);
  // Bumped from 400 — the prompt now allows up to 12 terms (was 10) plus
  // few-shot examples in the system prompt push the model toward longer,
  // more thorough completions; same class of truncation risk already hit
  // and fixed for chat (700 -> 1500).
  const result = await runTask("keywordExtraction", { system, prompt, maxTokens: 600, jsonMode: true });
  const parsed = parseJsonResponse(result.text);

  const rawTerms = Array.isArray(parsed.terms) ? parsed.terms : [];
  const aiTerms = rawTerms
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean)
    .filter((t) => !LATEX_LIKE.test(t))
    .filter((t) => !SINGLE_CHAR.test(t))
    .filter((t) => !FORMULA_NOTATION.test(t))
    .filter((t) => !isFormulaFragment(t))
    .filter((t) => !GENERIC_NOUNS.has(t))
    .filter((t) => !isCitationLeak(t));

  const consistencyTerms = findKnownTermsInText(`${cleanQuestion} ${cleanHint}`, knownTerms);

  return [...new Set([...aiTerms, ...consistencyTerms])];
};

module.exports = { extractKeywordsWithAI };
