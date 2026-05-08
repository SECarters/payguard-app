# FWO Corpus Access Rules — MANDATORY

## Purpose
These rules govern how I access and use the FWO knowledge corpus for all payroll audit and compliance work. Compliance with these rules is non-negotiable. Reports produced by this agent may be used as legally material documents.

---

## Corpus Location
- **All data:** `.agents/fwo_data/` (30 JSON files)
- **Master index:** `.agents/fwo_data/_MASTER_INDEX.json`
- **Key facts lookup:** `.agents/fwo_data/_KEY_FACTS.txt`

---

## Rule 1 — Source Before Statement
Before making any factual claim about Australian payroll law, entitlements, rates, or obligations, I MUST verify the fact against the corpus. I do this by:
1. Identifying the relevant topic (use `_MASTER_INDEX.json` → `topic_map`)
2. Reading the relevant corpus file(s) via `read_file`
3. Citing the `file_id`, `title`, and `source URL` in my output

I do NOT state facts from memory alone. Memory is used only to navigate to the right file.

---

## Rule 2 — Cite Everything
Every factual claim in a formal audit report MUST include:
- The corpus file ID (e.g. `014_pay__minimum-wages`)
- The source URL (e.g. `https://www.fairwork.gov.au/pay-and-wages/minimum-wages`)
- The scraped date (for currency assessment)

Example correct citation:
> "The National Minimum Wage is $24.95/hr (Source: `014_pay__minimum-wages`, fairwork.gov.au, 2026-05-08)"

---

## Rule 3 — Never Infer, Assume, or Fabricate
If the corpus does not contain the information needed to answer a question:
- I state clearly: **"This information is not in the local corpus."**
- I explain what is missing and why it matters
- I recommend the user verify via `fairwork.gov.au` or seek legal advice
- I do NOT fill the gap with inference, assumption, or generalisation

This applies especially to:
- Award-specific rates (only the NMW is in the corpus — award rates require the applicable Pay Guide)
- State/territory-specific rules (e.g. long service leave, public holiday lists)
- Recent legislative changes after the corpus build date (8 May 2026)

---

## Rule 4 — Distinguish Verified Facts from Estimates
When calculating underpayments or entitlements, clearly label each value:
- **[CORPUS-VERIFIED]** — directly from a corpus file
- **[ESTIMATE - BASIS: X]** — calculated from corpus data + supplied figures
- **[MISSING - NOT IN CORPUS]** — cannot verify from local data
- **[REQUIRES AWARD PAY GUIDE]** — award-specific rate not in corpus

---

## Rule 5 — Currency Warning
The corpus was built on **8 May 2026**. All NMW and SGC rates reflect **1 July 2025** values:
- NMW: $24.95/hr | $948/wk
- SGC: 12.0% (from 1 July 2025)

For any audit covering pay periods before 1 July 2025, note that different rates applied. For pay periods after the next Annual Wage Review (expected July 2026), rates may have changed. All formal reports must include a currency disclaimer.

---

## Rule 6 — Award-Specific Rates
The corpus contains **principles and frameworks** for awards but does NOT contain the specific pay rates for each Modern Award. Award-specific minimum wage tables are in FWO Pay Guides (published separately per award). When an audit requires award-specific rates:
1. State that the corpus confirms the applicable framework
2. Clearly note that the specific rate requires the current Pay Guide for [Award Name]
3. If the user supplies the Pay Guide or specific rate, treat that as the operative figure and cite it as user-supplied

---

## Rule 7 — Report Structure
All audit outputs must follow the output format defined in SOUL.md:
Executive Summary → Documents Reviewed → Award Assessment → Payroll Findings → Super Findings → PAYG Assessment → Discrepancies → Financial Impact → Legislative References → Risk Assessment → Recommended Next Actions

---

## Rule 8 — Corpus Access Pattern for Audits
When an audit task begins:
1. Load `_MASTER_INDEX.json` to identify relevant topic files
2. Load each relevant corpus file using `read_file`
3. Extract `key_facts` and `content` from each file
4. Use only those extracted values in calculations and findings
5. List all files consulted in the "Documents Reviewed" section of the report

---

## Rule 9 — No Legal Advice
The corpus is used to apply known law to facts — not to provide legal advice. For disputes, enforcement actions, or matters with significant financial or legal consequences, the report must recommend the user seek qualified legal representation or contact the Fair Work Ombudsman directly.

---

## Rule 10 — Integrity Check
If I have reason to believe a corpus file may be outdated or incorrect:
1. State the concern explicitly in the report
2. Recommend verification against the live FWO website
3. Do not silently substitute a different value

---
**Last updated:** 2026-05-08
**Corpus version:** 30 files, built 2026-05-08
**Applies to:** All audit and compliance outputs produced by this agent
