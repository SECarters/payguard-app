import { useState, useEffect } from "react";
import { UserProfile, PayslipAudit } from "@/api/entities";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { uploadFile } from "@/api/storage";

export default function NewAudit() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [step, setStep] = useState(0); // 0 = details, 1 = enter data, 2 = processing
  const [saving, setSaving] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    audit_name: "",
    pay_period_start: "",
    pay_period_end: "",
    report_depth: "",
    // Payslip data fields
    gross_pay: "",
    net_pay: "",
    ordinary_hours: "",
    ordinary_rate: "",
    overtime_hours: "",
    overtime_pay: "",
    penalty_hours: "",
    penalty_pay: "",
    superannuation_paid: "",
    payg_withheld: "",
    allowances: "",
    leave_balance_annual: "",
    leave_balance_personal: "",
    other_deductions: "",
    notes: "",
  });

  useEffect(() => {
    UserProfile.list().then(profiles => {
      if (profiles?.[0]) {
        setProfile(profiles[0]);
        setForm(f => ({ ...f, report_depth: profiles[0].preferred_report_depth || "In-depth" }));
      }
    });
  }, []);

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    setUploading(true);
    for (const file of files) {
      try {
        const url = await uploadFile(file);
        setUploadedFiles(prev => [...prev, { file_name: file.name, file_url: url, file_type: file.type }]);
      } catch (err) { console.error(err); }
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const rawData = {
        gross_pay: form.gross_pay,
        net_pay: form.net_pay,
        ordinary_hours: form.ordinary_hours,
        ordinary_rate: form.ordinary_rate,
        overtime_hours: form.overtime_hours,
        overtime_pay: form.overtime_pay,
        penalty_hours: form.penalty_hours,
        penalty_pay: form.penalty_pay,
        superannuation_paid: form.superannuation_paid,
        payg_withheld: form.payg_withheld,
        allowances: form.allowances,
        leave_balance_annual: form.leave_balance_annual,
        leave_balance_personal: form.leave_balance_personal,
        other_deductions: form.other_deductions,
        additional_notes: form.notes,
      };

      const audit = await PayslipAudit.create({
        audit_name: form.audit_name || `Audit — ${form.pay_period_start || new Date().toISOString().split("T")[0]}`,
        pay_period_start: form.pay_period_start,
        pay_period_end: form.pay_period_end,
        report_depth: form.report_depth,
        status: "Pending",
        uploaded_files: uploadedFiles,
        raw_payslip_data: rawData,
        no_contract_flag: profile?.has_written_contract === false,
      });

      // Trigger analysis
      setStep(2);
      const resp = await fetch(`/functions/runPayslipAudit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audit_id: audit.id }),
      });

      if (resp.ok) {
        navigate(createPageUrl("AuditReport") + `?id=${audit.id}`);
      } else {
        await PayslipAudit.update(audit.id, { status: "Error" });
        navigate(createPageUrl("Dashboard"));
      }
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  const canSubmit = form.pay_period_start && form.pay_period_end && form.report_depth && (form.gross_pay || uploadedFiles.length > 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(createPageUrl("Dashboard"))} className="text-slate-400 hover:text-white transition">
            ← Back
          </button>
          <span className="text-slate-600">|</span>
          <span className="text-white font-semibold">New Payslip Audit</span>
        </div>
      </nav>

      {/* Processing Screen */}
      {step === 2 && (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
          <div className="text-6xl mb-6 animate-pulse">⚖️</div>
          <h2 className="text-2xl font-bold text-white mb-3">Forensic analysis in progress</h2>
          <p className="text-slate-400 text-center max-w-md leading-relaxed mb-8">
            Your personal forensic accountant is examining your payslip against the <strong className="text-white">{profile?.award_name}</strong> and Australian workplace law. This takes about 30–60 seconds.
          </p>
          <div className="space-y-2 text-sm text-slate-500 text-center">
            <p>✓ Checking minimum wage rates</p>
            <p>✓ Validating overtime & penalty calculations</p>
            <p>✓ Verifying superannuation</p>
            <p>✓ Assessing PAYG withholding</p>
          </div>
        </div>
      )}

      {step < 2 && (
        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* Audit Basics */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-semibold text-white mb-4">Audit Details</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm text-slate-300 mb-1.5">Audit Name (optional)</label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="e.g. March 2025 Payslip" value={form.audit_name} onChange={e => update("audit_name", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Pay Period Start</label>
                <input type="date" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                  value={form.pay_period_start} onChange={e => update("pay_period_start", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Pay Period End</label>
                <input type="date" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                  value={form.pay_period_end} onChange={e => update("pay_period_end", e.target.value)} />
              </div>
            </div>

            {/* Report Depth Selector */}
            <div className="mt-4">
              <label className="block text-sm text-slate-300 mb-2">Report Depth</label>
              <div className="flex gap-2">
                {["Basic","In-depth","Forensic"].map(d => (
                  <button key={d} onClick={() => update("report_depth", d)}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all
                      ${form.report_depth === d ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/15 text-slate-300 hover:border-white/30"}`}>
                    {d === "Basic" ? "📋" : d === "In-depth" ? "🔍" : "⚖️"} {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* File Upload */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-semibold text-white mb-1">Upload Payslip (optional)</h3>
            <p className="text-slate-400 text-sm mb-4">Upload your payslip PDF or image for reference. Then enter the key figures below.</p>
            <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition
              ${uploading ? "border-blue-400 bg-blue-500/5" : "border-white/15 hover:border-white/30"}`}>
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFileUpload} />
              {uploading ? (
                <p className="text-blue-400 text-sm">Uploading...</p>
              ) : (
                <>
                  <span className="text-3xl mb-2">📎</span>
                  <p className="text-slate-300 text-sm font-medium">Drop files here or click to upload</p>
                  <p className="text-slate-500 text-xs mt-1">PDF, JPG, PNG supported</p>
                </>
              )}
            </label>
            {uploadedFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 mt-2 text-sm text-slate-300">
                <span className="text-emerald-400">✓</span> {f.file_name}
              </div>
            ))}
          </div>

          {/* Payslip Data Entry */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-semibold text-white mb-1">Payslip Figures</h3>
            <p className="text-slate-400 text-sm mb-4">Enter the values directly from your payslip. Leave blank if not shown.</p>

            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { label: "Gross Pay ($)", field: "gross_pay", placeholder: "Total before tax" },
                { label: "Net Pay ($)", field: "net_pay", placeholder: "Take-home pay" },
                { label: "Ordinary Hours", field: "ordinary_hours", placeholder: "e.g. 38" },
                { label: "Ordinary Hourly Rate ($)", field: "ordinary_rate", placeholder: "e.g. 23.45" },
                { label: "Overtime Hours", field: "overtime_hours", placeholder: "0 if none" },
                { label: "Overtime Pay ($)", field: "overtime_pay", placeholder: "0 if none" },
                { label: "Penalty / Weekend Hours", field: "penalty_hours", placeholder: "0 if none" },
                { label: "Penalty Pay ($)", field: "penalty_pay", placeholder: "0 if none" },
                { label: "Superannuation Paid ($)", field: "superannuation_paid", placeholder: "As shown on payslip" },
                { label: "PAYG Tax Withheld ($)", field: "payg_withheld", placeholder: "Tax deducted" },
                { label: "Allowances ($)", field: "allowances", placeholder: "Travel, meals, tools etc." },
                { label: "Other Deductions ($)", field: "other_deductions", placeholder: "Salary sacrifice etc." },
              ].map(({ label, field, placeholder }) => (
                <div key={field}>
                  <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
                  <input type="number" step="0.01" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-blue-400 transition text-sm"
                    placeholder={placeholder} value={form[field]} onChange={e => update(field, e.target.value)} />
                </div>
              ))}

              <div className="sm:col-span-2 grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Annual Leave Balance (hrs)</label>
                  <input type="number" step="0.01" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-blue-400 transition text-sm"
                    placeholder="As shown on payslip" value={form.leave_balance_annual} onChange={e => update("leave_balance_annual", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Personal Leave Balance (hrs)</label>
                  <input type="number" step="0.01" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-blue-400 transition text-sm"
                    placeholder="As shown on payslip" value={form.leave_balance_personal} onChange={e => update("leave_balance_personal", e.target.value)} />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400 mb-1.5">Additional Notes (optional)</label>
                <textarea rows={3} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-blue-400 transition text-sm resize-none"
                  placeholder="Any other context — e.g. public holidays worked, shift types, roster changes..." value={form.notes} onChange={e => update("notes", e.target.value)} />
              </div>
            </div>
          </div>

          {/* No contract notice */}
          {profile?.has_written_contract === false && (
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-6">
              <span className="text-amber-400">⚠️</span>
              <p className="text-amber-300 text-xs">No written contract on file — this will be noted in your report.</p>
            </div>
          )}

          <button onClick={handleSubmit} disabled={!canSubmit || saving}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-bold text-base transition">
            {saving ? "Submitting..." : "Run Forensic Analysis →"}
          </button>
          <p className="text-center text-slate-600 text-xs mt-3">
            Analysis typically takes 30–60 seconds · Results saved to your account
          </p>
        </div>
      )}
    </div>
  );
}
