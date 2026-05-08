import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { audit_id } = body;

    if (!audit_id) {
      return Response.json({ error: 'audit_id is required' }, { status: 400 });
    }

    // Fetch the audit record
    const audit = await base44.entities.PayslipAudit.get(audit_id);
    if (!audit) {
      return Response.json({ error: 'Audit not found' }, { status: 404 });
    }

    // Fetch the user profile
    const profiles = await base44.entities.UserProfile.filter({ created_by: user.id });
    const profile = profiles?.[0];

    if (!profile) {
      return Response.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Mark as processing
    await base44.entities.PayslipAudit.update(audit_id, { status: 'Processing' });

    // Build the forensic analysis prompt
    const reportDepth = audit.report_depth || profile.preferred_report_depth || 'In-depth';
    const noContract = profile.has_written_contract === false;

    const systemPrompt = `You are a forensic payroll compliance officer operating under the Fair Work Ombudsman (Australia) framework. 
You analyse payslip data and produce structured compliance reports.

Employee Profile:
- Name: ${profile.full_name || 'Not provided'}
- Employment Type: ${profile.employment_type || 'Not provided'}
- Applicable Award: ${profile.award_name || 'Not provided'} (${profile.award_code || ''})
- Classification Level: ${profile.classification_level || 'Not provided'}
- Job Title: ${profile.job_title || 'Not provided'}
- Employer: ${profile.employer_name || 'Not provided'}
- State: ${profile.state || 'Not provided'}
- Pay Rate: ${profile.pay_rate_type === 'Annual Salary' ? `$${profile.pay_rate} per annum` : `$${profile.pay_rate} per hour`}
- Employment Start Date: ${profile.employment_start_date || 'Not provided'}
- Has Written Contract: ${noContract ? 'NO - flagged for report' : 'Yes'}

Report Depth Requested: ${reportDepth}

${reportDepth === 'Basic' ? `BASIC REPORT: Provide a plain English verdict. Did they appear to be paid correctly? Highlight any obvious issues only. Keep it simple and accessible. Include: verdict, key numbers, 2-3 bullet point summary, and what to do next.` : ''}
${reportDepth === 'In-depth' ? `IN-DEPTH REPORT: Provide a thorough breakdown of each pay component - ordinary hours, overtime, penalties, super, PAYG, allowances, leave. Compare expected vs actual. Explain your reasoning. Include discrepancy tables where relevant.` : ''}
${reportDepth === 'Forensic' ? `FORENSIC REPORT: Apply the full 10-step forensic analysis framework. Show every calculation. Reference specific award clauses and legislation. Produce discrepancy tables, risk rating, estimated financial impact, legislative references, and escalation recommendations. This is a professional-grade audit report.` : ''}

Payslip Data Provided:
${JSON.stringify(audit.raw_payslip_data || {}, null, 2)}

Pay Period: ${audit.pay_period_start || 'Not provided'} to ${audit.pay_period_end || 'Not provided'}

Produce your compliance report now. Structure it clearly. ${noContract ? 'IMPORTANT: Include a dedicated "No Written Contract" risk notice section as this employee has flagged they have no formal written employment agreement.' : ''}

At the end, provide a JSON block in this exact format (after your full report text):
<AUDIT_RESULT>
{
  "risk_rating": "Low|Moderate|High|Critical",
  "estimated_underpayment": 0.00,
  "discrepancies_found": true|false,
  "executive_summary": "2-3 sentence plain English summary",
  "recommendations": ["item1", "item2", "item3"]
}
</AUDIT_RESULT>`;

    // Call the AI via base44 agent
    const aiResponse = await base44.ai.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Please analyse this payslip and produce the compliance report at ${reportDepth} depth.` }
    ]);

    const fullReport = aiResponse?.content || aiResponse?.message || String(aiResponse);

    // Extract the JSON result block
    let riskRating = 'Moderate';
    let estimatedUnderpayment = 0;
    let discrepanciesFound = false;
    let executiveSummary = '';
    let recommendations: string[] = [];

    const resultMatch = fullReport.match(/<AUDIT_RESULT>([\s\S]*?)<\/AUDIT_RESULT>/);
    if (resultMatch) {
      try {
        const parsed = JSON.parse(resultMatch[1].trim());
        riskRating = parsed.risk_rating || 'Moderate';
        estimatedUnderpayment = parsed.estimated_underpayment || 0;
        discrepanciesFound = parsed.discrepancies_found || false;
        executiveSummary = parsed.executive_summary || '';
        recommendations = parsed.recommendations || [];
      } catch (_) {
        // use defaults
      }
    }

    const cleanReport = fullReport.replace(/<AUDIT_RESULT>[\s\S]*?<\/AUDIT_RESULT>/, '').trim();

    // Update the audit record with findings
    await base44.entities.PayslipAudit.update(audit_id, {
      status: 'Complete',
      risk_rating: riskRating,
      estimated_underpayment: estimatedUnderpayment,
      discrepancies_found: discrepanciesFound,
      executive_summary: executiveSummary,
      full_report: cleanReport,
      recommendations: recommendations,
      no_contract_flag: noContract,
      award_applied: profile.award_name || '',
      classification_applied: profile.classification_level || ''
    });

    return Response.json({
      ok: true,
      audit_id,
      risk_rating: riskRating,
      estimated_underpayment: estimatedUnderpayment,
      discrepancies_found: discrepanciesFound,
      executive_summary: executiveSummary
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
