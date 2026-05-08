/**
 * gateController
 * --------------
 * Controller / Broker — the only globally-aware component.
 * Manages workflow state, answer keys, gate decisions, and audit log.
 * Never exposes answer keys or system architecture to the document worker.
 *
 * Input:  { action, workflow_id?, audit_id?, user_profile_id?, phase?, worker_response?, work_package? }
 * Output: { ok, workflow_id, phase, gate_status, can_continue, can_release, next_action, question?, reason? }
 *
 * Actions:
 *   "init"           — create workflow, request preflight item, store answer key
 *   "submit_preflight" — receive worker preflight response, validate, open/close gate
 *   "begin_analysis" — mark analysis as running (called after preflight passes)
 *   "submit_work"    — receive completed work package, run deterministic validation
 *   "request_postflight" — generate postflight item from work package
 *   "submit_postflight"  — receive worker postflight response, validate, release/reject
 *   "status"         — return current workflow state
 */

import base44 from "npm:@base44/sdk";

const client = base44({ appId: Deno.env.get("APP_ID") });
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const FUNCTION_BASE = `https://69fd84730feb263990f95eb3.base44.app/functions`;

// ── Helpers ──────────────────────────────────────────────────────────────────
async function callFunction(name: string, body: object): Promise<any> {
  const res = await fetch(`${FUNCTION_BASE}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

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

// ── Validator prompt — controller-side only ───────────────────────────────────
const VALIDATOR_PROMPT = `
# IDENTITY: Response Validator

## Role
You evaluate a worker response against an answer key and validation rubric.

## Task
Score the response on a 0.0–1.0 scale based on the rubric.

## Output (JSON only)
{
  "score": 0.0,
  "passed": false,
  "required_points_found": [],
  "required_points_missing": [],
  "disqualifying_errors_found": [],
  "reasoning": "brief explanation"
}

## Rules
- Score >= 0.8 = passed
- Any disqualifying error = automatic fail regardless of score
- Be strict but fair
- Do not reward vague or incomplete answers
`.trim();

async function validateResponse(checkpoint: any, workerResponse: string): Promise<any> {
  const rubric = checkpoint.validation_rubric || {};
  const evalPrompt = `
Answer Key: ${checkpoint.answer_key}

Accepted Variants: ${JSON.stringify(checkpoint.accepted_variants || [])}

Validation Rubric:
Required Points: ${JSON.stringify(rubric.required_points || [])}
Disqualifying Errors: ${JSON.stringify(rubric.disqualifying_errors || [])}
Minimum Score: ${rubric.minimum_score_to_pass || 0.8}

Worker Response: ${workerResponse}

Evaluate the worker response against the answer key and rubric. Return your assessment in the required JSON format.
`.trim();

  const raw = await callLLM(VALIDATOR_PROMPT, evalPrompt);
  return JSON.parse(raw);
}

// ── Deterministic validator ───────────────────────────────────────────────────
function runDeterministicChecks(workPackage: any): { passed: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields check
  const required = ["documents_reviewed", "extracted_values", "findings", "calculations", "confidence"];
  for (const field of required) {
    if (!workPackage[field] || (Array.isArray(workPackage[field]) && workPackage[field].length === 0)) {
      if (field === "calculations") {
        warnings.push(`No calculations found in work package — manual review required`);
      } else {
        errors.push(`Required field missing or empty: ${field}`);
      }
    }
  }

  // Confidence check
  if (!["high", "medium", "low"].includes(workPackage.confidence)) {
    errors.push(`Invalid confidence value: ${workPackage.confidence}`);
  }

  // Super rate check (if present)
  for (const calc of workPackage.calculations || []) {
    if (calc.type === "superannuation" && calc.rate_applied) {
      const rate = parseFloat(calc.rate_applied);
      if (rate < 11.5 || rate > 12.5) {
        errors.push(`Super rate out of expected range: ${calc.rate_applied}% (expected ~12% for 2025-26)`);
      }
    }
    // OT rate check
    if (calc.type === "overtime" && calc.multiplier) {
      const m = parseFloat(calc.multiplier);
      if (m < 1.0 || m > 2.5) {
        errors.push(`Overtime multiplier out of expected range: ${calc.multiplier}`);
      }
    }
    // NMW check
    if (calc.type === "ordinary_time" && calc.rate_applied) {
      const rate = parseFloat(calc.rate_applied);
      if (rate < 24.95) {
        errors.push(`Pay rate below NMW: $${calc.rate_applied}/hr (NMW: $24.95/hr from 1 July 2025)`);
      }
    }
  }

  // PAYG reasonableness
  for (const finding of workPackage.findings || []) {
    if (finding.type === "payg" && finding.effective_rate) {
      const rate = parseFloat(finding.effective_rate);
      if (rate < 0 || rate > 0.47) {
        warnings.push(`PAYG effective rate seems unusual: ${(rate * 100).toFixed(1)}%`);
      }
    }
  }

  // Findings must reference source documents
  for (const finding of workPackage.findings || []) {
    if (!finding.source_document && !finding.source_reference) {
      warnings.push(`Finding '${finding.type || finding.id || "unknown"}' has no source document reference`);
    }
  }

  // Missing information check
  if (!workPackage.missing_information || workPackage.missing_information.length === 0) {
    warnings.push(`No missing information declared — verify completeness`);
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action;

    // ── INIT: create workflow + request preflight item ────────────────────────
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

      // Request item from Question Service (controller-side call)
      const itemRes = await callFunction("generateCheckpointItem", { phase: "preflight" });
      if (!itemRes.ok) throw new Error("Question Service failed: " + itemRes.error);

      const item = itemRes.item;

      // Store checkpoint WITH answer key (controller-side only)
      await client.entities.WorkflowCheckpoint.create({
        workflow_id: workflow.id,
        phase: "preflight",
        attempt: 1,
        item_id: item.item_id,
        topic: item.topic,
        difficulty: item.difficulty,
        question: item.question,
        answer_key: item.answer_key,         // stored here, never sent to worker
        accepted_variants: item.accepted_variants,
        validation_method: item.validation_method,
        validation_rubric: item.validation_rubric,
        source_reference: item.source_reference,
        gate_status: "pending"
      });

      // Return to caller — question only, no answer key
      return Response.json({
        ok: true,
        workflow_id: workflow.id,
        phase: "preflight",
        gate_status: "pending",
        can_continue: false,
        can_release: false,
        next_action: "submit_preflight_response",
        // ↓ Only the question reaches the caller — answer key stays controller-side
        question: item.question,
        item_id: item.item_id,
        topic: item.topic
      });
    }

    // ── SUBMIT PREFLIGHT ──────────────────────────────────────────────────────
    if (action === "submit_preflight") {
      const { workflow_id, worker_response } = body;

      // Load workflow
      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });

      // Load latest preflight checkpoint
      const checkpoints = await client.entities.WorkflowCheckpoint.filter({ workflow_id, phase: "preflight" });
      const checkpoint = checkpoints.sort((a: any, b: any) => b.attempt - a.attempt)[0];
      if (!checkpoint) return Response.json({ ok: false, error: "Checkpoint not found" }, { status: 404 });

      // Validate response (controller uses answer key — worker never sees it)
      const validation = await validateResponse(checkpoint, worker_response);

      const passed = validation.passed && validation.score >= 0.8 && validation.disqualifying_errors_found?.length === 0;
      const attempts = (workflow.preflight_attempts || 0) + 1;

      // Update checkpoint
      await client.entities.WorkflowCheckpoint.update(checkpoint.id, {
        worker_response,
        gate_status: passed ? "open" : (attempts >= 2 ? "escalated" : "closed"),
        passed,
        score: validation.score,
        score_breakdown: validation,
        reason: validation.reasoning
      });

      if (passed) {
        // Gate opens — update workflow
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
          reason: "Preflight gate passed. Analysis may begin."
        });
      }

      // Failed — retry or escalate
      if (attempts >= 2) {
        await client.entities.AuditWorkflow.update(workflow.id, {
          status: "escalated",
          escalated: true,
          preflight_attempts: attempts,
          escalation_reason: `Preflight gate failed after ${attempts} attempts. Score: ${validation.score}. Reason: ${validation.reasoning}`
        });

        return Response.json({
          ok: true,
          workflow_id,
          phase: "preflight",
          gate_status: "escalated",
          can_continue: false,
          can_release: false,
          next_action: "escalate",
          reason: `Preflight failed after ${attempts} attempts. Escalating for review.`
        });
      }

      // Retry — generate new item
      await client.entities.AuditWorkflow.update(workflow.id, {
        preflight_attempts: attempts,
        status: "preflight_pending"
      });

      const itemRes = await callFunction("generateCheckpointItem", { phase: "preflight" });
      const newItem = itemRes.item;

      await client.entities.WorkflowCheckpoint.create({
        workflow_id,
        phase: "preflight",
        attempt: attempts + 1,
        item_id: newItem.item_id,
        topic: newItem.topic,
        difficulty: newItem.difficulty,
        question: newItem.question,
        answer_key: newItem.answer_key,
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
        question: newItem.question,
        item_id: newItem.item_id,
        reason: `Verification required. Score: ${(validation.score * 100).toFixed(0)}%. Please complete the verification item to continue.`
      });
    }

    // ── SUBMIT WORK ───────────────────────────────────────────────────────────
    if (action === "submit_work") {
      const { workflow_id, work_package } = body;

      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });
      if (!workflow.preflight_passed) return Response.json({ ok: false, error: "Preflight gate not passed" }, { status: 403 });

      // Run deterministic validation
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
          gate_status: det.errors.length > 0 ? "failed" : "open",
          can_continue: false,
          can_release: false,
          next_action: "revise_work",
          errors: det.errors,
          warnings: det.warnings,
          reason: `Deterministic validation failed: ${det.errors.join("; ")}`
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
        reason: "Deterministic validation passed. Post-flight gate required before release."
      });
    }

    // ── REQUEST POSTFLIGHT ────────────────────────────────────────────────────
    if (action === "request_postflight") {
      const { workflow_id } = body;

      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });
      if (!workflow.deterministic_passed) return Response.json({ ok: false, error: "Deterministic validation not passed" }, { status: 403 });

      // Generate postflight item from work package (Question Service still blind to full context)
      const itemRes = await callFunction("generateCheckpointItem", {
        phase: "postflight",
        work_summary: workflow.worker_output
      });
      if (!itemRes.ok) throw new Error("Question Service failed: " + itemRes.error);

      const item = itemRes.item;

      await client.entities.WorkflowCheckpoint.create({
        workflow_id,
        phase: "postflight",
        attempt: 1,
        item_id: item.item_id,
        topic: item.topic,
        difficulty: item.difficulty,
        question: item.question,
        answer_key: item.answer_key,
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
        question: item.question,
        item_id: item.item_id,
        topic: item.topic
      });
    }

    // ── SUBMIT POSTFLIGHT ─────────────────────────────────────────────────────
    if (action === "submit_postflight") {
      const { workflow_id, worker_response } = body;

      const workflows = await client.entities.AuditWorkflow.filter({ id: workflow_id });
      const workflow = workflows[0];
      if (!workflow) return Response.json({ ok: false, error: "Workflow not found" }, { status: 404 });

      const checkpoints = await client.entities.WorkflowCheckpoint.filter({ workflow_id, phase: "postflight" });
      const checkpoint = checkpoints.sort((a: any, b: any) => b.attempt - a.attempt)[0];
      if (!checkpoint) return Response.json({ ok: false, error: "Postflight checkpoint not found" }, { status: 404 });

      const validation = await validateResponse(checkpoint, worker_response);
      const passed = validation.passed && validation.score >= 0.8 && validation.disqualifying_errors_found?.length === 0;
      const attempts = (workflow.postflight_attempts || 0) + 1;

      await client.entities.WorkflowCheckpoint.update(checkpoint.id, {
        worker_response,
        gate_status: passed ? "open" : (attempts >= 2 ? "escalated" : "closed"),
        passed,
        score: validation.score,
        score_breakdown: validation,
        reason: validation.reasoning
      });

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
          reason: "Post-flight gate passed. Report is cleared for release."
        });
      }

      // Failed postflight
      if (attempts >= 2) {
        await client.entities.AuditWorkflow.update(workflow.id, {
          status: "escalated",
          escalated: true,
          postflight_attempts: attempts,
          escalation_reason: `Post-flight gate failed after ${attempts} attempts. Score: ${validation.score}. Failing points: ${JSON.stringify(validation.required_points_missing)}`
        });

        return Response.json({
          ok: true,
          workflow_id,
          phase: "postflight",
          gate_status: "escalated",
          can_continue: false,
          can_release: false,
          next_action: "escalate",
          reason: "Post-flight gate failed. Report requires manual review before release."
        });
      }

      // Return failing items only (not full answer key)
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
        // Only return what's missing — not the full answer key
        guidance: `The following points were not adequately addressed: ${JSON.stringify(validation.required_points_missing)}`,
        reason: `Post-flight verification score: ${(validation.score * 100).toFixed(0)}%. Please address the missing points.`
      });
    }

    // ── STATUS ────────────────────────────────────────────────────────────────
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
        escalation_reason: workflow.escalation_reason,
        error_log: workflow.error_log
      });
    }

    return Response.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: any) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
