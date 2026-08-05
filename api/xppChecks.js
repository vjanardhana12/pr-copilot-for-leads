// X++ best-practice & performance analyzer.
//
// Scans changed X++ source (and related AOT text) for common D365 F&O review
// issues, so the lead sees concrete findings — not just a generic risk badge.
// Pure heuristics (regex/line based): no compiler, works offline, explainable.
// Azure OpenAI (aiClient.js) can later ENRICH these with deeper reasoning.
//
// Each rule: { id, severity, category, message, hint }
// severity: high | medium | low
// category: performance | correctness | security | bestpractice | style

// Rules that match on a SINGLE added line of code.
const LINE_RULES = [
  // ---- Performance ----
  {
    id: "PERF_SELECT_IN_LOOP",
    severity: "high",
    category: "performance",
    test: (line, ctx) => ctx.inLoop && /\bselect\b/i.test(line) && !/insert_recordset|update_recordset|delete_from/i.test(line),
    message: "Database select inside a loop (possible N+1).",
    hint: "Move the query outside the loop, use a join, or use RecordSortedList / a set-based operation.",
  },
  {
    id: "PERF_INSERT_IN_LOOP",
    severity: "high",
    category: "performance",
    test: (line, ctx) => ctx.inLoop && /\.insert\(\)/i.test(line),
    message: "Row-by-row .insert() inside a loop.",
    hint: "Use insert_recordset or RecordInsertList for set-based inserts (far fewer round-trips).",
  },
  {
    id: "PERF_UPDATE_IN_LOOP",
    severity: "high",
    category: "performance",
    test: (line, ctx) => ctx.inLoop && /\.update\(\)/i.test(line),
    message: "Row-by-row .update() inside a loop.",
    hint: "Use update_recordset for a single set-based UPDATE where possible.",
  },
  {
    id: "PERF_DELETE_IN_LOOP",
    severity: "high",
    category: "performance",
    test: (line, ctx) => ctx.inLoop && /\.delete\(\)/i.test(line),
    message: "Row-by-row .delete() inside a loop.",
    hint: "Use delete_from for a set-based DELETE.",
  },
  {
    id: "PERF_SELECT_STAR",
    severity: "low",
    category: "performance",
    test: (line) => /\bselect\b(?!\s+(firstonly|firstfast|count|sum|maxof|minof|crosscompany|forupdate|generateonly|validtimestate))/i.test(line) && !/\bfrom\b.*\bwhere\b/i.test(line) && /\bselect\s+\w+\s*;?\s*$/i.test(line) === false && /\bselect\s+[A-Za-z_]\w*\s*$/i.test(line),
    message: "select without an explicit field list.",
    hint: "Specify only the fields you need (select FieldA, FieldB from ...) to reduce I/O.",
  },
  {
    id: "PERF_MISSING_FIRSTONLY",
    severity: "low",
    category: "performance",
    test: (line) => /\bselect\b/i.test(line) && /\bwhere\b/i.test(line) && !/firstonly|while\s+select|count|sum|group\s+by/i.test(line),
    message: "Single-record select without firstOnly.",
    hint: "Add firstOnly when you expect one row so the kernel stops after the first match.",
  },
  {
    id: "PERF_NOTEXISTS_JOIN_PREF",
    severity: "low",
    category: "performance",
    test: (line, ctx) => ctx.inLoop && /exists\s+join|notexists\s+join/i.test(line),
    message: "exists/notexists join evaluated inside a loop.",
    hint: "Consider restructuring so the existence check runs once as a set-based query.",
  },
  {
    id: "PERF_CONTAINER_IN_LOOP",
    severity: "medium",
    category: "performance",
    test: (line, ctx) => ctx.inLoop && /conIns|conPoke|\+=\s*\[.*\]|con\s*\+=/i.test(line),
    message: "Growing a container inside a loop.",
    hint: "Containers copy-on-grow; prefer List/Map/RecordSortedList for large collections.",
  },
  {
    id: "PERF_STRFMT_IN_LOOP",
    severity: "low",
    category: "performance",
    test: (line, ctx) => ctx.inLoop && /strFmt|strfmt/i.test(line),
    message: "strFmt/string building inside a loop.",
    hint: "Minimise string formatting in hot loops; build once or use a cache.",
  },

  // ---- Correctness ----
  {
    id: "CORR_DOINSERT",
    severity: "medium",
    category: "correctness",
    test: (line) => /\.doInsert\(\)|\.doUpdate\(\)|\.doDelete\(\)/i.test(line),
    message: "doInsert/doUpdate/doDelete bypasses table validation & events.",
    hint: "Use insert/update/delete unless you deliberately need to skip validation (document why).",
  },
  {
    id: "CORR_SKIP_METHODS",
    severity: "medium",
    category: "correctness",
    test: (line) => /skipDataMethods|skipEvents|skipDatabaseLog|skipAosValidation|skipDeleteMethod|skipDeleteActions/i.test(line),
    message: "skip* flag disables standard validation/events.",
    hint: "Only skip framework behaviour when justified; leave a comment explaining the reason.",
  },
  {
    id: "CORR_FORUPDATE_NO_TTS",
    severity: "medium",
    category: "correctness",
    test: (line, ctx) => /\bforupdate\b/i.test(line) && !ctx.inTts,
    message: "select forUpdate outside a ttsBegin/ttsCommit block.",
    hint: "Wrap updates in ttsBegin/ttsCommit to keep them transactional.",
  },
  {
    id: "CORR_EMPTY_CATCH",
    severity: "medium",
    category: "correctness",
    test: (line) => /catch\s*\([^)]*\)\s*\{\s*\}/i.test(line),
    message: "Empty catch block swallows errors.",
    hint: "Log or handle the exception; never silently discard it.",
  },
  {
    id: "CORR_TODO",
    severity: "low",
    category: "correctness",
    test: (line) => /\/\/\s*(TODO|HACK|FIXME|XXX)\b/i.test(line),
    message: "Unresolved TODO/HACK/FIXME left in code.",
    hint: "Resolve or track it in a work item before merge.",
  },

  // ---- Security ----
  {
    id: "SEC_DIRECT_SQL",
    severity: "high",
    category: "security",
    test: (line) => /\bStatement\b|\bConnection\b|\bSqlSystem\b|executeQuery|executeUpdate/i.test(line),
    message: "Direct SQL / ADO.NET usage.",
    hint: "Prefer X++ queries; direct SQL risks injection and bypasses security.",
  },
  {
    id: "SEC_RUNAS",
    severity: "medium",
    category: "security",
    test: (line) => /runAs\s*\(|SecurityUtil|setPrivilegedMode\s*\(\s*true/i.test(line),
    message: "Elevation / runAs / privileged mode.",
    hint: "Confirm the elevation is required and scoped as narrowly as possible.",
  },
  {
    id: "SEC_SQL_CONCAT",
    severity: "high",
    category: "security",
    test: (line) => /queryValue|SysQuery::value/i.test(line) === false && /\+\s*["'].*(select|where|from).*["']/i.test(line),
    message: "String-concatenated query fragment.",
    hint: "Use SysQuery::value / query ranges to avoid injection.",
  },

  // ---- Best practice ----
  {
    id: "BP_HARDCODED_LABEL",
    severity: "medium",
    category: "bestpractice",
    test: (line) => /(error|warning|info|checkFailed|strFmt)\s*\(\s*["'][^"']{3,}["']/i.test(line) && !/@[A-Za-z]/.test(line),
    message: "Hardcoded user-facing string (not a label).",
    hint: "Use a label reference (@Prefix:Key) so text is translatable.",
  },
  {
    id: "BP_INFO_DEBUG",
    severity: "low",
    category: "bestpractice",
    test: (line) => /\b(info|print)\s*\(/i.test(line) && !/infolog\.add/i.test(line),
    message: "Debug info()/print() left in code.",
    hint: "Remove debugging output before merge.",
  },
  {
    id: "BP_HARDCODED_COMPANY",
    severity: "medium",
    category: "bestpractice",
    test: (line) => /changecompany\s*\(\s*["'][a-z0-9]{2,4}["']/i.test(line),
    message: "Hardcoded company id in changecompany.",
    hint: "Drive company from configuration/parameters, not a literal.",
  },
  {
    id: "BP_TABLE_LOOP_NO_INDEX",
    severity: "low",
    category: "performance",
    test: (line) => /while\s+select\b/i.test(line) && !/order\s+by|index\b|firstfast/i.test(line),
    message: "while select without an index/order hint.",
    hint: "Ensure the where-clause fields are covered by an index to avoid table scans.",
  },
  {
    id: "BP_DELETEALL_NO_RANGE",
    severity: "high",
    category: "correctness",
    test: (line) => /\.delete_from|delete_from\b/i.test(line) === false && /\bdeleteAll\(\)/i.test(line),
    message: "deleteAll() with no visible range may wipe the whole table.",
    hint: "Confirm ranges/where-clause are set before deleteAll().",
  },
];

// Detect loop/tts/context transitions from a line.
function updateContext(ctx, line) {
  const opens = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;

  if (/\b(while|for|do)\b|\bwhile\s+select\b/i.test(line)) {
    ctx.loopDepthStack.push(ctx.braceDepth + opens);
    ctx.inLoop = true;
  }
  if (/\bttsBegin\b/i.test(line)) ctx.ttsDepth++;
  if (/\bttsCommit\b|\bttsAbort\b/i.test(line)) ctx.ttsDepth = Math.max(0, ctx.ttsDepth - 1);

  ctx.braceDepth += opens - closes;
  ctx.inTts = ctx.ttsDepth > 0;

  // Pop loops whose scope closed.
  while (ctx.loopDepthStack.length && ctx.braceDepth < ctx.loopDepthStack[ctx.loopDepthStack.length - 1]) {
    ctx.loopDepthStack.pop();
  }
  ctx.inLoop = ctx.loopDepthStack.length > 0;
}

function isXppFile(path) {
  return /\.xpp$/i.test(path) || /class[\\/].*\.xml$/i.test(path);
}

// Analyze source text (a whole file or a changed hunk) → array of findings.
function analyzeSource(path, source) {
  const findings = [];
  if (!source) return findings;
  const lines = source.split(/\r?\n/);
  const ctx = { braceDepth: 0, loopDepthStack: [], inLoop: false, ttsDepth: 0, inTts: false };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("//")) {
      updateContext(ctx, raw);
      return;
    }
    for (const rule of LINE_RULES) {
      try {
        if (rule.test(line, ctx)) {
          findings.push({
            id: rule.id,
            severity: rule.severity,
            category: rule.category,
            message: rule.message,
            hint: rule.hint,
            line: i + 1,
            snippet: line.slice(0, 120),
          });
        }
      } catch (_) {
        /* rule errors never break analysis */
      }
    }
    updateContext(ctx, raw);
  });

  // De-dupe identical rule+line.
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.id}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Roll findings into a severity summary + top items.
function summarize(findings) {
  const counts = { high: 0, medium: 0, low: 0 };
  findings.forEach((f) => (counts[f.severity] = (counts[f.severity] || 0) + 1));
  return {
    counts,
    total: findings.length,
    top: findings
      .slice()
      .sort((a, b) => sev(b.severity) - sev(a.severity))
      .slice(0, 12),
  };
}
function sev(s) {
  return { high: 3, medium: 2, low: 1 }[s] || 0;
}

module.exports = { analyzeSource, summarize, isXppFile, LINE_RULES };
