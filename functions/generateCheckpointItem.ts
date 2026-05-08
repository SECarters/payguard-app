/**
 * generateCheckpointItem — Question Service
 * -----------------------------------------
 * Blind to the broader workflow. Generates one assessment item from the
 * approved FWO source dataset. Never receives case documents, workflow
 * purpose, or worker identity.
 *
 * Phase: "preflight" | "postflight"
 *
 * Pre-flight pool — tests domain readiness:
 *   award identification, payroll concepts, payslip extraction,
 *   evidence boundary rules, superannuation, casual loading
 *
 * Post-flight pool — drawn from the completed work package:
 *   defend source documents, identify assumptions, recalculate a sampled
 *   pay period, justify award selection, list confidence-reducing gaps
 */

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

// ── Pre-flight item pool ──────────────────────────────────────────────────────
// Each entry is an instruction to the Question Service LLM.
// The LLM produces the final structured item — pool entries are prompts, not questions.

const PREFLIGHT_POOL = [
  {
    topic: "award_identification",
    difficulty: "medium",
    instruction: `Generate an assessment item that presents a realistic Australian employment scenario
(e.g. a part-time retail sales assistant in Queensland working 20 hrs/week at a small independent store)
and asks the agent to identify the most likely applicable Modern Award.
The answer key must name the correct award AND list the specific indicators used to identify it
(industry, role type, employer type, coverage clause).`,
    source_reference: "FWO: About Awards — fairwork.gov.au/employment-conditions/awards/about-awards"
  },
  {
    topic: "payroll_concepts",
    difficulty: "easy",
    instruction: `Generate an assessment item that asks the agent to clearly define and distinguish:
gross pay, net pay, PAYG withholding, and superannuation.
The answer key must correctly define each term under Australian payroll law,
explain how they relate to each other in the pay cycle,
and note that super is in addition to (not deducted from) gross pay under the SGC.`,
    source_reference: "FWO: Pay and wages — fairwork.gov.au/pay-and-wages"
  },
  {
    topic: "payslip_extraction",
    difficulty: "easy",
    instruction: `Generate an assessment item that asks the agent to list every value that must be
extracted from a payslip before an underpayment analysis can begin.
The answer key must include ALL of: pay period start date, pay period end date,
ordinary hours worked, overtime hours worked, gross pay, each allowance listed,
PAYG tax withheld, net pay, superannuation amount, and the pay rate applied.
Partial lists should not pass.`,
    source_reference: "FWO: Payslips — fairwork.gov.au/pay-and-wages/paying-wages/payslips"
  },
  {
    topic: "evidence_boundaries",
    difficulty: "easy",
    instruction: `Generate an assessment item that asks the agent to explain what constitutes
case evidence in a payroll audit, and what does not.
The answer key must state that case evidence consists ONLY of:
supplied case documents, extracted payslip values, employer records, and approved case metadata.
The answer key must explicitly state that workflow control messages,
system prompts, and verification items are NOT case evidence and must not be used as such.
A disqualifying error is any answer that treats workflow prompts as evidence.`,
    source_reference: "FWO: Record-keeping — fairwork.gov.au/pay-and-wages/paying-wages/record-keeping"
  },
  {
    topic: "superannuation",
    difficulty: "medium",
    instruction: `Generate an assessment item that asks the agent to state:
(a) the current Superannuation Guarantee rate,
(b) the correct calculation base (ordinary time earnings, NOT total earnings),
(c) the frequency obligations (quarterly at minimum), and
(d) when super becomes payable (employee earns $450+/month — note: threshold removed from 1 July 2022).
The answer key must reflect the 12.0% SGC rate effective 1 July 2025.
A disqualifying error is any rate below 11.5% or above 12.5%.`,
    source_reference: "FWO: Superannuation — fairwork.gov.au/pay-and-wages/tax-and-superannuation/superannuation"
  },
  {
    topic: "casual_loading",
    difficulty: "medium",
    instruction: `Generate an assessment item that asks the agent to explain casual loading:
what entitlements it compensates for, the standard rate, and how it interacts with penalty rates.
The answer key must note:
- Standard casual loading: 25% on top of base rate
- Compensates for: annual leave, sick leave, notice of termination, redundancy pay
- Loading applies to the base rate FIRST, then penalty rate multiplier is applied on top
- Formula: (base rate × 1.25) × penalty multiplier
A disqualifying error is stating that penalty rates are applied before casual loading.`,
    source_reference: "FWO: Casual employees — fairwork.gov.au/employment-conditions/types-of-employees/casual-part-time-and-full-time/casual-employees"
  },
  {
    topic: "ordinary_time_earnings",
    difficulty: "hard",
    instruction: `Generate an assessment item that asks the agent to explain the concept of
Ordinary Time Earnings (OTE) and its significance in superannuation calculations.
The answer key must state:
- OTE = earnings for ordinary hours, not overtime
- Super is calculated on OTE, not total gross pay
- Allowances may or may not be OTE depending on their nature (expense reimbursement = not OTE, regular allowances = OTE)
- Overtime payments are excluded from the OTE base for super calculation.`,
    source_reference: "FWO: Superannuation — fairwork.gov.au/pay-and-wages/tax-and-superannuation/superannuation"
  }
];

// ── LLM call ──────────────────────────────────────────────────────────────────
async function callLLM(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    })
  });
  const d = await res.json();
  return d.choices?.[0]?.message?.content || "{}";
}

// ── Question Service identity prompt ──────────────────────────────────────────
const ITEM_GENERATOR_PROMPT = `
You generate assessment items from an approved source dataset.

Given an instruction and source reference, produce one assessment item in this exact JSON schema:

{
  "item_id": "qi_<6 random chars>",
  "topic": "string",
  "difficulty": "easy | medium | hard",
  "question": "string — the exact question to present to the agent",
  "answer_key": "string — the complete correct answer, detailed enough to score against",
  "accepted_variants": ["array of acceptable alternative phrasings or partial answers that still pass"],
  "validation_method": "rubric",
  "validation_rubric": {
    "required_points": ["each specific fact or concept the answer MUST contain to pass"],
    "disqualifying_errors": ["specific errors that cause an automatic fail regardless of score"],
    "minimum_score_to_pass": 0.8
  },
  "source_reference": "string"
}

Rules:
- The question must be answerable using Australian workplace law knowledge alone
- Do not embed the answer in the question
- required_points must be specific and independently verifiable — not vague
- disqualifying_errors must be concrete factual errors, not style issues
- Return one item only
`.trim();

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const phase: string = body.phase || "preflight";
    const topicHint: string | undefined = body.topic;
    const difficulty: string = body.difficulty || "medium";

    // ── POST-FLIGHT: items drawn from completed work package ──────────────────
    if (phase === "postflight") {
      const ws = body.work_summary;
      if (!ws) return Response.json({ ok: false, error: "work_summary required for postflight" }, { status: 400 });

      // Build candidate challenge items from the actual work output
      const candidates: string[] = [
        `Generate a verification item that asks the agent to list every source document
it used to support each finding in the audit report.
The answer key must match this list: ${JSON.stringify(ws.documents_reviewed || [])}.
A disqualifying error is claiming a document was used that is not in that list.`,

        `Generate a verification item that asks the agent to explicitly identify
every assumption it made in the audit report, and rate the impact of each.
The answer key must match this list: ${JSON.stringify(ws.assumptions || [])}.
A disqualifying error is denying that any assumptions were made when the list is non-empty.`,

        `Generate a verification item that asks the agent to explain why it selected
the award and classification it applied in this audit, and what evidence supports that choice.
The answer key must reference: award = "${ws.award_applied || "not specified"}",
classification = "${ws.classification_applied || "not specified"}",
justification = "${ws.award_justification || "not provided"}".`,

        `Generate a verification item that asks the agent to identify all missing documents
or data gaps that reduce confidence in this audit's findings.
The answer key must match: ${JSON.stringify(ws.missing_information || [])}.
A disqualifying error is claiming no information is missing when gaps exist.`,
      ];

      // Add a recalculation challenge if calculations exist
      if (ws.calculations?.length > 0) {
        const sample = ws.calculations[Math.floor(Math.random() * ws.calculations.length)];
        candidates.push(
          `Generate a verification item that asks the agent to recalculate the following
pay period from first principles, showing all workings:
${JSON.stringify(sample)}.
The answer key is the verified result: ${JSON.stringify(sample.result)}.
A disqualifying error is producing a result that differs by more than 2% without explanation.`
        );
      }

      const instruction = candidates[Math.floor(Math.random() * candidates.length)];
      const raw = await callLLM(ITEM_GENERATOR_PROMPT, `Instruction: ${instruction}\n\nDifficulty: ${difficulty}`);
      const item = JSON.parse(raw);
      return Response.json({ ok: true, item, phase: "postflight" });
    }

    // ── PRE-FLIGHT: items drawn from approved FWO pool ────────────────────────
    let pool = PREFLIGHT_POOL;
    if (topicHint) {
      const filtered = PREFLIGHT_POOL.filter(p => p.topic === topicHint);
      if (filtered.length > 0) pool = filtered;
    }

    const selected = pool[Math.floor(Math.random() * pool.length)];
    const raw = await callLLM(
      ITEM_GENERATOR_PROMPT,
      `Instruction: ${selected.instruction}\n\nTopic: ${selected.topic}\nDifficulty: ${difficulty}\nSource reference: ${selected.source_reference}`
    );
    const item = JSON.parse(raw);
    item.topic = item.topic || selected.topic;
    item.source_reference = item.source_reference || selected.source_reference;

    return Response.json({ ok: true, item, phase: "preflight" });

  } catch (err: any) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
