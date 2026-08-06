// Risk + triage scoring — the differentiator.
//
// Turns a raw ADO pull request (+ its changed files) into:
//   - risk: low | medium | high  (with human-readable reasons)
//   - priority: a triage score for the lead's "Today" queue
//   - checks: build / labels / rebase style signals
//
// The risk rules are DYNAMICS 365 F&O-AWARE: touching posting, financial,
// data-entity, or security objects raises risk in a way generic tools can't.
// This is heuristic (no AI needed) so it works offline and is explainable.
// Azure OpenAI (aiClient.js) can later ENRICH the summary/reasons.

// File-path patterns that signal higher risk in a D365 F&O codebase.
const HIGH_RISK_PATTERNS = [
  { re: /SalesTableType|PurchTableType|.*PostingType|.*Post\b|Posting/i, why: "posting logic" },
  { re: /LedgerVoucher|Ledger.*Post|Tax.*Calc|CustVend|InventMovement/i, why: "financial/ledger logic" },
  { re: /Security.*\.xml|.*Privilege|.*Duty|.*Role\.xml/i, why: "security objects" },
  { re: /.*DataEntity|.*Entity\.xml|AggregateMeasurement/i, why: "data entity / integration" },
];
const MEDIUM_RISK_PATTERNS = [
  { re: /\.xpp$|class.*\.xml|Table\.xml/i, why: "X++ / table logic" },
  { re: /Form\.xml|.*Form\b/i, why: "form change" },
  { re: /Workflow/i, why: "workflow change" },
];
const LOW_NOISE_PATTERNS = [
  /\.label\.txt$|Label.*\.xml|\.resx$/i, // labels
  /\.md$|\.txt$|README/i, // docs
  /\.json$|\.config$|\.xml$/i, // config (weak signal, only if nothing else)
];

// A change is "meaningful" (not noise) for the clean-diff count.
function isNoise(path) {
  return /\.g\.xpp$|Generated|\.designer\.|packages\.config|\.csproj$/i.test(path || "");
}

function daysAgo(dateStr) {
  if (!dateStr) return 0;
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// --- risk ---
function scoreRisk(pr, changePaths = []) {
  const reasons = [];
  let level = "low";

  for (const p of changePaths) {
    for (const rule of HIGH_RISK_PATTERNS) {
      if (rule.re.test(p) && !reasons.includes(rule.why)) {
        reasons.push(rule.why);
        level = "high";
      }
    }
  }
  if (level !== "high") {
    for (const p of changePaths) {
      for (const rule of MEDIUM_RISK_PATTERNS) {
        if (rule.re.test(p) && !reasons.includes(rule.why)) {
          reasons.push(rule.why);
          level = "medium";
        }
      }
    }
  }

  // Size signal
  const meaningful = changePaths.filter((p) => !isNoise(p));
  if (meaningful.length >= 20 && level !== "high") {
    level = "high";
    reasons.push(`large change (${meaningful.length} files)`);
  } else if (meaningful.length >= 8 && level === "low") {
    level = "medium";
    reasons.push(`sizeable change (${meaningful.length} files)`);
  }

  // No tests touched but code changed → nudge up
  const hasCode = changePaths.some((p) => /\.xpp$|class.*\.xml/i.test(p));
  const hasTest = changePaths.some((p) => /Test/i.test(p));
  if (hasCode && !hasTest && level === "medium") {
    reasons.push("no test changes");
  }

  if (reasons.length === 0) reasons.push("cosmetic / low-impact change");
  return { risk: level, reasons };
}

// --- checks (heuristic from PR metadata) ---
function deriveChecks(pr) {
  // isDraft, mergeStatus, reviewers votes give us signal without extra calls.
  const build = pr.mergeStatus ? pr.mergeStatus === "succeeded" : true;
  const rebase = !(pr.mergeStatus === "conflicts");
  const labels = Array.isArray(pr.labels) ? pr.labels.length > 0 : true;
  return { build, labels, rebase };
}

// --- triage priority for the "Today" queue ---
// Higher = more it needs the lead now. urgency×risk×age×blocking.
function trianglePriority(pr, risk) {
  const riskWeight = { high: 3, medium: 2, low: 1 }[risk] || 1;
  const age = daysAgo(pr.creationDate);
  const ageWeight = age >= 3 ? 3 : age >= 1 ? 2 : 1;
  const isDraft = pr.isDraft ? 0.4 : 1; // drafts need the lead less
  // "blocking others": PR has active reviewers waiting (votes == 0) or many reviewers
  const reviewers = pr.reviewers || [];
  const waiting = reviewers.filter((r) => (r.vote || 0) === 0).length;
  const blockWeight = 1 + Math.min(waiting, 3) * 0.5;
  return Math.round(riskWeight * ageWeight * blockWeight * isDraft * 10);
}

module.exports = { scoreRisk, deriveChecks, trianglePriority, isNoise, daysAgo, urgencyBucket };

// Map a numeric priority score to a friendly bucket for the UI.
//   urgent (>= 50) · soon (>= 25) · low (< 25)
function urgencyBucket(priority) {
  if (priority >= 50) return "urgent";
  if (priority >= 25) return "soon";
  return "low";
}
