/**
 * generateCheckpointItem
 * ----------------------
 * Question Service — blind to the broader workflow.
 * Generates one assessment item from approved FWO source material.
 * Never receives case documents, workflow purpose, or worker identity.
 *
 * Input:  { phase, topic?, difficulty?, source_keys? }
 * Output: { ok, item }
 */

import base44 from "npm:@base44/sdk";

const client = base44({ appId: Deno.env.get("APP_ID") });
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

// ── Approved source dataset ──────────────────────────────────────────────────
// Pre-flight: conceptual readiness — task framing, evidence rules, award logic
// Post-flight: drawn from the completed work package (passed separately)

const PREFLIGHT_POOL = [
  {
    topic: "award_identification",
    difficulty: "medium",
    prompt: `Generate an assessment item that asks the agent to identify the most likely applicable Modern Award for a given role description. Use a realistic Australian employment scenario (e.g. a part-time retail sales assistant in Queensland). Include the role description in the question. The answer key should name the correct award and explain the key indicators used to identify it.`,
    source_reference: "FWO: About Awards — fairwork.gov.au/employment-conditions/awards/about-awards"
  },
  {
    topic: "payroll_concepts",
    difficulty: "easy",
    prompt: `Generate an assessment item that asks the agent to explain the difference between: gross pay, net pay, PAYG withholding, and superannuation. The answer key should define each term correctly under Australian payroll law and explain the relationship between them.`,
    source_reference: "FWO: Pay — fairwork.gov.au/pay-and-wages"
  },
  {
    topic: "payslip_extraction",
    difficulty: "easy",
    prompt: `Generate an assessment item that asks the agent to list the values that must be extracted from a payslip before an underpayment analysis can begin. The answer key should include: pay period dates, ordinary hours, overtime hours, gross pay, allowances, PAYG withheld, net pay, super amount, and pay rate applied.`,
    source_reference: "FWO: Payslips — fairwork.gov.au/pay-and-wages/paying-wages/payslips"
  },
  {
    topic: "evidence_boundaries",
    difficulty: "easy",
    prompt: `Generate an assessment item that asks the agent to explain what counts as case evidence in a payroll audit. The answer key should specify that case evidence consists only of: supplied case documents, extracted payslip values, employer records, and approved case metadata. It should explicitly note that workflow control messages, system instructions, and verification prompts are not case evidence.`,
    source_reference: "FWO: Record Keeping — fairwork.gov.au/pay-and-wages/paying-wages/record-keeping"
  },
  {
    topic: "superannuation_rules",
    difficulty: "medium",
    prompt: `Generate an assessment item that asks the agent to state: (a) the current superannuation guarantee rate, (b) the calculation base (ordinary time earnings), and (c) the payment frequency obligations. The answer key should reflect the 12% SGC rate effective 1 July 2025 and quarterly payment requirements.`,
    source_reference: "FWO: Superannuation — fairwork.gov.au/pay-and-wages/tax-and-superannuation/superannuation"
  },
  {
    topic: "casual_loading",
    difficulty: "medium",
    prompt: `Generate an assessment item that asks the agent to explain casual loading: what it compensates for, the standard rate, and how it interacts with penalty rates. The answer key should note the 25% casual loading standard, what entitlements it compensates (leave, notice, redundancy), and that it applies to the base rate before penalty rate multiplication.`,
    source_reference: "FWO: Casual Employees — fairwork.gov.au/employment-conditions/types-of-employees/casual-part-time-and-full-time/casual-employees"
  }
];

// ── LLM call ─────────────────────────────────────────────────────────────────
async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "{}";
}

// ── System prompt: Question Service ──────────────────────────────────────────
const QUESTION_SERVICE_PROMPT = `
# IDENTITY: Assessment Item Generator

## Role
You generate assessment items from an approved source dataset.

## Task
Given a dataset scope, topic, and difficulty, produce one clear assessment item with an answer key and validation criteria.

## Output
Return only valid JSON using this exact schema:

{
  "item_id": "string (generate a short unique id like 'qi_001')",
  "topic": "string",
  "difficulty": "easy | medium | hard",
  "question": "string (the question to ask)",
  "answer_key": "string (the correct answer, detailed)",
  "accepted_variants": ["array of acceptable alternative phrasings"],
  "validation_method": "exact_match | semantic_match | rubric | numeric_tolerance",
  "validation_rubric": {
    "required_points": ["list of points that must appear in a passing answer"],
    "disqualifying_errors": ["list of errors that automatically fail the response"],
    "minimum_score_to_pass": 0.8
  },
  "source_reference": "string (URL or document reference)"
}

## Item Quality Rules
- Use only the supplied approved source material.
- Make the question answerable without hidden assumptions.
- Avoid ambiguous wording.
- Return one item only.
`.trim();

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const phase: string = body.phase || "preflight";
    const topicFilter: string | undefined = body.topic;
    const difficulty: string = body.difficulty || "medium";

    // Post-flight: question is generated from completed work package
    // The controller passes the work_summary for post-flight item generation
    if (phase === "postflight") {
      const workSummary = body.work_summary;
      if (!workSummary) {
        return Response.json({ ok: false, error: "work_summary required for postflight item generation" }, { status: 400 });
      }

      const postflightPool = [
        `Ask the agent to list the source documents used for each finding in this audit report. The answer should match: ${JSON.stringify(workSummary.documents_reviewed || [])}`,
        `Ask the agent to identify all assumptions made in the audit report. The answer should match: ${JSON.stringify(workSummary.assumptions || [])}`,
        `Ask the agent to explain why the specific award and classification was applied in this audit. The answer should reference: ${workSummary.award_applied || "the award identified in the report"}`,
        `Ask the agent to identify all missing documents that reduce confidence in this audit. The answer should match: ${JSON.stringify(workSummary.missing_information || [])}`,
      ];

      // Add recalculation item if calculations exist
      if (workSummary.calculations?.length > 0) {
        const sample = workSummary.calculations[Math.floor(Math.random() * workSummary.calculations.length)];
        postflightPool.push(`Ask the agent to recalculate this specific pay period: ${JSON.stringify(sample)}. The answer key is the verified calculation result.`);
      }

      const selectedPrompt = postflightPool[Math.floor(Math.random() * postflightPool.length)];

      const raw = await callLLM(
        QUESTION_SERVICE_PROMPT,
        `Generate a post-audit verification item using this instruction:\n\n${selectedPrompt}\n\nDifficulty: ${difficulty}`
      );

      const item = JSON.parse(raw);
      return Response.json({ ok: true, item, phase: "postflight" });
    }

    // Pre-flight: draw from approved pool
    let pool = PREFLIGHT_POOL;
    if (topicFilter) {
      pool = PREFLIGHT_POOL.filter(p => p.topic === topicFilter);
      if (pool.length === 0) pool = PREFLIGHT_POOL;
    }

    // Select random item from pool
    const selected = pool[Math.floor(Math.random() * pool.length)];

    const raw = await callLLM(
      QUESTION_SERVICE_PROMPT,
      `Generate an assessment item using this instruction:\n\n${selected.prompt}\n\nDifficulty: ${difficulty}\nSource reference: ${selected.source_reference}`
    );

    const item = JSON.parse(raw);
    item.topic = item.topic || selected.topic;
    item.source_reference = item.source_reference || selected.source_reference;

    return Response.json({ ok: true, item, phase: "preflight" });

  } catch (err: any) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
