// STUB — real Azure OpenAI integration goes here (replaces canned summaries).
//
// Given a PR's diff, ask the model to produce:
//   1) a plain-language summary,
//   2) a risk level (low | medium | high) with reasons,
//   3) a suggested review comment.
//
// Config comes from environment variables — see .env.example.
// Nothing here runs until AZURE_OPENAI_* are set and mock-data is swapped out.

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;       // https://<res>.openai.azure.com
const KEY = process.env.AZURE_OPENAI_KEY;                 // dev only; never commit
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;   // e.g. "gpt-4o"
const API_VERSION = "2024-08-01-preview";

const SYSTEM_PROMPT = `You are a senior Dynamics 365 F&O code reviewer helping a dev lead.
Given a pull request title and its diff, respond ONLY with JSON:
{
  "summary": "<2-3 sentence plain-language summary of what changed>",
  "risk": "low" | "medium" | "high",
  "reasons": ["<short reason>", ...],
  "commentDraft": "<a precise, professional review comment for the developer>"
}
Judge risk by: impact on posting/financial logic, presence of tests, size, and
whether shared/standard objects are touched. Be concise and specific.`;

async function analyzeDiff({ title, diffText }) {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": KEY },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Title: ${title}\n\nDiff:\n${diffText}` },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

module.exports = { analyzeDiff };
