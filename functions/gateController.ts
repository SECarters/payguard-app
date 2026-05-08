/**
 * gateController — Controller / Broker
 * -------------------------------------
 * The ONLY globally-aware component in the pipeline.
 * Manages workflow state, answer keys, gate decisions, and audit log.
 *
 * Three-phase model:
 *   [1] Pre-flight gate  — confirms Agent 2 understands domain, rules, task requirements
 *   [2] Main workflow    — runs clean; only deterministic validation checks
 *   [3] Post-flight gate — Agent 2 defends, explains, and audits its own findings
 *
 * Isolation guarantees:
 *   - Answer keys stored here only — never sent to the document worker
 *   - Question Service never sees case documents or workflow purpose
 *   - Document Worker never sees answer keys or gate architecture
 *   - Pre-flight challenge never enters the analysis context
 *   - Post-flight challenge is drawn from completed work output, not invented
 *
 * Actions:
 *   init                — create workflow, generate preflight item, store answer key
 *   submit_preflight    — validate preflight response, open or hold gate
 *   submit_work         — receive completed analysis, run deterministic checks
 *   request_postflight  — generate postflight item from work output
 *   submit_postflight   — validate postflight response, release or escalate
 *   status              — return current workflow state
 */

import base44 from "npm:@base44/sdk";

const client = base44({ appId: Deno.env.get("APP_ID") });
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const FUNCTION_BASE = `https://69fd84730feb263990f95eb3.base44.app/functions`;

// ── Internal call to another function ────────────────────────────────────────
async function callFunction(name: string, body: object): Promise<any> {
  const res = await fetch(`${FUNCTION_BASE}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ── LLM call (controller-side only — validator) ───────────────────────────────
async function callLLM(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    })
  });
  const d = await res.json();
  return d.choices?.[0]?.message?.content || "{}";
}

// ── Controller-side validator prompt ─────────────────────────────────────────
// This LLM call never leaves the controller. Worker never sees it.
const VALIDATOR_PROMPT = `
You are a strict response evaluator.
Score a worker response against an answer key and rubric on a 0.0–1.0 scale.

Return JSON only:
{
  "score": 0.0,
  "passed": false,
  "required_points_found": ["list of required points that appeared in the response"],
  "required_points_missing": ["list of required points that were absent"],
  "disqualifying_errors_found": ["list of disqualifying errors detected"],
  "reasoning": "one sentence explanation of the score"
}

Scoring rules:
- Score >= 0.8 AND zero disqualifying errors = passed: true
- Any disqualifying error = passed: false regardless of score
- Do not reward vague, incomplete, or circular answers
- Partial credit is acceptable for partially correct required points
`.trim();

async function validateCheckpoint(checkpoint: any, workerResponse: string): Promise<any> {
  const rubric = checkpoint.validation_rubric || {};
  const prompt = `
Answer Key:
${checkpoint.answer_key}

Accepted Variants:
${JSON.stringify(checkpoint.accepted_variants || [])}

Required Points (ALL must appear for full score):
${JSON.stringify(rubric.required_points || [])}

Disqualifying Errors (any one = automatic fail):
${JSON.stringify(rubric.disqualifying_errors || [])}

Minimum score to pass: ${rubric.minimum_score_to_pass || 0.8}

Worker Response:
${workerResponse}

Score the response and return JSON.
`.trim();

  const raw = await callLLM(VALIDATOR_PROMPT, prompt);
  return JSON.parse(raw);
}

// ── Deterministic validator (pure logic — no LLM) ────────────────────────────
// Runs during main workflow only. No quiz, no challenges. Just hard checks.
function runDeterministicChecks(pkg: any): { passed: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Required fields
  const required = ["documents_reviewed", "extracted_values", "findings", "confidence"];
  for (const f of required) {
    if (!pkg[f] || (Array.isArray(pkg[f]) && pkg[f].length === 0)) {
      errors.push(`Required field missing or empty: ${f}`);
    }
  }
  if (!pkg.calculations || pkg.calculations.length === 0) {
    warnings.push(`No calculations in package — manual verification required`);
  }

  // 2. Confidence value
  if (!["high", "medium", "low"].includes(pkg.confidence)) {
    errors.push(`Invalid confidence value: "${pkg.confidence}" — must be high, medium, or low`);
  }

  // 3. Super rate (12% ± 0.5% tolerance for 2025-26)
  for (const calc of pkg.calculations || []) {
    if (calc.type === "superannuation" && calc.rate_applied != null) {
      const r = parseFloat(String(calc.rate_applied));
      if (r < 11.5 || r > 12.5) {
        errors.push(`Superannuation rate out of range: ${calc.rate_applied}% (expected 12.0% ± 0.5% for 2025-26)`);
      }
    }

    // 4. Overtime multiplier range
    if (calc.type === "overtime" && calc.multiplier != null) {
      const m = parseFloat(String(calc.multiplier));
      if (m < 1.0 || m > 2.5) {
        errors.push(`Overtime multiplier out of expected range: ${calc.multiplier} (expected 1.5 or 2.0)`);
      }
    }

    // 5. NMW floor check
    if (calc.type === "ordinary_time" && calc.rate_applied != null) {
      const r = parseFloat(String(calc.rate_applied));
      if (r > 0 && r < 24.95) {
        errors.push(`Pay rate $${calc.rate_applied}/hr is below the National Minimum Wage ($24.95/hr from 1 July 2025)`);
      }
    }
  }

  // 6. PAYG effective rate reasonableness (0%–47%)
  for (const finding of pkg.findings || []) {
    if (finding.type === "payg" && finding.effective_rate != null) {
      const r = parseFloat(String(finding.effective_rate));
      if (r < 0 || r > 0.47) {
        warnings.push(`PAYG effective rate unusual: ${(r * 100).toFixed(1)}% — verify against ATO brackets`);
      }
    }
  }

  // 7. Findings must cite a source
  for (const finding of pkg.findings || []) {
    if (!finding.source_document && !finding.source_reference) {
      warnings.push(`Finding "${finding.type || finding.id || "unknown"}" has no source document or award reference`);
    }
  }

  // 8. Missing information must be declared
  if (!pkg.missing_information || pkg.missing_information.length === 0) {
    warnings.push(`No missing information declared — confirm all required documents were supplied`);
  }

  // 9. Award must be identified
  if (!pkg.award_applied) {
    errors.push(`award_applied is missing — the applicable award must be identified`);
  }

  return { passed: errors.length === 0, errors, warnings };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    // ════════════════════════════════════════════════════════════════════════
    // INIT — create workflow + generate pre-flight item
    // ════════════════════════════════════════════════════════════════════════
    if (action === "init") {
      const { audit_id, user_profile_id } = body;

      // Create workflow record
      const workflow = await client.entities.AuditWorkflow.create({
        audit_id,
        user_profile_id,
        status: "preflight_pending",
        current_phase: "preflight",
        preflight_passed: false,
        preflight_attempts: 0,
        deterministic_passed: false,
        postflight_passed: false,
        can_release: false,
        escalated: false,
        error_log: []
      });

      // Question Service generates the item — blind to who uses it
      const itemRes = await callFunction("generateCheckpointItem", { phase: "preflight" });
      if (!itemRes.ok) throw new Error(`Question Service error: ${itemRes.error}`);
      const item = itemRes.item;

      // Controller stores answer key — never forwarded to worker
      await client.entities.WorkflowCheckpoint.create({
        workflow_id: workflow.id,
        phase: "preflight",
        attempt: 1,
        item_id: item.item_id,
        topic: item.topic,
        difficulty: item.difficulty,
        question: item.question,
        answer_key: item.answer_key,          // ← controller-side only
        accepted_variants: item.accepted_variants,
        validation_method: item.validation_method,
        validation_rubric: item.validation_rubric,
        source_reference: item.source_reference,
        gate_status: "pending"
      });

      // Return question only — no answer key in response
      return Response.json({
        ok: true,
        workflow_id: workflow.id,
        phase: "preflight",
        gate_status: "pending",
        can_continue: false,
        can_release: false,
        next_action: "submit_preflight_response",
        question: item.question,   // ← question only
        item_id: item.item_id,
        topic: item.topic
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // SUBMIT PREFLIGHT — validate response, open or hold gate
    // ════════════════════════════════════════════════════════════════════════
    if (action === "submit_preflight") {
      const { workflow_id, worker_response } = body;

      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });

      const checkpoints = await client.entities.WorkflowCheckpoint.filter({ workflow_id, phase: "preflight" });
      const checkpoint = checkpoints.sort((a: any, b: any) => b.attempt - a.attempt)[0];
      if (!checkpoint) return Response.json({ ok: false, error: "Preflight checkpoint not found" }, { status: 404 });

      // Controller validates — answer key never leaves controller
      const validation = await validateCheckpoint(checkpoint, worker_response);
      const passed = validation.passed === true
        && validation.score >= 0.8
        && (validation.disqualifying_errors_found?.length ?? 0) === 0;
      const attempts = (workflow.preflight_attempts || 0) + 1;

      await client.entities.WorkflowCheckpoint.update(checkpoint.id, {
        worker_response,
        gate_status: passed ? "open" : (attempts >= 2 ? "escalated" : "closed"),
        passed,
        score: validation.score,
        score_breakdown: validation,
        reason: validation.reasoning
      });

      // ── PASS → open gate ──
      if (passed) {
        await client.entities.AuditWorkflow.update(workflow.id, {
          status: "preflight_passed",
          current_phase: "analysis",
          preflight_passed: true,
          preflight_attempts: attempts
        });
        return Response.json({
          ok: true,
          workflow_id,
          phase: "preflight",
          gate_status: "open",
          can_continue: true,
          can_release: false,
          next_action: "begin_analysis",
          score: validation.score,
          reason: "Pre-flight gate passed. Analysis may begin."
        });
      }

      // ── FAIL × 2 → escalate ──
      if (attempts >= 2) {
        await client.entities.AuditWorkflow.update(workflow.id, {
          status: "escalated",
          escalated: true,
          preflight_attempts: attempts,
          escalation_reason: `Pre-flight failed after ${attempts} attempts. Final score: ${validation.score}. Missing: ${JSON.stringify(validation.required_points_missing)}`
        });
        return Response.json({
          ok: true,
          workflow_id,
          phase: "preflight",
          gate_status: "escalated",
          can_continue: false,
          can_release: false,
          next_action: "escalate",
          score: validation.score,
          reason: `Pre-flight gate failed after ${attempts} attempts. Workflow escalated for review.`
        });
      }

      // ── FAIL × 1 → retry with new item ──
      await client.entities.AuditWorkflow.update(workflow.id, {
        preflight_attempts: attempts,
        status: "preflight_pending"
      });

      const retryRes = await callFunction("generateCheckpointItem", { phase: "preflight" });
      const newItem = retryRes.item;

      await client.entities.WorkflowCheckpoint.create({
        workflow_id,
        phase: "preflight",
        attempt: attempts + 1,
        item_id: newItem.item_id,
        topic: newItem.topic,
        difficulty: newItem.difficulty,
        question: newItem.question,
        answer_key: newItem.answer_key,        // ← controller-side only
        accepted_variants: newItem.accepted_variants,
        validation_method: newItem.validation_method,
        validation_rubric: newItem.validation_rubric,
        source_reference: newItem.source_reference,
        gate_status: "pending"
      });

      return Response.json({
        ok: true,
        workflow_id,
        phase: "preflight",
        gate_status: "closed",
        can_continue: false,
        can_release: false,
        next_action: "submit_preflight_response",
        question: newItem.question,   // ← question only, no answer key
        item_id: newItem.item_id,
        score: validation.score,
        reason: `Score ${(validation.score * 100).toFixed(0)}% — below threshold. Please complete the verification item to continue.`
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // SUBMIT WORK — main workflow complete; run deterministic checks only
    // No LLM quiz. No challenges. Pure validation logic.
    // ════════════════════════════════════════════════════════════════════════
    if (action === "submit_work") {
      const { workflow_id, work_package } = body;

      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });
      if (!workflow.preflight_passed) {
        return Response.json({ ok: false, error: "Pre-flight gate has not been passed" }, { status: 403 });
      }

      // Deterministic checks — no LLM involvement
      const det = runDeterministicChecks(work_package);

      await client.entities.AuditWorkflow.update(workflow.id, {
        status: det.passed ? "analysis_complete" : "deterministic_failed",
        current_phase: "deterministic_validation",
        deterministic_passed: det.passed,
        deterministic_errors: det.errors,
        deterministic_warnings: det.warnings,
        worker_output: work_package
      });

      if (!det.passed) {
        return Response.json({
          ok: true,
          workflow_id,
          phase: "deterministic_validation",
          gate_status: "failed",
          can_continue: false,
          can_release: false,
          next_action: "revise_work",
          errors: det.errors,
          warnings: det.warnings,
          reason: `Deterministic validation failed — ${det.errors.length} error(s) must be resolved before post-flight.`
        });
      }

      return Response.json({
        ok: true,
        workflow_id,
        phase: "deterministic_validation",
        gate_status: "open",
        can_continue: true,
        can_release: false,
        next_action: "request_postflight",
        warnings: det.warnings,
        reason: `Deterministic validation passed${det.warnings.length > 0 ? ` with ${det.warnings.length} warning(s)` : ""}. Ready for post-flight review.`
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // REQUEST POSTFLIGHT — generate challenge drawn from completed work output
    // ════════════════════════════════════════════════════════════════════════
    if (action === "request_postflight") {
      const { workflow_id } = body;

      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });
      if (!workflow.deterministic_passed) {
        return Response.json({ ok: false, error: "Deterministic validation has not passed" }, { status: 403 });
      }

      // Question Service generates item from the work output — still blind to pipeline
      const itemRes = await callFunction("generateCheckpointItem", {
        phase: "postflight",
        work_summary: workflow.worker_output   // ← drawn from actual output, not invented
      });
      if (!itemRes.ok) throw new Error(`Question Service error: ${itemRes.error}`);
      const item = itemRes.item;

      await client.entities.WorkflowCheckpoint.create({
        workflow_id,
        phase: "postflight",
        attempt: 1,
        item_id: item.item_id,
        topic: item.topic,
        difficulty: item.difficulty,
        question: item.question,
        answer_key: item.answer_key,          // ← controller-side only
        accepted_variants: item.accepted_variants,
        validation_method: item.validation_method,
        validation_rubric: item.validation_rubric,
        source_reference: item.source_reference,
        gate_status: "pending"
      });

      await client.entities.AuditWorkflow.update(workflow.id, {
        status: "postflight_pending",
        current_phase: "postflight"
      });

      return Response.json({
        ok: true,
        workflow_id,
        phase: "postflight",
        gate_status: "pending",
        can_continue: false,
        can_release: false,
        next_action: "submit_postflight_response",
        question: item.question,   // ← question only, no answer key
        item_id: item.item_id,
        topic: item.topic
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // SUBMIT POSTFLIGHT — validate defence; release or escalate
    // ════════════════════════════════════════════════════════════════════════
    if (action === "submit_postflight") {
      const { workflow_id, worker_response } = body;

      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });

      const checkpoints = await client.entities.WorkflowCheckpoint.filter({ workflow_id, phase: "postflight" });
      const checkpoint = checkpoints.sort((a: any, b: any) => b.attempt - a.attempt)[0];
      if (!checkpoint) return Response.json({ ok: false, error: "Post-flight checkpoint not found" }, { status: 404 });

      const validation = await validateCheckpoint(checkpoint, worker_response);
      const passed = validation.passed === true
        && validation.score >= 0.8
        && (validation.disqualifying_errors_found?.length ?? 0) === 0;
      const attempts = (workflow.postflight_attempts || 0) + 1;

      await client.entities.WorkflowCheckpoint.update(checkpoint.id, {
        worker_response,
        gate_status: passed ? "open" : (attempts >= 2 ? "escalated" : "closed"),
        passed,
        score: validation.score,
        score_breakdown: validation,
        reason: validation.reasoning
      });

      // ── PASS → release ──
      if (passed) {
        await client.entities.AuditWorkflow.update(workflow.id, {
          status: "released",
          current_phase: "released",
          postflight_passed: true,
          postflight_attempts: attempts,
          can_release: true
        });
        return Response.json({
          ok: true,
          workflow_id,
          phase: "postflight",
          gate_status: "open",
          can_continue: true,
          can_release: true,
          next_action: "release_report",
          score: validation.score,
          reason: "Post-flight gate passed. Report is cleared for release."
        });
      }

      // ── FAIL × 2 → escalate ──
      if (attempts >= 2) {
        await client.entities.AuditWorkflow.update(workflow.id, {
          status: "escalated",
          escalated: true,
          postflight_attempts: attempts,
          escalation_reason: `Post-flight failed after ${attempts} attempts. Score: ${validation.score}. Missing: ${JSON.stringify(validation.required_points_missing)}`
        });
        return Response.json({
          ok: true,
          workflow_id,
          phase: "postflight",
          gate_status: "escalated",
          can_continue: false,
          can_release: false,
          next_action: "escalate",
          score: validation.score,
          reason: "Post-flight gate failed. Report flagged for manual review before release."
        });
      }

      // ── FAIL × 1 → return missing points only (not full answer key) ──
      await client.entities.AuditWorkflow.update(workflow.id, {
        postflight_attempts: attempts
      });

      return Response.json({
        ok: true,
        workflow_id,
        phase: "postflight",
        gate_status: "closed",
        can_continue: false,
        can_release: false,
        next_action: "submit_postflight_response",
        question: checkpoint.question,
        item_id: checkpoint.item_id,
        score: validation.score,
        // ← missing points only — full answer key never returned to worker
        guidance: `The following points were not adequately addressed: ${JSON.stringify(validation.required_points_missing)}`,
        reason: `Score ${(validation.score * 100).toFixed(0)}% — below threshold. Address the missing points and resubmit.`
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // STATUS — read-only workflow state
    // ════════════════════════════════════════════════════════════════════════
    if (action === "status") {
      const { workflow_id } = body;
      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });

      return Response.json({
        ok: true,
        workflow_id,
        status: workflow.status,
        current_phase: workflow.current_phase,
        preflight_passed: workflow.preflight_passed,
        deterministic_passed: workflow.deterministic_passed,
        postflight_passed: workflow.postflight_passed,
        can_release: workflow.can_release,
        escalated: workflow.escalated,
        escalation_reason: workflow.escalation_reason || null,
        deterministic_errors: workflow.deterministic_errors || [],
        deterministic_warnings: workflow.deterministic_warnings || []
      });
    }

    return Response.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: any) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
