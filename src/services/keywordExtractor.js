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
  // From a biotechnology batch (sewage/biogas treatment, biofertilizers/
  // biopesticides, and genetic-engineering lab techniques — restriction
  // enzymes, transformation, cloning vectors, bioreactors), ids
  // ~34980-35194. Common-knowledge phrase (same class as "sun"/"living
  // organisms" above):
  "living systems",
  // Modifier + generic-tail-noun descriptive phrases, not headwords, most
  // lifted from question-stem or hint narration: "inlet" (a biogas
  // plant's dung-slurry inlet — too generic standalone, any tank has an
  // inlet), "microbial origin" ("enzymes of microbial origin" is the
  // question's own framing), "sustainable ecosystems"/"ecosystem
  // sustainability" (generic descriptive outcome of organic farming),
  // "molecular analogues" (one descriptive fragment lifted from the EFB's
  // formal definition of biotechnology, not itself a distinct concept),
  // "dna entry"/"gene recovery"/"temperature shift"/"membrane pores"
  // (generic descriptions of steps already covered by the real specific
  // terms — competent cells, heat shock, copy number, origin of
  // replication), "buffer conditions" ("optimal buffer conditions" is a
  // generic lab-procedure descriptor), "genetic manipulation" (generic
  // descriptive framing of what modern biotech "involves", not the
  // question's actual tested concept).
  "inlet",
  "microbial origin",
  "sustainable ecosystems",
  "ecosystem sustainability",
  "sustainability",
  "molecular analogues",
  "dna entry",
  "gene recovery",
  "temperature shift",
  "membrane pores",
  "buffer conditions",
  "genetic manipulation",
  // Bare generic word, and bare adjective/noun-form duplicates of a more
  // specific compound already established in the same batch: "fragments"
  // (DNA fragments, too vague standalone), "competent"/"competency"
  // (alongside "competent cells"/"competent host cell preparation"),
  // "disarmed" (alongside "disarmed pathogen"/"disarmed vector"),
  // "precipitate" (alongside "precipitate purified DNA" — DNA
  // precipitation is the specific step; bare "precipitate" is a generic
  // chemistry verb/noun), bare "uv" (too terse an abbreviation to stand
  // alone as a headword).
  "fragments",
  "competent",
  "competency",
  "disarmed",
  "precipitate",
  "uv",
  // Sub-details of restriction-enzyme nomenclature that only make sense
  // in the context of the umbrella concept already established as its
  // own term ("nomenclature of restriction enzymes") — not independently
  // meaningful headwords on their own.
  "sequence of isolation",
  "isolation order",
  "strain letter",
  // Field names mentioned only in passing as context/contrast, not the
  // question's actual tested concept — same exclusion the prompt already
  // applies (e.g. the Katherine Esau zoology/plant-biology example):
  // Mendel's "classical genetics" is contrasted against biotechnology,
  // and "molecular genetics" is the field a discovery "revolutionised",
  // neither is what either question actually tests (Hind II /
  // recombinant DNA technology pioneers).
  "classical genetics",
  "molecular genetics",
  // From a redox-titration/equivalent-weight chemistry batch + an IUPAC-
  // nomenclature batch + an electronic-effects batch (hyperconjugation,
  // resonance, nucleophile/electrophile), ids ~37229-37392. Modifier +
  // generic-tail-noun descriptive phrases and question/formula narration,
  // not headwords: "acid medium"/"alkaline condition" (same class as the
  // already-blocked "acid solution"/"alkaline solution"), "metal
  // reactivity" (paraphrase of the already-established "reactivity
  // series"), "electrons transferred"/"electron loss" (narration
  // restating what n-factor/valence factor already covers), "oxidizing
  // behaviour" (paraphrase of "oxidizing agent"), "arrangement of
  // atoms"/"energy content" (two items from the same textbook list of
  // resonance-structure criteria, generic descriptive fragments),
  // "temporary effect" (a defining characteristic of "electromeric
  // effect", already a separate established term), "stability order"
  // (generic ranking-comparison framing, not a stable concept — could
  // apply to any set of structures), "unsaturated group" (generic
  // category reference, "benzene or unsaturated group").
  "acid medium",
  "alkaline condition",
  "metal reactivity",
  "electrons transferred",
  "electron loss",
  "oxidizing behaviour",
  "arrangement of atoms",
  "identical arrangement of atoms",
  "energy content",
  "same energy content",
  "temporary effect",
  "stability order",
  "unsaturated group",
  // Bare generic word/verb-form duplicates of an already-established more
  // specific term: "oxidise" (alongside "oxidation"/"oxidizing agent"),
  // "stabilization" (vague without a qualifier — the real mechanisms are
  // "hyperconjugation"/"resonance", both separate established terms).
  "oxidise",
  "stabilization",
  // Etymological glosses of the real established terms, not headwords in
  // their own right: "nucleus seeking" and "electron seeking" are the
  // literal English meanings of "nucleophile"/"electrophile" (already
  // established), lifted from an analogy-question's explanatory hint.
  "nucleus seeking",
  "electron seeking",
  // Ambiguous/incomplete phrase — a garbled fragment of the real named
  // IUPAC concept (seniority/priority order of functional groups), not
  // independently meaningful (same class as "law of conservation" above).
  "prior group",
  // Spelling/synonym-variant consolidation (same pattern as "10% law"):
  // four different names for the exact same redox-chemistry concept
  // fragmented the dictionary across near-duplicate entries. Standardized
  // on the hyphenated "n-factor" form (the standard NCERT/JEE-NEET term);
  // blocking the unhyphenated and synonym duplicates.
  "n factor",
  "valence factor",
  "valency factor",
  // Word-order duplicate of the same IUPAC nomenclature concept —
  // standardized on "word root" (NCERT's own phrasing).
  "root word",
  // "Balancing chemical equations" turned out to be genuine whack-a-mole
  // rather than a stable headword: verification alone surfaced 5
  // different grammatical variants across a handful of redox-titration
  // questions ("balance chemical equation", "balancing chemical
  // equations", "balancing of chemical equations", "balanced chemical
  // equation", "balancing chemical equation") — it's boilerplate
  // narration for how the hint arrives at its answer ("we will balance
  // each half-reaction..."), not a specific concept with one stable
  // definition the way "n-factor" is. Blocking every variant seen rather
  // than picking one canonical form.
  "balance chemical equation",
  "balancing chemical equations",
  "balancing of chemical equations",
  "balanced chemical equation",
  "balancing chemical equation",
  "balancing",
  "balanced chemical reaction",
  // From a chemical-bonding chemistry batch (VSEPR/hybridization, valence
  // bond theory, molecular orbital theory, ionic bonding/lattice energy),
  // ids ~50168-50241 — an extremely vocabulary-dense chapter where most
  // terms are genuinely specific and correctly kept. Modifier +
  // generic-tail-noun descriptive phrases and narration, not headwords:
  // "transfer of electrons" (paraphrase of ionic bond formation),
  // "attractive forces" (too vague standalone — many specific force
  // types exist), "intramolecular attraction" (generic, real terms are
  // "intramolecular/intermolecular hydrogen bonding"), "vector
  // cancellation" (generic vector-math description, real term is "net
  // dipole moment"), "region of electron density" (generic paraphrase of
  // "electron domain"/"electron pair geometry"), "water
  // solubility"/"thermal stability" (generic comparative properties, same
  // class as "stability order" above — not one stable chemistry concept).
  "transfer of electrons",
  "attractive forces",
  "intramolecular attraction",
  "vector cancellation",
  "region of electron density",
  "water solubility",
  "thermal stability",
  // Bare generic word/phrase, too vague standalone without a qualifier:
  // "directional" (hybrid orbitals "are directional" — a property
  // description, not a concept), "magnetic status" (the real terms are
  // "paramagnetic"/"diamagnetic"), "electrostatic charge" (redundant with
  // the more precise "electronic charge", kept as the real constant).
  "directional",
  "magnetic status",
  "electrostatic charge",
  // Question-specific structural description tied to one particular
  // molecule (ozone's central oxygen atom), not a general reusable
  // concept — "central atom" in Lewis structures is the real general
  // VSEPR concept.
  "central oxygen atom",
  // From a DC-circuits physics batch (Kirchhoff's laws, Wheatstone
  // bridge, meter bridge, cells in series/parallel, resistivity
  // temperature dependence, power transmission), ids ~51009-51072.
  // Modifier + generic-tail-noun descriptive phrases and narration, not
  // headwords: "orientation alignment" (redundant combo, question-stem
  // paraphrase), "unbalanced resistance distribution" (paraphrase of
  // Wheatstone-bridge sensitivity, no established meaning of its own),
  // "high-voltage power systems" (redundant with "high-voltage
  // transmission"/"power transmission"), "battery arrangement" (redundant
  // with "mixed grouping"), "electrical load" (redundant with the more
  // specific "external load resistor"), "reversed polarity" (self-
  // explanatory English, needs no dictionary definition — same class as
  // "sun" above).
  "orientation alignment",
  "unbalanced resistance distribution",
  "high-voltage power systems",
  "battery arrangement",
  "electrical load",
  "reversed polarity",
  // Physical apparatus/hardware mentioned only as the cause of "end
  // errors" (the real, established concept) in a meter-bridge
  // experiment — concrete real-world components, not conceptual
  // vocabulary, same class as scenario-props like train/lamp/watermelon:
  "metallic brackets",
  "copper strips",
  "contact joints",
  "gap resistances",
  "resistance gaps",
  "geyser",
  // Garbled/malformed extraction (literal typo artifact, "box/box") —
  // duplicates the clean "post office box" already established.
  "resistance post office box/box",
  // Discovered via a post-run mapping-backfill spot check (2026-08-25):
  // bare English function words extracted as "terms" from a Boolean-logic
  // question ("NAND/NOR gates realize the NOT, AND, and OR operations")
  // — defensible in that ONE question (they ARE naming the three logic
  // operations), but as bare lowercase words they collide with ordinary
  // English grammar and get mass-mismatched against completely unrelated
  // questions by both the AI's own fresh judgment AND any future
  // consistency-pass/backfill matching (verified: deleting these 8 entries
  // removed 17,563 contaminated mappings — 17% of everything the backfill
  // had just added). The real, safe way to capture "AND gate"/"OR gate"/
  // "NOT gate"/"boolean operation" is via those actual compound forms,
  // never the bare word. Also includes two abbreviation collisions found
  // in the same sweep — "no" (meant NO/nitric oxide) and "who" (meant
  // WHO/World Health Organization) — same problem, bare lowercase form
  // is indistinguishable from the common English word.
  "and",
  "or",
  "not",
  "high",
  "low",
  "who",
  "do",
  "no",
  // From the Test Series pipeline's first quality scan (2026-08-26) —
  // same established classes, confirming the extraction/filter logic
  // generalizes cleanly to this second question source. "soap-box-like
  // structure" is a descriptive simile from the hint (diatom cell walls
  // "have a distinctive soap-box-like structure"), not a named structure
  // of its own. "biochemical pathway" is one generic item in a list of
  // differentiating factors ("genetic makeup, cell wall composition,
  // biochemical pathways"), not a distinct concept.
  "soap-box-like structure",
  "biochemical pathway",
  "biochemical pathways",
  // "current carrying cable" is apparatus description from a word problem
  // (a thick current-carrying cable of radius R...), same scenario-prop
  // class as the already-blocked bare "wire" above — the real concept
  // (Ampere's circuital law / magnetic field variation) is captured
  // separately.
  "current carrying cable",
  // Generic descriptive phrase from hint narration ("They contain protein
  // synthesis machinery"), collectively describing DNA+ribosomes rather
  // than naming a distinct structure — same modifier+generic-tail-noun
  // class as "biochemical pathway" above.
  "protein synthesis machinery",
  // Generic bare words, too vague standalone: "defence" (one item in a
  // list — "function mainly in defence, protection..."), "response" (one
  // item in a generic list of life processes — "metabolism, growth,
  // reproduction and response"). "linked dna" is a context-specific
  // descriptive phrase from a question stem about a cloning vector's
  // origin of replication, not a general reusable concept.
  "defence",
  "response",
  "linked dna",
  // "stopping point" is formula-derivation narration ("at stopping point
  // v=0, so distance becomes..."), not a named concept — the real term
  // would be "stopping distance". "artificial induction" is a redundant
  // duplicate of the already-established "induction of flowering" with a
  // modifier that adds no distinguishing meaning. "industrial production"
  // is a generic modifier+noun combo (production of WHAT — the real
  // content here is "citric acid production" via Aspergillus niger).
  "stopping point",
  "artificial induction",
  "industrial production",
  // Combines kept "growth" with the already-blocked bare "processes" —
  // same modifier+generic-tail-noun pattern.
  "growth processes",
  // Formula-derivation narration ("force on one plate due to the other is
  // F=..."), not a named concept — the real captured concepts are
  // "electrostatic force"/"electric field".
  "force on a plate",
  // Descriptive simile from hint narration ("It forms a U-shaped
  // structure"), describing vasa recta's shape — not a distinct named
  // structure of its own, same class as "soap-box-like structure" above.
  "u-shaped structure",
  // Bare "key" is too polysemous/risky standalone: contextually valid in
  // ONE biology question (a "key" for taxonomic identification, a real
  // term), but the physics-subject entry it also produced was describing
  // a literal metal door key (common-knowledge, wrong for a dictionary) —
  // confirmed real contamination (6 and 49 mappings respectively across
  // unrelated questions before being caught and deleted). Same class as
  // "and"/"or"/"not"/"who"/"do"/"no" above.
  "key",
  // Generic descriptive fragments from the same hint ("faster energy
  // production, which is essential for activities like running uphill") —
  // "energy production" matches the already-established "production"
  // generic-tail-noun pattern; "muscular activity" is an AI paraphrase of
  // the scenario ("running uphill"), not a distinct concept.
  "muscular activity",
  "energy production",
  // Bare adjective (sexual phases/asexual phases — too vague alone,
  // "sexual reproduction" would be the real specific compound) and bare
  // generic noun (outgrowths of WHAT — insect wings "arise as outgrowths
  // of the body", too vague standalone).
  "sexual",
  "outgrowths",
  // Formula-derivation narration ("Using rotational equation: Tr=Iα"),
  // not a named concept — the real captured concepts are torque/moment
  // of inertia/angular acceleration.
  "rotational equation",
  // Generic category description used to define a specific named concept
  // ("Vexillary aestivation is a type of petal arrangement..."), not a
  // headword itself — the real specific terms are "aestivation"/
  // "vexillary aestivation". Bare "intracellular" (most abundant
  // intracellular cation) is too vague alone, contrasted with the real
  // specific compartment terms "intracellular fluid"/"extracellular
  // fluid".
  "petal arrangement",
  "intracellular",
  // "initiation site" is a generic/redundant paraphrase of "promoter
  // region"/"start site of transcription" (both already separately
  // captured). "continuous dna strand" describes the OUTCOME of DNA
  // ligase joining Okazaki fragments, not a distinct concept — the real
  // established terms (Okazaki fragments, lagging strand, DNA ligase) are
  // already separate.
  "initiation site",
  "continuous dna strand",
  // Bare "repeats" is one generic item in a list of satellite-DNA
  // classification factors ("length, base composition and number of
  // repeats"), too vague standalone.
  "repeats",
  // "ancestor" bare is too generic/common-knowledge on its own (everyone
  // knows what an ancestor is; "common ancestor" as a compound would be
  // the real specific evolutionary-biology concept). Bare "primary" (the
  // vascular cambium is "completely primary in origin") is a generic
  // adjective, too vague alone. "striped appearance" is a descriptive
  // restatement of "striated muscle" (already a separate established
  // term), not a distinct concept.
  "ancestor",
  "primary",
  "striped appearance",
  // Bare past-tense verb form describing the action performed ("A
  // solution of copper sulphate is electrolysed for 10 minutes"), same
  // class as the earlier-blocked bare verb-forms "reacts"/"reduce" — the
  // real specific concept is the noun "electrolysis", already separate.
  "electrolysed",
  // "burrows" is a generic scenario detail (desert lizards escaping heat
  // by burrowing), not core vocabulary — the real specific concept
  // "behavioural thermoregulation" is already separate. "proliferative
  // cycle" is a redundant paraphrase of "cell cycle" (already
  // established), used to contrast against the quiescent G0 phase.
  // "ecological transfer law" is a fresh naming variant of the same
  // concept already standardized as "10% law" earlier this session
  // (Lindeman's 10% law) — same consolidation pattern as the "10 percent
  // law"/"ten percent law" duplicates blocked before.
  "burrows",
  "proliferative cycle",
  "ecological transfer law",
  "lindeman's ecological transfer law",
  "lindeman's law",
  "ecological transfer",
  // Bare "phase" (which metabolic phase — too vague alone, real term is
  // "g0 phase"/"cell cycle"). "transverse cross-section" describes the
  // lab viewing technique, not the actual biological content (monocot
  // stem vascular bundle arrangement). "alkaline environment" is the same
  // generic condition-descriptor shape as the already-blocked "acid
  // medium"/"alkaline condition".
  "phase",
  "transverse cross-section",
  "alkaline environment",
  // Generic measurement noun ("volume" is already excluded bare per the
  // prompt's own rule) with a modifier bolted on — same antipattern the
  // prompt already names, model just isn't applying it consistently.
  "total volume",
  "solution volume",
  // Descriptive narration/category phrases, not named concepts themselves.
  "maximum possible percentage error",
  "permissible values",
  "storage body",
  "storage bodies",
  "partial breakdown",
  // Scenario variable-label, not a concept (M in v_e = sqrt(2GM/R)).
  "mass of the planet",
  // Bare narration verb ("the negative half cycles are inverted").
  "invert",
  // Formula variable spoken as a phrase (Δn_g), same class as "v squared".
  "delta ng",
  // Bare, too generic standalone (threshold potential/value/frequency all
  // mean different things) — same pattern as other blocked bare nouns.
  "threshold",
  // Garbled/truncated fragment, not a real word.
  "zo",
  // Another AI-invented paraphrase of the standardized "10% law" that
  // slipped past the durable prompt rule added for this exact concept.
  "lindeman's law of energy transfer",
  // Describes what "lyases" do (the real term), not a distinct concept.
  "bond cleavage by elimination",
  // Exact match to the prompt's own "structural adaptation" antipattern
  // example — the real term is the named concept ("allen's rule").
  "anatomical adaptation",
  // Describes the count of heterozygous loci in this specific problem,
  // not a stable vocabulary term ("heterozygous" is the real term).
  "heterozygous gene pairs",
  // Substance name + "medium" — same generic-condition shape as the
  // already-blocked "acid medium"/"alkaline condition".
  "water medium",
  // Describes the mathematical shape of a formula's variation, not a
  // named physics concept.
  "sinusoidal dependence",
  // Generic noun+noun descriptive combo; real term is "convection".
  "density difference",
  // Generic measurement-quantity descriptor (Hooke's law elongation);
  // same class as already-excluded bare "length"/"distance".
  "linear extension",
  // Word-problem apparatus/shape descriptor, not a concept (real term:
  // magnetic field due to a straight current-carrying conductor).
  "straight cylindrical wire",
  // Generic descriptive combo, not a specific concept.
  "force magnitude",
  // Not the standard textbook term (elastic limit/breaking stress/yield
  // point) — an invented paraphrase.
  "breaking limit",
  // Same narration-phrase pattern already blocked as "maximum possible
  // percentage error" — model produced another wording of it.
  "maximum calculated percentage error",
  // Generic modifier+noun, not a specific concept (real terms: RNAi,
  // siRNA, dsRNA).
  "host tissue",
  // Paraphrases what "phylloclades" (the real, already-captured term) is
  // defined as, rather than being its own concept.
  "photosynthetic stem",
  // Bare verb ("before it fractures") — real term is "breaking stress".
  "fractures",
  // Narration describing a derived quantity in one specific tank-draining
  // problem, not a stable concept (real concept: Torricelli's theorem).
  "draining time",
  "discharge rate",
  // Tautological/redundant phrase (altitude IS height); real concept is
  // variation of g with altitude.
  "altitude height",
  // Narration about emission timing, not a standalone concept (real term:
  // photoelectric effect/threshold frequency).
  "instantaneous process",
  // Describes a measured count specific to one question's statement list,
  // not vocabulary — same class as already-blocked "heterozygous gene pairs".
  "number of photoelectrons",
  // Describes a graph's shape, not a concept — same class as already-
  // blocked "sinusoidal dependence".
  "parabolic variation",
  "asymptotic approach",
  // Paraphrase/label for the literal reaction in this specific problem,
  // not a standard named reaction category (unlike "combustion reaction").
  "water formation reaction",
  // Generic apparatus/scenario descriptor (open vs. closed container);
  // real concept is Gibbs free energy/spontaneity.
  "open vessel",
  // Modifier+generic-noun scenario descriptor; real concept is nuclear
  // radius/mass number.
  "spherical atomic nucleus",
  // Misspelling of the already-correct "avena coleoptile" (Avena is the
  // oat genus in F.W. Went's auxin discovery) — garbled duplicate.
  "avenia coleoptile",
  // Generic hormone-category description (what ABA/ethylene are), not a
  // distinct concept — same antipattern as the already-blocked "growth
  // antagonist"; real terms are "abscisic acid"/"ethylene".
  "plant growth inhibitor",
  "gaseous plant hormone",
  // Bare narration verbs ("conditions solubilize and activate the protoxin").
  "solubilize",
  "activate",
  // Bare adjective, no noun.
  "homeostatic",
  "non-vascular",
  // Narration/descriptive phrase about an already-captured concept, not a
  // headword itself.
  "nearly universal",
  "root modifications",
  "energy ratio",
  "extreme displacement",
  "conducting ions",
  "gaseous atom",
  "universal anaerobic pathway",
  "native aquatic plants",
  // Generic category name where the real specific term is already
  // captured separately (e.g. "logistic growth curve", "electron gain
  // enthalpy", "electric field inside a conductor", "reflection"/
  // "refraction"/"polarisation").
  "population growth model",
  "optical phenomena",
  "closed loop path",
  "charged conducting sphere",
  "metallic bar",
  // Misspelling of the already-correct "chargaff's rule".
  "chargedaff's rule",
  // Bare, too generic standalone.
  "tumors",
  "light rays",
  "vision",
  // Describes what an already-captured named structure/concept IS or
  // does, not a distinct headword ("titillator", "secondary structure of
  // proteins", "signal recognition particle").
  "external asymmetry",
  "helical arrangement",
  "signal recognition",
  // Generic modifier+noun descriptor; real named structure differs
  // (vasa efferentia/ureters).
  "urinary ducts",
  // Redundant grammatical-form duplicate of the already-established
  // "cell-surface receptors".
  "cell membrane receptors",
  // Not standard terminology for this concept (real term: "codominance"/
  // "lac operon"/"negative regulation").
  "codominant expression",
  "negative repressor system",
  // Scenario variable-label ("the Volume of the Wire remains constant"),
  // same class as already-blocked "mass of the planet".
  "volume of the wire",
  // Narration labeling a variable in one kinematics/scenario problem, same
  // class as already-blocked "instantaneous process"/"draining time".
  "instantaneous position",
  "penetration distance",
  // Narration describing the numeric outcome/count of a specific
  // calculation, not stable vocabulary — same class as already-blocked
  // "heterozygous gene pairs"/"number of photoelectrons".
  "linear dna fragments",
  "chromosome count",
  // Bare, too generic standalone.
  "detection",
  "positive ion",
  // Generic category label where the real specific answer is already
  // captured separately (real terms: phaeophyceae, GPP/primary
  // productivity).
  "algal class",
  "organic matter production",
  "plant taxonomy",
  // Extremely broad generic descriptive combo, not a distinct concept.
  "metabolic reaction",
  "eye movement",
  "cascade of intracellular reactions",
  "intracellular signaling pathways",
  "molecular aggregates",
  // Bare adjective, no noun.
  "mutable",
  "viral",
  "sporophytic",
  "non-reducing",
  // Math/formula-derivation narration, not subject vocabulary (quadratic
  // root-sum rule, error-propagation power rule).
  "sum of roots",
  "powers",
  // Narration describing this specific problem's setup/outcome, not a
  // stable concept (real terms: shear modulus, coulomb's law, resistivity
  // formula, geostationary satellite orbit).
  "direction of rotation",
  "shape change",
  "uniform stretching",
  "zero net force",
  // Graph-direction descriptor, same class as already-blocked "parabolic
  // variation"/"sinusoidal dependence"; real term is "bohr effect".
  "leftward shift",
  // Rephrased duplicate of the already-blocked "charged conducting sphere".
  "hollow charged spherical conductor",
  // Generic descriptive noun about a naming-convention rule; real term is
  // "binomial nomenclature".
  "capitalization",
  // Misspelling/duplicate of the already-correct "aqueous solution".
  "aquaous solution",
  // Word-problem apparatus/scenario descriptor; real concept is
  // conservation of linear momentum / recoil.
  "rifle-bullet system",
  // Paraphrases what "analogous organs"/convergent evolution already
  // captures.
  "structural plan",
  // Bare/generic, duplicate of the already-blocked "intracellular
  // signaling pathways".
  "signaling pathways",
  // Narration describing this specific genetics problem's outcome, not
  // vocabulary — same class as already-blocked "heterozygous gene pairs".
  "phenotypically normal",
  // Bare noun, too generic (verb-derived, no stable independent meaning).
  "activation",
  // Bare adjectives, no noun (genetic-code / aestivation descriptors).
  "non-overlapping",
  "overlapping",
  // Redundant grammatical-form duplicate of the already-established
  // "charge independence".
  "charge independent",
  // Generic property descriptor; the real named concept is already
  // captured as "nuclear force"/"nuclear forces".
  "short-range forces",
  // Bare, too generic/everyday (electrolysis context still doesn't make
  // this a distinct headword).
  "water molecules",
  // Narration ("not directly from experimental rate data"), not vocabulary.
  "rate data",
  // Redundant vs. the already-established acid/base/amphoteric/neutral
  // oxide classification (the real specific categories).
  "metallic oxide",
  // Descriptive property phrase ("strong oxidising nature"); real
  // concept is electron affinity/halogen group trend.
  "oxidizing nature",
  // Narration for one ozonolysis workup step, not a distinct concept
  // (real concept: ozonolysis, already established).
  "reductive treatment",
  // Word-problem scenario prop describing droplet shape/count in this
  // specific surface-energy calculation, not a concept.
  "spherical droplet",
  // Narration describing a computed fraction in this specific half-life
  // problem, not vocabulary (real concept: half-life/radioactive decay).
  "active nuclei",
  // Generic modifier+common-noun descriptor ("heart" is everyday English,
  // doesn't need NEET-dictionary explanation); real distinguishing
  // chordate features are notochord/dorsal nerve cord.
  "muscular heart",
  // Common everyday device name, no NEET-specific definition needed (same
  // EXCLUDE rule as other everyday-English terms); real tested fact is
  // the germicidal action of UV rays.
  "water purifier",
  // Yet another AI-invented paraphrase of the standardized "10% law"
  // slipping past the durable prompt rule — even though the source
  // question itself names it "Lindeman's Ten Percent Law", the prompt
  // rule normalizes to the one standard name.
  "lindeman's ten percent law",
  // Bare narration verb, no noun. Pre-existing entry from before this
  // session (7 mappings) — small enough to delete outright rather than
  // flag for the full-sweep.
  "hydrolyse",
  // Generic descriptor of the invasive species already captured as "nile
  // perch"/"cichlid".
  "predatory fish",
  // Paraphrase of the already-captured "pneumatophores", same class as
  // already-blocked "root modifications".
  "stem modifications",
  // Generic category label, not a distinct concept.
  "metabolic regulation",
  // Narration ("reducing sperm motility and fertilizing ability"), not a
  // distinct concept.
  "fertilizing ability",
  // Generic category label for Vmax/Km (the real, already-captured
  // specific terms).
  "kinetic parameters",
  // Narration describing a test-cross result, not vocabulary.
  "recombinant combinations",
  // Redundant synonym duplicate of the already-established "axon".
  "nerve fiber",
  // Narration describing Raoult's-law deviation, not a distinct concept.
  "ideal behavior",
  // Duplicate/synonym of the already-blocked "reductive treatment".
  "reductive workup",
  // Narration describing this specific magnetic-field-radius formula
  // problem, not vocabulary.
  "radius of circular motion",
  // Narration fragment ("mass behaves as if concentrated at the center").
  "concentrated at the center",
  // Generic measurement descriptor, same class as already-excluded bare
  // "distance"/"length".
  "mean distance",
  // Bare adjective, no noun (image type).
  "virtual",
  // Narration comparing apparent vs. actual frequency; real concept is
  // the already-captured "doppler effect".
  "actual frequency",
  // Narration describing the already-established "static friction"'s
  // property, not a distinct concept.
  "self-adjusting nature",
  // Narration describing this specific mitosis-count calculation, not
  // vocabulary.
  "cell number doubling",
  "cell colony",
  // Bare adjective, no noun (parental phenotype).
  "parental",
  // Narration/descriptive detail of the already-captured "marginal
  // placentation", not a distinct concept.
  "longitudinal ridge",
  // Generic paraphrase duplicates of the already-established "aneuploidy".
  "chromosomal numerical abnormality",
  "numerical abnormality",
  // Redundant grammatical-form duplicate of the already-established
  // "autosome".
  "autosomal chromosome",
  // Too generic/everyday; real concept is the already-captured
  // "eutrophication".
  "suffocation",
  // Narration describing Broca's aphasia's symptom, same class as
  // already-blocked descriptive-symptom phrases; real term "broca's
  // aphasia" already captured separately.
  "fluent speech",
  // Narration describing mycorrhiza's host, not a distinct concept; real
  // term "mycorrhiza" already captured.
  "higher terrestrial plants",
  // Historical-era reference used only as context, not a NEET biology
  // concept itself; real concept is "industrial melanism"/natural
  // selection.
  "industrial revolution",
  // Generic combo describing part of the electron transport chain's
  // function, not a distinct concept.
  "oxygen reduction",
  // Narration describing the source of glycerol as a by-product, not a
  // distinct concept; real concept is "distillation under reduced
  // pressure".
  "soap manufacture",
  // Generic ecological category label, not the actual specific concept
  // being tested (Gause's Competitive Exclusion Principle/niche).
  "community structure",
  // Generic modifier+noun ("affinity" alone isn't a headword); real
  // concept is the already-captured Km/competitive inhibition mechanism.
  "substrate affinity",
  // Factually wrong/hallucinated — the source question is about
  // "downstream processing", not "upstream production"; a garbled
  // invention, not a real term.
  "upstream production phase",
  // Narration for the WRONG-answer option in this specific question
  // (gibberellin's actual effect, "internodal growth", is kept
  // separately); a generic descriptive phrase, not a headword.
  "lateral root inhibition",
  // Generic scenario descriptor for where methanogens live; real concept
  // is "methanogens"/"rumen", already captured.
  "gut of ruminant animals",
  // Narration describing convex-lens virtual-image formation, not a
  // distinct concept.
  "refracted rays",
  // Generic apparatus/scenario descriptor (free expansion into vacuum),
  // not a distinct concept.
  "isolated container",
  // Redundant restatement/duplicate of the already-established
  // "archimedes' principle"/"buoyant force".
  "weight of displaced fluid",
  // Narration fragment describing geostationary satellite direction, not
  // vocabulary.
  "west to east",
  // Narration paraphrasing the Amazon rainforest's photosynthetic role,
  // not a distinct concept.
  "atmospheric oxygen balance",
  // Generic paraphrase of the already-captured "semicircular canals"/
  // vestibular apparatus; "dynamic equilibrium" alone is too generic.
  "dynamic equilibrium",
  // Narration for a specific RQ calculation, not vocabulary.
  "carbon dioxide production",
  // Generic paraphrase of the already-captured
  // "productivity"/"primary productivity" concept.
  "photosynthetic production",
  // Narration/generic descriptor for the origin-of-life timeline, not a
  // distinct concept.
  "organismal diversification",
  // Generic category descriptor; real term "phenylketonuria" already
  // captured.
  "metabolic disorder",
  // Generic combo contrasted with polycistronic mRNA; not itself a
  // distinct headword.
  "eukaryotic genes",
  // Generic category redundant with the already-captured, more specific
  // IUD/copper-releasing-IUD terms.
  "contraceptive device",
  // Redundant/incomplete grammatical duplicate of the already-established
  // "polarizing power" (bare adjective, no noun).
  "polarizing",
  // Word-problem scenario condition ("if a person shifts to..."), not a
  // distinct concept.
  "high-protein diet",
  // Garbled misreading of the source text's "ADH" (already an established
  // term) — not a real distinct term.
  "adg",
  // Narration describing AV-node delay before ventricular activation, not
  // a distinct concept; real terms (AV node, PR interval) already
  // captured.
  "ventricular activation",
  // Formula-component narration for the already-captured "respiratory
  // quotient" definition, not standalone vocabulary.
  "oxygen consumed",
  "carbon dioxide evolved",
  // Generic descriptive combo listing one of proteins' functions, not a
  // distinct concept.
  "enzymatic catalysis",
  // Narration describing this specific first-order-reaction calculation.
  "completion time",
  // Narration describing the hyperconjugation mechanism, not a distinct
  // concept; real term "hyperconjugation" already captured.
  "adjacent bonds",
  // Paraphrase duplicate of the already-established "heat loss".
  "thermal losses",
  // Generic descriptive combo; real concepts ("fluid mosaic model",
  // "membrane fluidity") already captured.
  "protein mobility",
  // Garbled/truncated duplicate of the already-established "iui".
  "iu",
  // Nickname/paraphrase duplicate of the already-established "adhering
  // junctions".
  "cellular cement",
  // Generic descriptive duplicate of the already-established
  // "obelia"/"metagenesis".
  "colonial hydrozoan",
  // Historical-event reference used only as context, not itself a
  // biology concept; real concept is "late blight of potato"/oomycete.
  "great irish famine",
  // Common everyday word/process, no NEET-specific definition needed.
  "brewing",
  // Generic paraphrase/category label for the already-established
  // "oxidation"/"reduction" definitions.
  "electron-transfer concept",
  // Generic descriptor of binomial-nomenclature convention, same class as
  // already-blocked "capitalization".
  "latinised name",
  // Duplicate of the already-established "specific epithet".
  "species name",
  // Narration about naming-convention formatting rules, not headwords.
  "italicized",
  "italicization",
  "underlining",
  "italic",
  "author's name",
  // Generic descriptive phrase from the definition of "systematics"
  // (already captured), not a distinct concept.
  "diversity of organisms",
  // Generic category label; the real specific bacterial-nutrition modes
  // are already captured individually.
  "nutritional modes",
  "bacterial nutrition",
  // Generic descriptive phrase defining saprophytic/parasitic nutrition,
  // not distinct concepts (real terms already captured).
  "dead and decaying organic matter",
  "living hosts",
  "inorganic substrates",
  // Bare, too generic (describes a graph feature).
  "peak",
  // Narration describing stabilising selection's effect, not a distinct
  // concept.
  "extreme variants",
  // Generic combo describing the AV node's function; real term already
  // captured.
  "signal conduction",
  // Generic paraphrase duplicate of the already-captured "cytochrome
  // oxidase complex"/"complex iv".
  "terminal complex",
  // Generic combo; real term (SA node/pacemaker) already captured.
  "heart rhythm",
  // Sentence fragment, not a headword.
  "homo sapiens arose",
  // Misspelling duplicate of the already-established "engelmann".
  "englmann",
  // Narration describing the prion mechanism, not a distinct concept.
  "abnormal folding",
  // Food-example scenario prop; real term "vitamin k" already captured.
  "green leafy vegetables",
  // Common everyday food word used as an example, no NEET-specific
  // definition needed; pre-existing entry (16 mappings), small enough to
  // delete outright.
  "carrot",
  // Redundant duplicate of the already-established "metallic bonding".
  "interatomic metallic bonding",
  // Generic paraphrase duplicate of the already-established "low-spin
  // octahedral complex".
  "low-spin arrangement",
  // Generic combo describing an ideal-gas model assumption, not a
  // distinct concept.
  "spherical molecules",
  // Narration duplicate of the already-captured "forward bias"/"reverse
  // bias".
  "biasing conditions",
  // Redundant duplicate of the already-established "angle of banking"/
  // "banking of roads".
  "ideal banking",
  // Word-problem scenario prop (the racetrack itself), not a concept.
  "racetrack",
  "insulated floor",
  // Narration describing this specific elastic-collision scenario, not a
  // distinct concept.
  "equal masses collision",
  // Generic descriptive combo; real term "gamma rays" already captured.
  "penetrating waves",
  // Duplicate of the already-kept "germicidal action" (same UV fact,
  // different phrasing).
  "germicidal properties",
  // Redundant modifier — angular momentum already implies rotation.
  "rotational angular momentum",
  // Common/generic radio-broadcast abbreviations, no NEET-specific
  // definition needed.
  "fm broadcasting",
  "am",
  // Generic combo; real term "electromagnetic wave" already captured.
  "electromagnetic wave propagation",
  // Generic math/scaling concepts, not physics-specific vocabulary.
  "power of ten",
  "numerical magnitude",
  // Narration describing a specific Celsius-to-Fahrenheit calculation.
  "temperature conversion",
  // Generic, vague combo with no single stable definition; pre-existing
  // entry (19 mappings), small enough to delete outright.
  "chemical composition",
  // Generic descriptive combo/narration for Bohr-model energy levels, not
  // a distinct concept.
  "bound electron",
  "accelerated charged particle",
  // Generic combo describing canal-ray particles; real term "canal rays"
  // already captured.
  "positive particles",
  // Historical apparatus/detector-material descriptor, scenery for
  // Rutherford-era experiments.
  "zinc sulphide screen",
  // Narration describing this specific two-cars kinematics problem's
  // given data, not vocabulary.
  "initial separation",
  // Narration describing distance/displacement examples in this specific
  // matching question, not distinct concepts.
  "closed path motion",
  "curved path motion",
  // Math/graph-shape descriptor, same class as already-blocked "parabolic
  // variation"/"sinusoidal dependence".
  "quadratic function",
  // Incomplete/redundant duplicate of the already-established "gay-
  // lussac's law" (bare surname where the full law name is the concept).
  "gay lussac",
  // Generic category umbrella; the real specific individual gas laws are
  // captured separately.
  "gas laws",
  // Generic/common math concept (significant-figures rounding rule),
  // narration for one specific calculation.
  "decimal places",
  // Redundant fragment/incomplete duplicate of the already-established
  // "gay-lussac's law" (its full name is "...law of gaseous volumes").
  "gaseous volumes",
  // Bare adjective, no noun.
  "reproducible",
  // Redundant incomplete duplicate of the already-established "si base
  // quantity"/"si base quantities".
  "base quantity",
  // Generic category phrase; real terms (identification, nomenclature,
  // taxonomy) already captured separately.
  "taxonomical studies",
  // Common/generic example item (one of a list of mixtures), no NEET-
  // specific definition needed.
  "sugar solution",
  // Garbled fragment of the species name "Solanum tuberosum" (potato),
  // not a standalone term.
  "tuberosum",
  // Redundant incomplete duplicate of the already-established "si derived
  // units"/"si derived unit".
  "derived units",
  // Generic/plural umbrella phrase for binomial-nomenclature formatting
  // rules, same class as the already-blocked naming-convention leaks.
  "scientific names",
  // Incomplete/bare duplicate of the already-established "binomial
  // nomenclature".
  "binomial",
  // Bare, extremely generic — fails the core test entirely.
  "formula",
  // Bare, too generic (describes what early classification was based on).
  "utility",
  // Narration describing a quantum-number-rule violation, not vocabulary.
  "allowed range",
  // Generic category header (Column II label); the real specific answers
  // (ultraviolet/visible/infrared region) are the actual vocabulary.
  "spectral region",
  // Generic paraphrase duplicate of the already-established "dalton's
  // atomic theory"/"atomic theory".
  "atomic nature of matter",
  // Generic paraphrase duplicates of the already-established "taxonomic
  // hierarchy"/"taxonomic categories".
  "hierarchical categories",
  "taxonomic position",
  // Adjective-form paraphrase duplicates of the already-established
  // "principle of homogeneity of dimensions".
  "dimensionally homogeneous",
  "dimensionally consistent",
  // Bare, too generic (describes mitochondrial arrangement / electron
  // orbit shrinkage in different contexts) — flagged for the full-corpus
  // sweep on the large pre-existing biology entry; blocked here to stop
  // further contamination going forward.
  "spiral",
  // Redundant/generic descriptor of the already-captured "notochord".
  "axial support",
  // Bare adjective, no noun.
  "non-poisonous",
  "polypoid",
  // Generic descriptive combos (hagfish behavior), common English/generic
  // biology narration, not distinct headwords.
  "parasitic feeding",
  "scavenging",
  // Generic combo; real term "preen gland"/"oil gland" already captured.
  "skin gland",
  // Generic combo; real term "tympanum" already captured.
  "sound vibrations",
  // Generic combo describing a specific fish's defensive organ.
  "poisonous sting",
  // Generic paraphrase of the already-captured
  // "thermoregulation"/"homoiothermous".
  "thermoregulatory mechanisms",
  // Generic combo; real terms "gills"/"operculum" already captured.
  "pharyngeal region",
  // Generic category descriptor; the real specific example (Exocoetus)
  // already captured.
  "marine bony fish",
  // Generic combo; real term "calcium carbonate"/coral already captured.
  "calcareous skeletons",
  // Generic taxon-category descriptor (singular/plural); the real named
  // examples (Taenia, Fasciola) already captured.
  "parasitic flatworm",
  "parasitic flatworms",
  // Narration describing sexual dimorphism in Ascaris, not vocabulary;
  // real term "ascaris" already captured.
  "female ascaris",
  "male ascaris",
  // Generic category umbrella (this question's own topic header); the
  // real specific mappings (ovule→seed, ovary→fruit, etc.) are the
  // actual tested content.
  "post-fertilization development",
  // Generic descriptive shape phrase, not a distinct concept.
  "conical crown",
  // Generic combos describing mycorrhiza's function.
  "mineral nutrients",
  "absorptive area",
  // Generic combo; real term "vascular tissue" already captured.
  "vascular organs",
  // Generic category descriptor; the real specific named examples
  // (Spirogyra, Ulothrix) already captured.
  "filamentous green algae",
  // Generic combo, narration for a corrected-false statement.
  "flagellated stages",
  // Generic combo describing pyrenoid composition.
  "proteinaceous matrix",
  // Descriptive phrase from what taxonomic categories are NOT, not a
  // headword.
  "morphological aggregate",
  // One item in a list of industrial-use functions, generic combo.
  "stabilising agent",
  // Word-problem scenario descriptor.
  "infertile human couples",
  // Generic combo describing Planaria regeneration.
  "body fragments",
  // Generic, too broad/common concept.
  "body mass",
  // Generic descriptive phrase (modifier + generic noun "magnitude"),
  // narration for a specific null-vector problem.
  "equal magnitude",
  // Narration describing this specific river-crossing problem's setup.
  "perpendicular direction",
  // Narration describing vector components in a specific relative-
  // velocity problem, not vocabulary.
  "northward component",
  "westward component",
  // Generic math descriptor (Pythagorean-theorem-based magnitude calc),
  // same class as already-blocked "sum of roots".
  "pythagorean relation",
  // Redundant duplicate of the already-kept "trajectory equation" (same
  // path-equation concept, different question).
  "path equation",
  // Etymology trivia (the Latin root word "systema"), not a taxonomic
  // concept itself.
  "systema",
  // Too basic/common chemistry knowledge (element symbol notation),
  // equivalent to asking to extract "the answer" as a term.
  "atomic symbol",
  // Generic/redundant paraphrase; the real specific term "pauling scale"
  // already captured.
  "electronegativity scale",
  // Generic electron-shell terminology, no single stable definition on
  // its own.
  "inner shell",
  // Misspelling duplicate of the already-established "pauling scale".
  "pauline scale",
  // Redundant modifier-form duplicate of the already-established
  // "gametophyte".
  "male gametophytic generation",
  // Paraphrase duplicate of the already-established "archegonium".
  "female sex organ",
  // Paraphrase duplicate of the already-established "statocysts".
  "equilibrium organs",
  // Redundant modifier-form duplicates of the already-established
  // "regeneration".
  "regenerative ability",
  "true regeneration",
  // Redundant/paraphrase duplicates of the already-established
  // "phylogeny".
  "systematic relationship",
  "evolutionary phylogeny",
  // Paraphrase duplicate of the already-established "latin".
  "dead language",
  // Generic umbrella duplicates of the already-established individual
  // periodic-table blocks (s-block/p-block/d-block/f-block).
  "block of the periodic table",
  "periodic table block",
  // Paraphrase/redundant duplicate of the already-established "principal
  // quantum number".
  "principal quantum shell",
  // Redundant modifier-form duplicate of the already-established "time
  // period".
  "time period of revolution",
  // Paraphrase duplicates of the already-established "periodicity".
  "periodic function",
  "periodic variation",
  // Narration/paraphrase duplicate of the already-established "covalent
  // bond"/"lone pair".
  "shared pair of electrons",
  // Generic paraphrase duplicates of the already-established "coral
  // polyps".
  "colonial coral",
  "colonial form",
  "colonial structure",
  // Paraphrase duplicate of the already-established "tissue-level
  // organization".
  "true tissues",
  // Grammatical-form (plural) duplicate of the already-established
  // "seasonal breeder".
  "seasonal breeders",
  // Incomplete duplicate of the already-blocked "underlining".
  "underline",
  // Bare, too generic (petal/sepal edges in aestivation questions).
  "margins",
  // Redundant modifier-form duplicate of the already-established
  // "monocotyledonae".
  "monocotyledonous seeds",
  // Generic geometry descriptor (defines radial symmetry), same class as
  // already-excluded generic geometry nouns.
  "vertical plane",
  // Generic habitat/scenery descriptor.
  "swampy regions",
  // Common/generic coconut-husk descriptor; real structures ("mesocarp",
  // "endocarp", "drupe") already captured.
  "fibrous husk",
  // Generic descriptive combos for pyrenoid composition, same class as
  // the already-blocked "proteinaceous matrix".
  "protein core",
  "proteinaceous core",
  // Generic paraphrases of what chemotaxonomy/cytotaxonomy (the real,
  // already-captured terms) examine.
  "chemical constituents",
  "cytological characters",
  // Narration for a specific free-fall nth-second-distance calculation.
  "distance covered in first second",
  // Paraphrase/synonym duplicate of the already-established "angle of
  // banking" (same v²/rg relation, cyclist-leaning phrasing).
  "angle of leaning",
  // Formula variable spoken as a phrase, same class as already-excluded
  // "v squared".
  "cos theta",
  // Generic narration describing the vector-product magnitude formula,
  // not a distinct concept; real term "vector product" already captured.
  "magnitude of vector product",
  // Generic/redundant paraphrase of Bohr-model electron orbits.
  "electronic orbits",
  // Generic paraphrase of the already-established "filter feeding"/
  // "canal system".
  "food gathering",
  // Generic combo/narration describing a gymnosperm comparison, not a
  // distinct concept.
  "stem branching",
  // Generic narration describing the arbitrary PE reference point.
  "reference zero level",
  // Generic descriptive combo for the work-via-integration method, not a
  // distinct named concept.
  "force-displacement relation",
  // Word-problem apparatus/scenario descriptors.
  "water jet",
  "nozzle",
  // Redundant/paraphrase duplicate of the already-established
  // "conservation of energy".
  "total energy conservation",
  // Redundant modifier-form duplicate of the already-established
  // "restoring force".
  "spring restoring force",
  // Redundant/paraphrase duplicate of the already-established "uniform
  // circular motion".
  "uniform circular path",
  // Generic descriptor, same class as already-blocked "equal masses
  // collision".
  "equal mass",
  // Generic narration describing the dot-product-is-zero fact, not a
  // distinct concept.
  "mutually perpendicular vectors",
  // Paraphrase duplicate of the already-established "neoblast cells".
  "regenerative cells",
  // Grammatical-form (singular) duplicate of the already-established
  // "statocysts".
  "statocyst",
  // Paraphrase/incomplete duplicate of the already-established "ciliary
  // comb plates".
  "ciliary combs",
  // Grammatical-form (plural) duplicate of the already-established
  // "akinete".
  "akinetes",
  // Redundant modifier-form duplicate of the already-established
  // "trigonal bipyramidal".
  "trigonal bipyramidal arrangement",
  // Redundant modifier-form duplicate of the already-established "linear
  // shape"/"linear geometry".
  "linear molecular shape",
  // Paraphrase/redundant duplicate of the already-established
  // "resonance"/"canonical structures".
  "canonical lewis structure",
  // Redundant singular/generic-form duplicate of the already-established
  // "supplementary units".
  "supplementary quantity",
  // Redundant modifier-form duplicate of the already-established
  // "gametophyte".
  "moss gametophyte",
  // Generic combos describing the centre-of-mass concept, not distinct
  // concepts; real term "centre of mass" already captured.
  "hollow body",
  "symmetrical body",
  // Redundant duplicate of the already-established "true weight".
  "actual weight",
  // Word-problem apparatus/scenario descriptor.
  "light inextensible string",
  // Narration describing rocket-thrust mechanism, not a distinct concept.
  "ejection of burnt fuel",
  // Generic/common phrase (minimal-wear-at-optimum-speed narration).
  "wear and tear",
  // Generic category phrase (the question's own request to name the
  // genus, i.e. "cycas" — the real content, already captured).
  "gymnospermic genus",
  // Generic combos; real specific terms (ground tissue, medullary rays,
  // mesophyll) already captured.
  "spongy tissues",
  "parenchymatous tissues",
  // Generic scenario descriptor for identifying "tetrarch"/xylem poles,
  // not itself vocabulary.
  "root cross section",
  // Redundant modifier duplicate of the already-established "cortex".
  "root cortex",
  // Generic category-label framing of this question, not a distinct
  // concept.
  "primary dicot root",
  // Generic/common geometry term, same class as already-excluded generic
  // geometry nouns.
  "transverse walls",
  "leaf surface",
  // Word-problem scenario/example prop.
  "jet plane",
  // Generic category descriptor (climbing habit), real content is the
  // specific tendril mechanism/example plants.
  "climbing plants",
  // Generic/common-use category label.
  "ornamental plant",
  // Generic/redundant duplicates of the already-established "sucker".
  "underground stem modification",
  "modification of stem",
  "modifications of stem",
  // Bare/generic, too broad (matching-question category header).
  "plant family",
  // Common everyday food-category words, no NEET-specific definition
  // needed, same class as already-blocked "carrot".
  "vegetable crops",
  "vegetable",
  "pulse",
  "pulse crops",
  // Generic combo; real term "friction"/"static friction" already
  // captured.
  "contact surfaces",
  // Generic narration/paraphrase of the already-established "hess's
  // law"/"state function".
  "reaction path",
  "intermediate step",
  // Redundant duplicate of the already-established "recoil".
  "recoil of a gun",
  // Paraphrase duplicate of the already-established "antherozoids".
  "flagellated sperm",
  // Redundant duplicate of the already-established, more concise "hess's
  // law".
  "hess's law of constant heat summation",
  // Generic paraphrase duplicate of the already-established "gibbs free
  // energy"/"spontaneity".
  "gibbs energy criterion",
  // Bare/generic paraphrase duplicate of the already-established "state
  // function"/"hess's law".
  "path independent",
  // Generic/incomplete descriptor; real terms "newton's third law"/
  // "action-reaction pair" already captured.
  "action force",
  // Paraphrase duplicates of the already-established "rolling without
  // slipping".
  "rolling condition",
  "instantaneously at rest",
  // Generic descriptors for moment-of-inertia-formula selection, not
  // distinct concepts.
  "central symmetry axis",
  "axis perpendicular to length",
  // Paraphrase/synonym duplicate of the already-established
  // "pneumatophores".
  "respiratory root",
  // Redundant modifier-form duplicates of the already-established
  // "actinomorphic"/"zygomorphic".
  "actinomorphic flowers",
  "zygomorphic flowers",
  // Redundant paraphrase duplicate of the already-established
  // "dicotyledonae"/"reticulate venation".
  "dicotyledonous leaves",
  // Generic paraphrase duplicate of the already-established "endosperm"/
  // "cotyledon".
  "food-storage tissue",
  // Redundant paraphrase duplicate of the already-established
  // "calorimeter".
  "calorimeter system",
  // Narration describing the bond-enthalpy calculation method, not
  // distinct concepts; real term "bond enthalpy" already captured.
  "bonds formed",
  "bonds broken",
  "gaseous atoms",
  // Generic/common category descriptor.
  "aquatic plant",
  // Bare adjective, no noun.
  "non-secretory",
  // Bare, too generic (matches the trichome/hair-type context, but
  // "hairs" alone fails the core test).
  "hairs",
  // Bare formula variable/notation.
  "pv",
  // Exact match to the prompt's own explicitly-given antipattern example
  // ("leafy shoots") — the model still produced it despite the rule.
  "leafy shoot",
  // Bare, too generic (verb-derived noun, phloem loading context).
  "loading",
  // Common everyday fruit-part word, no NEET-specific definition needed.
  "pulp",
  // Narration ("before seed maturity"), generic combo.
  "seed maturity",
  // Common/generic botanical term, no NEET-specific definition needed.
  "flower bud",
  // Common everyday word (indigo dye example), no NEET-specific
  // definition needed.
  "dye",
  // Redundant modifier-form duplicate of the already-established
  // "mesophyll".
  "mesophyll tissue",
  // Incomplete/truncated duplicate of the already-established "conjoint
  // collateral vascular bundle".
  "conjoint collateral",
  // Redundant near-duplicate of the already-established "sclerenchymatous
  // cells" (tissue vs. cells).
  "sclerenchymatous tissue",
  // Apostrophe-variant duplicate of the already-established "mayer
  // relation".
  "mayer's relation",
  // Singular redundant duplicate of the already-established "banking of
  // roads".
  "banking of road",
  // Redundant synonym duplicate of the already-established "non-contact
  // forces".
  "field forces",
  // Alternate-spelling duplicate of the already-established "amoeba".
  "ameba",
  // Redundant modifier-form duplicate of the already-established "cilia".
  "eukaryotic cilia",
  // Generic paraphrase duplicates of the already-established "optimum
  // ph"/"optimum temperature".
  "acidic conditions",
  "optimum activity",
  // Redundant duplicate of the already-established "cell adhesion"/
  // "desmosomes".
  "cell-to-cell adhesion",
  // Redundant/generic duplicate of the already-established "phenotype".
  "phenotypic characters",
  // Redundant paraphrase duplicate of the already-established "gills"/
  // "operculum".
  "aquatic respiratory organ",
  // Redundant modifier-form duplicate of the already-established
  // "mushroom gland".
  "mushroom-shaped gland",
  // Adjective-form paraphrase duplicates of the already-established
  // "spontaneity"/"gibbs free energy".
  "thermodynamically spontaneous",
  "thermodynamically favourable",
  "thermodynamically favourable reaction",
  // Redundant near-duplicate of the already-established "perfectly
  // crystalline solid" (substance vs. solid, same Third Law concept).
  "perfectly crystalline substance",
  // Vague/redundant duplicate of the already-established "thermodynamic
  // sign convention".
  "thermodynamic convention",
  // Generic sign-descriptor combos, not stable named concepts on their
  // own.
  "negative entropy",
  "negative enthalpy",
  // Narration/mechanism-description duplicate of the already-established
  // "net zero dipole moment".
  "cancellation of dipole moments",
  // Generic combo/narration; real terms "lattice enthalpy"/"coulombic
  // interaction" already captured.
  "inter-ionic distance",
  // Word-problem scenario prop (six identical balls collision).
  "identical balls",
  // Generic combo/narration for a moment-of-inertia matching question,
  // not a distinct concept.
  "geometric axis",
  // Scenario/example-object descriptor illustrating that centre of mass
  // can lie outside the material, not itself a distinct concept.
  "uniform thin circular ring",
  // Narration describing the energy source in a specific projectile-
  // explosion problem, generic combo.
  "internal chemical energy",
  // Verbose/redundant restatement of the already-established "potential
  // energy".
  "scalar potential energy function",
  // Common/generic words (friction-reduction concept), no NEET-specific
  // definition needed; pre-existing "lubrication" entry (17 mappings,
  // biology-tagged) small enough to delete outright.
  "lubricating layer",
  "lubrication",
  // Narration duplicates of the already-established "rolling
  // friction"/"kinetic friction".
  "relative rolling motion",
  "relative sliding",
  // Generic/too-broad; real term "ATP"/"mitochondria" already captured.
  "cellular energy",
  // Generic combo; real term "smooth endoplasmic reticulum" already
  // captured.
  "hormone synthesis",
  // Generic historical-descriptor combo; real term "golgi apparatus"
  // already captured.
  "reticular structures",
  // Generic combo; real terms "pili"/"fimbriae" already captured.
  "bacterial cell surface",
  "enzymatic content",
  // Plural-form duplicate of the already-established "mating call".
  "mating calls",
  // Generic combo; real terms "heart"/"pericardium" already captured.
  "muscular structure",
  // Generic/common geometry-adjacent term.
  "ventral side",
  // Generic descriptive combo describing mouthpart function.
  "biting and chewing",
  // Generic descriptive-shape combos describing cockroach heart anatomy;
  // real terms ("ostia", "heart") already captured.
  "funnel-shaped chambers",
  "muscular tube",
  // Generic category/redundant with the already-captured specific parts
  // (gizzard, proventriculus).
  "cockroach digestive system",
  // Generic/common combo; real term "hepatic caeca"/"gastric caeca"
  // already captured.
  "digestive juice",
  // Redundant singular-form duplicate of the already-established "labial
  // palps".
  "labial palp",
  // Bare, too generic (electron revolution around nucleus context).
  "revolution",
  // Bare verbs/adverbs, no noun.
  "respond",
  "sense",
  "predating",
  "autotrophically",
  "proliferation",
  "upward",
  // Bare, too generic.
  "fluctuation",
  "limits",
  "coordinate axes",
  "gas molecules",
  // Bare formula abbreviation, same class as already-excluded "cos
  // theta".
  "cos",
  // Generic/math-narration term describing measured quantities in a
  // specific error-propagation problem.
  "observables",
  // Too generic/vague; the specific historical apparatus is "gold foil".
  "foil",
  // Word-problem scenario props.
  "highway",
  "aircraft",
  "horizontal loop",
  "launch point",
  // Redundant/informal duplicate of the already-established "cockroach".
  "roach",
  // Alternate-spelling duplicate of the already-established
  // "cesium-133 atom".
  "caesium-133",
  // Paraphrase duplicates of the already-established "hyperfine
  // transition frequency".
  "ground-state hyperfine transition",
  "caesium frequency",
  // Redundant duplicate of the already-established "james chadwick".
  "j. chadwick",
  // Apostrophe-variant duplicate of the already-established "maxwell
  // electromagnetic theory".
  "maxwell's electromagnetic theory",
  // Alternate-spelling duplicate of the already-established
  // "aestivation".
  "estivation",
  // Misspelling of the already-established "albugo".
  "albufo",
  // Generic paraphrase duplicate of the already-established "atomic
  // number"/"neutral atom".
  "electric neutrality",
  // Redundant modifier-form duplicates of the already-established "guard
  // cells" (the dicot shape descriptors, distinct from the kept monocot
  // "dumb-bell shaped guard cells").
  "kidney-shaped guard cells",
  "bean-shaped guard cells",
  // Redundant modifier duplicate of the already-established "absorptive
  // nutrition".
  "heterotrophic absorptive nutrition",
  // Generic combo; real term "food chain"/"primary productivity" already
  // captured.
  "aquatic food chain",
  // Generic category label (matching-question header).
  "sensory structure",
  // Generic combo; real term "cloaca" already captured.
  "reproductive ducts",
  // Generic/redundant category framing of this question, not itself
  // vocabulary.
  "primary vascular bundles",
  // Redundant/generic combos; real terms "guard cells"/"bean-shaped"/
  // "kidney-shaped"/"dumb-bell shaped" already captured.
  "dicot stomata",
  "grass stomata",
  // Generic/common phrase (drought stress).
  "water deficiency",
  // Bare, too generic (one of several listed viral-disease symptoms);
  // the actual distinguishing symptom, "mosaic formation", is kept.
  "yellowing",
  // Basic calculus method narration, not physics-specific vocabulary.
  "product rule",
  // Generic category label (matching-question header).
  "vector operation",
  // Generic/narration duplicate of the already-established "equal and
  // opposite forces" concept via Newton's third law (not itself a
  // distinct headword).
  "equal and opposite forces",
  // Pre-existing entry (2 mappings, small enough to delete outright);
  // generic/common phrase.
  "limiting value",
  // Bare hyphenated-surname duplicate of the already-established
  // "gay-lussac's law".
  "gay-lussac",
  // Redundant full-name duplicate of the already-established, more
  // concise "gay-lussac's law".
  "gay-lussac's law of gaseous volumes",
  // Missed in an earlier round: generic unit-rate descriptor for a
  // clock-hands angular-speed-ratio problem, not vocabulary.
  "revolutions per hour",
  // Misspelling duplicate of the already-established "photoelectric
  // equation".
  "einsten's photoelectric equation",
  // Bare IUPAC-numerical-root fragments, same class as already-excluded
  // bare word fragments; the real concept "numerical root" already
  // captured.
  "un",
  "nil",
  "uue",
  // Redundant paraphrase duplicate of the already-established
  // "chondrichthyes".
  "marine cartilaginous fishes",
  // Paraphrase/incomplete duplicate of the already-established
  // "post-anal tail".
  "post-anal part",
  // Paraphrase duplicate of the already-established "statocysts".
  "balance organs",
  // Redundant modifier duplicate of the already-established "pauling
  // scale".
  "pauling electronegativity scale",
  // Synonym duplicate of the already-established "successive ionization
  // enthalpies".
  "successive ionization energies",
  // Redundant modifier-form duplicate of the already-established
  // "sporophyte".
  "moss sporophyte",
  // Informal/redundant duplicate of the already-established "maximum
  // height".
  "max height",
  // Generic/redundant duplicate of the already-established "limiting
  // friction".
  "limiting motion",
  // Generic/vague duplicate; the real specific terms "parallelogram
  // law"/"triangle law of vector addition" already captured.
  "vector law",
  // Paraphrase duplicates of the already-established "antherozoids".
  "motile sperms",
  "non-motile male gametes",
  // Redundant modifier-form duplicates of the already-established
  // "electronic configuration"/"valence-shell electronic configuration".
  "inner-shell configuration",
  "valence-shell configuration",
  // Generic/redundant paraphrase; the real specific term "hydrogen
  // spectral series" already captured.
  "spectrum of hydrogen",
  // Generic combo, not a distinct concept.
  "solid particles",
  "multiplying factor",
  // Scenario-example atom for a Slater's-rules calculation, not a
  // distinct named chemical species (unlike the kept "helium
  // molecule"/"neon molecule", which are real tested MOT species).
  "lithium atom",
  // Generic matching-question category header.
  "iupac official name",
  // Generic combo/narration, not distinct concepts.
  "stopping time",
  "vertical component of tension",
  "optimum safe speed",
  "safe speed",
  "scalar multiples",
  "experimental techniques",
  "scalar component equations",
  "impact time",
  "molecular bonds",
  "crop damage",
  "marine animals",
  "body surface",
  "primitive features",
  "commercially beneficial insects",
  "excretory tubules",
  "leaf cell",
  "soil-binding",
  "medicinal applications",
  "vascular systems",
  "gametophytic cell",
  // Bare adjective, no noun.
  "cytological",
  "coniferous",
  // Generic combo, narration.
  "reproductive stage",
  "culture media",
  "sexual characteristics",
  "vegetative characteristics",
  "molecular approaches",
  // Generic narration ("quantitative measure of force"), not itself a
  // distinct concept.
  "quantitative measure",
  // Redundant modifier duplicate of the already-established "capsule
  // wall".
  "capsule wall cells",
  // Bare, too generic/common animal name.
  "snake",
  // Bare, ambiguous one/two-letter element symbols — too short/generic
  // standalone to be real headwords (the periodic-law prediction
  // question they came from tests the actual element names, not bare
  // symbols).
  "ca",
  "na",
  "si",
  "be",
  "li",
  // Paraphrase duplicate of the already-established "spontaneity".
  "criterion for spontaneity",
  // Narration/redundant-sign-convention duplicate of the already-kept
  // "expansion work" concept, not a distinct concept.
  "work done by the gas",
  // Word-problem scenario/example-shape descriptors for a centre-of-mass
  // matching question, same class as the already-blocked "uniform thin
  // circular ring".
  "solid hemisphere",
  "horseshoe magnet",
  // Scenario/geometric-shape descriptor for a specific moment-of-inertia
  // problem.
  "right-angled isosceles triangle",
  // Narration/scenario-specific phrases for one particular Earth-
  // angular-momentum conservation problem, not stable concepts.
  "duration of day",
  "earth's rotation axis",
  "polar ice caps",
  // Narration describing this specific conical-pendulum-string problem's
  // setup, not vocabulary.
  "projected horizontally",
  // Redundant modifier duplicate of "mechanical equilibrium"/
  // "equilibrium", already captured.
  "complete mechanical equilibrium",
  // Generic narration for a specific circular-motion equation-solving
  // step, not a distinct named concept.
  "radial equation",
  // Generic/contrastive descriptor, not itself a concept.
  "three-dimensional solid bodies",
  // Generic/common chemistry term.
  "polar liquid",
  // Paraphrase duplicate of the already-kept "ice structure".
  "cage-like structure",
  // Generic combo/narration describing NH3's structure, not a distinct
  // concept; real terms "trigonal pyramidal"/"lone pair" already
  // captured.
  "central nitrogen atom",
  // Generic combo; real term "ionic bond"/"coulombic interaction"
  // already captured.
  "electrostatic forces",
  // Word-problem apparatus/scenario descriptor.
  "lifting cable",
  // Bare adjective describing a mathematical property.
  "distributive",
  // Generic/vague, not a distinct concept.
  "relative quantity",
  // Narration for a specific elevator-power calculation, not a distinct
  // concept.
  "motor force",
  // Narration for a specific coefficient-of-restitution problem.
  "rebound height",
  // Verbose narration describing a derivation; real concept
  // "power"/"kinetic energy" already captured.
  "rate of imparting kinetic energy",
  // Bare adjective/generic descriptor.
  "frame-dependent",
  // Generic combo; real term "microbodies"/"peroxisomes" already
  // captured.
  "oxidative enzymes",
  "ribosomal components",
  // Narration describing cockroach head fusion, generic combo.
  "embryonic segments",
  // Redundant/generic framing (this question's own topic header); real
  // term "nucleus" already captured.
  "eukaryotic nucleus",
  // Generic combo describing fungi's research-model use-case, not a
  // distinct concept.
  "genetic work",
  "biochemical work",
  // Bare adjective, no noun.
  "non-cellulosic",
  // Generic/vague contrast phrase.
  "true plants",
  // Generic category descriptor; real term "slime moulds"/"plasmodium"
  // already captured.
  "saprophytic protists",
  // Generic combo; real term "choanocytes" already captured.
  "flagellated cells",
  // Generic category framing (this question's own topic header).
  "gymnospermic plants",
  // Generic descriptive combo, same class as already-blocked
  // "proteinaceous matrix"/"proteinaceous core".
  "proteinaceous layer",
  // Generic combo; real term "heterocysts" already captured.
  "thick-walled cells",
  // Bare, too generic.
  "infectivity",
  // Generic combo; real terms "archaebacteria"/"methanogens" already
  // captured.
  "branched-chain hydrocarbons",
  // Generic/broad phrase.
  "environmental stimuli",
  // Generic category label (this question's own topic header).
  "defining features of living beings",
  "taxonomic grouping",
  // Generic/redundant with the already-blocked "dye"; the specific
  // substance name "indigo" is kept separately.
  "natural dye",
  // Generic geographic descriptors.
  "temperate zones",
  "subtropics",
  // Generic combos describing floral-appendage theory, not distinct
  // concepts.
  "vegetative appendages",
  "reproductive appendages",
  // Generic combo; real term "phylloclade"/euphorbia example already
  // captured.
  "arid adaptation",
  // Generic combo, same class as already-blocked "swampy regions".
  "underground root system",
  "marshy habitat",
  "swampy habitat",
  // Duplicates missing the leading hyphen of the already-established
  // "-aceae"/"-ales"/"-phyta" suffix terms.
  "aceae",
  "ales",
  "phyta",
  // Redundant duplicates (with an added Spanish/Latin "familia" prefix)
  // of the already-established "anacardiaceae"/"solanaceae".
  "familia anacardiaceae",
  "familia solanaceae",
  // Generic category duplicate; the real specific example "volvox"
  // already captured.
  "colonial green algae",
  // Verbose redundant duplicates of the already-established "trigonal
  // bipyramidal"/"tetrahedral"/"tetrahedral geometry".
  "trigonal bipyramidal electron-pair arrangement",
  "tetrahedral electron-pair arrangement",
  // Near-duplicate paraphrase of the already-established "molecular
  // orbital electron configuration".
  "valence molecular orbital configuration",
  // Redundant modifier-form duplicate of the already-established
  // "diadelphous androecium".
  "diadelphous condition",
  // Redundant duplicate variants; keeping the more complete, already-
  // established "sub-aerial stem modifications".
  "sub-aerial stem",
  "sub-aerial stem modification",
  // Misspelling duplicate of the already-established "periplaneta
  // americana".
  "periplaeta americana",
  // Redundant duplicate, same class as the already-blocked "funnel-
  // shaped chambers".
  "muscular chambers",
  // Generic combos/category labels, real terms already captured
  // (smooth muscle, salivary/exocrine glands, tight/adhering/gap
  // junctions, taste buds/sensory papillae).
  "hollow internal organs",
  "unstriped",
  "multicellular glands",
  "specialised connective tissue",
  "epithelial layer",
  "sensory cells",
  // Generic combo/narration; real term "phenolphthalein"/indicator range
  // already captured.
  "colour transition",
  // Generic combo describing Ostwald's dilution law, real concept
  // already captured.
  "un-ionized electrolyte",
  // Generic combo; real term "ph range"/indicator already captured.
  "acidic range",
  // Narration/generic phrases for specific gravitation problems, not
  // stable concepts.
  "minimum potential",
  "minimum value",
  "surface value",
  "center of earth",
  "earth's orbit",
  "interior point",
  "earth's rotation period",
  "potential at the surface",
  "outer spherical layers",
  "distance from center",
  "point masses",
  "net gravitational field",
  // Word-problem scenario/apparatus descriptor.
  "vertical circular track",
  // Generic combo/narration; real term "work-energy theorem"/"kinetic
  // energy" already captured.
  "net change in kinetic energy",
  // Generic combo; real term "hybridization state" already captured.
  "cationic species",
  // Generic combo; real term "lattice enthalpy"/"electrostatic forces"
  // already captured.
  "electrostatic stabilization",
  // Common/generic example reactions, no NEET-specific definition
  // needed.
  "decomposition of water",
  "rusting of iron",
  // Generic/redundant; real term "equilibrium"/"gibbs free energy"
  // already captured.
  "reversible system",
  // Narration describing the Δn_g variable, not a distinct concept.
  "change in number of gaseous moles",
  // Generic/incomplete combos; real terms "sieve cells"/"phloem" already
  // captured.
  "food-conducting",
  "conducting elements",
  // Generic combos; real terms "xylem parenchyma"/"sclereids"/"xylem
  // fibres" already captured.
  "lignified cells",
  "cellulosic walls",
  "wedge-shaped",
  // Bare, too generic (ambiguous — could mean many things).
  "pit",
  // Generic combo; real term "tracheids" already captured.
  "water-conducting elements",
  // Scenario/example-plant descriptor, generic.
  "sunflower stem",
  // Generic combo/narration; real term "xylem vessels" already captured.
  "transport of water and minerals",
  "conducting channels",
  // Redundant duplicates of each other; real terms "sclereids"/"xylem
  // fibres" already captured.
  "lignified secondary wall",
  "lignified cell wall",
  // Redundant paraphrase duplicates of the already-established "adaxial
  // leaf surface".
  "adaxial side",
  "abaxial side",
  // Redundant duplicate of the already-established "perfectly
  // crystalline solid".
  "pure crystalline substance",
  // Redundant modifier duplicate of the already-established
  // "collenchymatous cell".
  "collenchymatous tissue",
  // Generic paraphrase duplicate of the already-established "lysigenous
  // water cavities".
  "water-containing cavities",
  // Redundant duplicate of the already-established "brønsted base".
  "bronsted-lowry base",
  // Redundant modifier duplicate of the already-established "root hair".
  "unicellular root hairs",
  // Generic/redundant combo; real terms "metallic bonding"/"non-
  // directional bond" already captured.
  "metallic crystal lattice",
  // Generic combo, distinct from but same class as the already-
  // established "scattered vascular bundles".
  "peripheral vascular bundles",
  // Redundant modifier duplicate of the already-established "air sacs".
  "air sacs of lungs",
  // Alternate-spelling/singular duplicate of the already-established
  // "dumb-bell shaped guard cells".
  "dumbbell-shaped guard cell",
  // Singular-form duplicate of the already-established "gourds".
  "gourd",
  // Non-hyphenated duplicate of the already-established "super-elastic
  // collision".
  "superelastic collision",
  // Redundant modifier duplicate of the already-established "vacuole".
  "plant vacuole",
  // Redundant/generic paraphrase duplicate of the already-established
  // "synapse".
  "synaptic communication",
  // Synonym duplicate of the already-established "axon terminal".
  "axon endings",
  // Paraphrase duplicate of the already-established "spiracles".
  "respiratory openings",
  // Redundant paraphrase duplicates of the already-established "octet
  // rule"/"lewis structure".
  "octet concept",
  "lewis octet theory",
  // Paraphrase duplicate of the already-established "gap junctions"/
  // "intercellular channels".
  "cytoplasmic channels",
  // Generic combos/bare words, not distinct concepts.
  "sensory appendages",
  "reducing water loss",
  "functional maturity",
  "tapering ends",
  "heat supplied",
  "coexist",
  "two-body system",
  "depth below earth's surface",
  "explosive forces",
  "rotational kinematic relation",
  "retarding angular acceleration",
  "flexible neck",
  "longitudinal body axis",
  "anterior",
  "pliable matrix",
  // Redundant/narration duplicate of the already-blocked "protein
  // mobility" (fluid mosaic model context).
  "lateral movement of proteins",
  "plant and animal cells",
  "filamentous proteinaceous structures",
  "digesting",
  // Grammatical-form (plural) duplicate of the already-established
  // "isobilateral monocot leaf".
  "isobilateral monocot leaves",
  // Paraphrase duplicate of the already-established "substrate
  // affinity".
  "substrate-binding affinity",
  // Grammatical-form (plural) duplicate of the already-established
  // "primary root".
  "primary roots",
  // Garbled/non-standard term, not the real "biomolecule".
  "biomicromolecule",
  // Bare/generic combos, not distinct concepts.
  "blue color",
  "abundance",
  "volatile oils",
  // Bare adjective, no noun.
  "heterocyclic",
  "acidifying agent",
  "migration of ions",
  // Modifier-variant duplicates of the already-established generic-
  // condition pattern ("acidic medium"/"alkaline condition").
  "strongly alkaline medium",
  "faintly alkaline medium",
  "negative polarity",
  "stress-strain behaviour",
  "molecular collision rate",
  // Common/generic everyday word, no NEET-specific definition needed.
  "detergent",
  "stream velocity",
  // Generic combos; real terms "plasma membrane"/"ribosome" already
  // captured.
  "phospholipid membrane",
  "protein-synthesizing machinery",
  // Bare, too generic.
  "sorting",
  // Generic descriptive combo, same class as already-blocked
  // "proteinaceous matrix"/"proteinaceous core"/"proteinaceous layer".
  "proteinaceous structures",
  "cellular motility",
  // Generic combo; real term "connective tissue proper" and specific
  // fiber types already captured.
  "connective tissue fibres",
  "protein-synthetic activity",
  // Bare/generic word.
  "cushioning",
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
