# PayGuard — FWO Forensic Payroll Auditor

A forensic payroll self-audit platform for Australian employees, powered by Fair Work Ombudsman data.

## What it does
- Guides employees through a payroll self-audit against their Modern Award
- Detects underpayments, overtime miscalculations, super shortfalls, and PAYG issues
- Tiered reporting: Basic / In-depth / Forensic
- Payroll Confidence Score based on connected data sources (bank, super, payslips)
- Weekly automated award change monitoring via Fair Work Commission
- Annual Wage Review alerts every June

## Stack
- **Frontend:** React (Base44 app platform)
- **Backend functions:** Deno/TypeScript (Basiq open banking integration)
- **Data:** 31-file FWO knowledge corpus + 20 Modern Award pay guides
- **Automation:** Weekly FWC monitoring, annual wage review check

## Pages
- `Onboarding` — Employment profile setup (award, pay rate, contract status)
- `Dashboard` — Payroll Confidence Score, audit history, data source connections
- `NewAudit` — Payslip data entry + shift helper + file upload
- `AuditReport` — Full forensic audit report with findings and recommendations

## Key files
- `src/pages/` — React pages
- `functions/` — Backend functions (Basiq API integration)
- `.agents/fwo_data/` — FWO knowledge corpus (31 JSON files)
- `.agents/fwo_data/awards/` — 20 Modern Award pay guides
- `.agents/rules/fwo_corpus_access.md` — Corpus access rules
- `entities/` — Entity schemas (UserProfile, PayslipAudit, ModernAward, AwardUpdateAlert)

## Legislative basis
- Fair Work Act 2009 (Cth)
- National Employment Standards (NES)
- Superannuation Guarantee (Administration) Act 1992
- Current NMW: $24.95/hr (from 1 July 2025)
- Current SGC: 12.0% (from 1 July 2025)

## Corpus currency
Built 8 May 2026. Rates reflect 1 July 2025 Annual Wage Review.
Next Annual Wage Review expected June 2026 (effective 1 July 2026).
