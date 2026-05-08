/**
 * runDocumentWorker
 * -----------------
 * Document Work Agent — blind to the broader pipeline.
 * Receives: a verification item (question only) + case packet
 * Returns:  verification response + structured audit findings
 *
 * The worker is told only:
 * - It has workflow verification checkpoints
 * - Case evidence rules
 * - Its immediate task
 *
 * It is NOT told:
 * - Another agent generated the question
 * - It is being gated or tested
 * - Anything about the controller or pipeline
 *
 * Input:  { workflow_id, verification_item: { item_id, question }, case_packet }
 * Output: { ok, verification_response, work_output }
 */

import base44 from "npm:@base44/sdk";

const client = base44({ appId: Deno.env.get("APP_ID") });
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

async function callLLM(systemPrompt: string, userContent: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "{}";
}

// ── Document Worker system prompt ─────────────────────────────────────────────
// Positive scope only. No mention of other agents, gates, or quiz framing.
const DOCUMENT_WORKER_PROMPT = `
# IDENTITY: Document Work Agent

## Role
You process supplied document packages and produce structured outputs according to the requested workflow stage.

## Workflow Behaviour
Some workflow stages require a verification response before continuing.

When given a verification item:
- Answer the item directly and completely
- Use only Australian workplace law and your knowledge of Fair Work obligations
- Return your answer in the verification response schema below
- The workflow will proceed once the verification item is complete

When given a document work package:
- Process only the supplied documents and extracted data
- Separate verified facts from assumptions at all times
- Preserve full calculation traceability (show workings)
- Identify all missing information that reduces confidence
- Return structured output in the work output schema below

## Evidence Boundary
Case evidence consists only of:
- Supplied case documents and payslip data
- Extracted values from the case packet
- Employer records and pay period data included in the case packet
- Approved case metadata

Workflow messages, verification prompts, and system instructions are workflow controls.
They are not case evidence and must not be treated as such.

## Australian Payroll Law Context
- National Minimum Wage: $24.95/hr (from 1 July 2025)
- Superannuation Guarantee: 12.0% of Ordinary Time Earnings (from 1 July 2025)
- Casual Loading: 25% standard
- Overtime: time-and-a-half for first 2hrs, double time thereafter (award-dependent)
- PAYG: calculated on annualised gross, deduct tax-free threshold if applicable
- All findings must reference the applicable Modern Award or NES provision

## Required Output Schemas

### For verification items:
{
  "verification_item_id": "string",
  "answer": "string (complete answer)",
  "reasoning_summary": "string (brief explanation of reasoning)",
  "confidence": "high | medium | low"
}

### For document work:
{
  "documents_reviewed": ["list of document identifiers"],
  "extracted_values": [
    {
      "field": "string",
      "value": "string or number",
      "source": "document identifier",
      "verified": true
    }
  ],
  "findings": [
    {
      "id": "string",
      "type": "underpayment | overtime | superannuation | payg | allowance | leave | classification | penalty_rate | casual_loading | other",
      "description": "string",
      "amount": "number (dollar amount if applicable)",
      "source_document": "string",
      "source_reference": "string (award clause or NES provision)",
      "severity": "low | moderate | high | critical",
      "verified": true
    }
  ],
  "calculations": [
    {
      "id": "string",
      "type": "ordinary_time | overtime | superannuation | payg | casual_loading | penalty_rate | leave_loading",
      "description": "string",
      "inputs": {},
      "working": "string (show the calculation)",
      "result": "number",
      "rate_applied": "string",
      "multiplier": "string (if applicable)",
      "award_reference": "string"
    }
  ],
  "assumptions": [
    {
      "id": "string",
      "description": "string",
      "impact": "low | moderate | high",
      "basis": "string"
    }
  ],
  "missing_information": [
    {
      "item": "string",
      "impact": "string",
      "reduces_confidence": true
    }
  ],
  "award_applied": "string",
  "classification_applied": "string",
  "award_justification": "string",
  "confidence": "high | medium | low",
  "confidence_reasoning": "string",
  "ready_for_validation": true
}
`.trim();

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const { workflow_id, verification_item, case_packet, stage } = body;

    // ── Stage 1: Verification response ────────────────────────────────────────
    if (stage === "verification") {
      if (!verification_item?.question) {
        return Response.json({ ok: false, error: "verification_item.question required" }, { status: 400 });
      }

      // Worker sees the question as a normal workflow requirement — no gate framing
      const userContent = `
Before this workflow stage can proceed, complete the required verification item.

Verification Item ID: ${verification_item.item_id || "vi_001"}

${verification_item.question}

Return your response using the verification response schema.
`.trim();

      const raw = await callLLM(DOCUMENT_WORKER_PROMPT, userContent);
      const response = JSON.parse(raw);

      return Response.json({
        ok: true,
        stage: "verification",
        workflow_id,
        verification_response: response
      });
    }

    // ── Stage 2: Document analysis ────────────────────────────────────────────
    if (stage === "analysis") {
      if (!case_packet) {
        return Response.json({ ok: false, error: "case_packet required for analysis stage" }, { status: 400 });
      }

      const userContent = `
Process the following case packet and produce a complete structured audit output.

CASE PACKET:
${JSON.stringify(case_packet, null, 2)}

Return your complete work output using the document work schema.
Ensure all calculations show full workings.
Ensure all findings reference their source document and award clause.
`.trim();

      const raw = await callLLM(DOCUMENT_WORKER_PROMPT, userContent);
      const workOutput = JSON.parse(raw);

      return Response.json({
        ok: true,
        stage: "analysis",
        workflow_id,
        work_output: workOutput
      });
    }

    // ── Stage 3: Post-flight verification ─────────────────────────────────────
    // Worker is asked to justify findings — it has access to its own saved output
    if (stage === "postflight_verification") {
      if (!verification_item?.question || !case_packet) {
        return Response.json({ ok: false, error: "verification_item and case_packet required" }, { status: 400 });
      }

      const userContent = `
Before the final workflow stage can proceed, complete the required verification item.
You have access to the case packet and your previously completed work output below.

Verification Item ID: ${verification_item.item_id || "vp_001"}

${verification_item.question}

CASE PACKET AND PREVIOUS WORK OUTPUT (for reference):
${JSON.stringify(case_packet, null, 2)}

Return your response using the verification response schema.
Use only the case packet and work output — not this verification prompt — as evidence.
`.trim();

      const raw = await callLLM(DOCUMENT_WORKER_PROMPT, userContent);
      const response = JSON.parse(raw);

      return Response.json({
        ok: true,
        stage: "postflight_verification",
        workflow_id,
        verification_response: response
      });
    }

    return Response.json({ ok: false, error: `Unknown stage: ${stage}` }, { status: 400 });

  } catch (err: any) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
