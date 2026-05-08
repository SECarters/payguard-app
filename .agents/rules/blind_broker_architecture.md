# Blind Broker Pipeline — Architecture Reference
# PayGuard Forensic Audit Workflow
# Last updated: 2026-05-09

## Overview

A 5-stage blind broker pipeline for forensic payroll audits.
Only the Controller understands the full system.
Each worker sees only its immediate task.

---

## Pipeline Stages

```
[1] Pre-flight Gate        → gateController (function)
[2] Main Document Analysis → runDocumentWorker (function)
[3] Deterministic Validator → runDeterministicValidator (function)
[4] Post-flight Audit Gate  → gateController (function, post mode)
[5] Optional Review Agent   → runReviewAgent (function)
```

---

## Component Identities

### Question Service (generateCheckpointItem)
- Input: topic, difficulty, gate_phase, source_material_keys
- Output: { item_id, question, answer_key, validation_rubric, source_reference }
- Knows: FWO corpus only
- Does NOT know: case documents, workflow purpose, who uses the question

### Controller / Broker (gateController)
- The only globally-aware component
- Manages: workflow state, answer keys, gate open/close decisions, audit log
- Input: workflow_id, phase, checkpoint_response (optional)
- Output: { gate_status, can_continue, can_release, next_action }
- Stores answer keys in WorkflowCheckpoint entity (never sent to worker)

### Document Worker (runDocumentWorker)
- Input: case_packet (payslip data, profile, award), verification_item (question only)
- Output: structured audit findings + verification response
- Knows: its immediate task only
- Does NOT know: question origin, gate system, other agents

### Deterministic Validator (runDeterministicValidator)
- Pure logic, no LLM
- Checks: calculation accuracy, required fields, schema compliance, super %, PAYG range
- Input: worker output package
- Output: { passed, errors[], warnings[], field_checks{} }

### Review Agent (runReviewAgent) — optional
- Separate context, read-only
- Critiques report quality, evidence use, and finding defensibility
- Cannot modify the report
- Output: { review_passed, critique[], improvement_suggestions[], confidence_delta }

---

## Isolation Rules

```json
{
  "separate_agent_sessions": true,
  "answer_key_stored_controller_side_only": true,
  "item_generator_receives_case_documents": false,
  "item_generator_receives_workflow_purpose": false,
  "document_worker_receives_answer_key": false,
  "document_worker_receives_agent_identity": false,
  "preflight_question_written_to_case_record": false,
  "challenge_content_treated_as_case_evidence": false
}
```

---

## Entity: WorkflowCheckpoint
Stores gate state and answer keys — controller-side only.
Fields: workflow_id, phase, item_id, question, answer_key, validation_rubric,
        worker_response, gate_status, passed, score, reason, created_date

## Entity: AuditWorkflow
Top-level workflow tracker.
Fields: audit_id, status, current_phase, preflight_passed, deterministic_passed,
        postflight_passed, review_passed, can_release, error_log, created_date

---

## Pre-flight Gate Challenge Pool
Topics drawn from FWO corpus. Examples:
- Identify applicable award from role description
- Explain gross pay vs net pay vs PAYG vs superannuation
- State required payslip extraction values before underpayment analysis
- Explain evidence boundary rules (verification content ≠ case evidence)

Pass condition: Correct task framing + evidence-handling rules demonstrated.

## Post-flight Gate Challenge Pool
Drawn from the completed work package. Examples:
- List source documents used for each finding
- Identify assumptions made in the report
- Recalculate one randomly selected pay period from extracted data
- Explain why the selected award/classification was used
- Identify missing documents that reduce confidence

Pass condition: Agent defends report using saved evidence and calculations.

---

## Workflow State Machine

```
CREATED → PREFLIGHT_PENDING → PREFLIGHT_PASSED → ANALYSIS_RUNNING
       → DETERMINISTIC_VALIDATION → POSTFLIGHT_PENDING → POSTFLIGHT_PASSED
       → [REVIEW_PENDING →] RELEASED
       
Any stage → FAILED | ESCALATED
```

---

## Controller Decision Logic

Pre-flight:
- Score >= 0.8 on rubric → OPEN gate → begin analysis
- Score < 0.8, attempt 1 → retry with different item
- Score < 0.8, attempt 2 → ESCALATE (flag for human review)

Deterministic:
- All required fields present + calculations within tolerance → PASS
- Any disqualifying error → return to worker for revision (max 2 attempts)
- Persistent failure → ESCALATE

Post-flight:
- Score >= 0.8 + calculations verified → RELEASE
- Score < 0.8 → return specific failing items only (not full answer key)
- Persistent failure → ESCALATE with full audit log

---

## Prompting Philosophy
- Use positive scope (what the agent should do) not negative warnings
- Never mention other agents exist
- Never mention gate/quiz framing to the worker
- Controller metadata is workflow control, not case evidence
- The model does not need the backstory
