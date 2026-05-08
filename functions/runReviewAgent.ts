/**
 * runReviewAgent
 * --------------
 * Optional external reviewer — separate context, read-only.
 * Critiques the report without modifying it.
 * Knows nothing about the pipeline that produced it.
 *
 * Input:  { workflow_id, work_output, audit_metadata }
 * Output: { ok, review_passed, critique[], improvement_suggestions[], confidence_delta, score }
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
      temperature: 0.2,
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

// ── Review Agent system prompt ────────────────────────────────────────────────
const REVIEW_AGENT_PROMPT = `
# IDENTITY: Forensic Audit Reviewer

## Role
You are an independent quality reviewer for forensic payroll audit reports.
You critique audit work product for quality, defensibility, and compliance accuracy.
You do not modify reports. You produce a structured critique only.

## Review Criteria

### Evidence Quality
- Are all findings backed by source documents?
- Are extracted values clearly attributed?
- Are assumptions explicitly declared and justified?

### Calculation Accuracy
- Are calculations shown with full workings?
- Are rates (ordinary time, overtime, super, casual loading) correctly applied?
- Are pay period calculations internally consistent?

### Award/Classification Defensibility
- Is the applied award correctly identified?
- Is the classification level justified?
- Are all relevant award clauses referenced?

### Completeness
- Are all required fields present?
- Is missing information declared?
- Is confidence level justified?

### Australian Law Compliance
- Are NMW rates correct ($24.95/hr from 1 July 2025)?
- Is SGC rate correct (12.0% from 1 July 2025)?
- Are NES entitlements correctly applied?
- Are penalty rates correctly applied for the award?

## Output Schema (JSON only)
{
  "review_passed": true,
  "overall_score": 0.0,
  "confidence_delta": 0,
  "critique": [
    {
      "category": "evidence_quality | calculation_accuracy | award_defensibility | completeness | law_compliance",
      "severity": "info | warning | error",
      "finding": "string (specific issue found)",
      "location": "string (which finding or calculation is affected)",
      "recommendation": "string (what should be done)"
    }
  ],
  "improvement_suggestions": ["list of actionable improvements"],
  "strengths": ["list of things done well"],
  "release_recommendation": "approve | approve_with_notes | hold | reject",
  "release_reasoning": "string"
}

## Rules
- You may not modify the report
- You may not introduce new findings
- You may only comment on what is present or absent in the submitted work
- Score >= 0.75 = review_passed true
- Any 'error' severity finding = automatic hold or reject recommendation
`.trim();

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const { workflow_id, work_output, audit_metadata } = body;

    if (!work_output) {
      return Response.json({ ok: false, error: "work_output required" }, { status: 400 });
    }

    const userContent = `
Review the following forensic payroll audit work product.

AUDIT METADATA:
${JSON.stringify(audit_metadata || {}, null, 2)}

WORK PRODUCT:
${JSON.stringify(work_output, null, 2)}

Produce a complete structured critique. Return JSON only.
`.trim();

    const raw = await callLLM(REVIEW_AGENT_PROMPT, userContent);
    const review = JSON.parse(raw);

    // Update workflow if workflow_id provided
    if (workflow_id) {
      try {
        const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
        const workflow = workflows[0];
        if (workflow) {
          const passed = review.review_passed && !review.critique?.some((c: any) => c.severity === "error");
          await client.entities.AuditWorkflow.update(workflow.id, {
            status: passed ? "released" : "review_pending",
            review_passed: passed,
            review_critique: review.critique?.map((c: any) => `[${c.severity.toUpperCase()}] ${c.category}: ${c.finding}`) || [],
            can_release: passed && review.release_recommendation === "approve"
          });
        }
      } catch (_) { /* non-fatal */ }
    }

    return Response.json({
      ok: true,
      workflow_id,
      review_passed: review.review_passed,
      overall_score: review.overall_score,
      confidence_delta: review.confidence_delta || 0,
      critique: review.critique || [],
      improvement_suggestions: review.improvement_suggestions || [],
      strengths: review.strengths || [],
      release_recommendation: review.release_recommendation,
      release_reasoning: review.release_reasoning
    });

  } catch (err: any) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
