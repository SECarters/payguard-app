import { useState, useEffect } from "react";
import { UserProfile, PayslipAudit } from "@/api/entities";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { uploadFile } from "@/api/storage";

const SHIFT_HELP = `Per-shift overtime applies under most Modern Awards — not weekly totals. Example: 5 × 12hr shifts = 5 separate overtime calculations (8 ordinary + 2 @ 1.5x + 2 @ 2x per shift), NOT 40 ordinary + 20 overtime.`;

export default function NewAudit() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [shifts, setShifts] = useState([{ date: "", start: "", end: "", break_minutes: "", notes: "" }]);
  const [showShiftHelper, setShowShiftHelper] = useState(false);

  const [form, setForm] = useState({
    audit_name: "",
    pay_period_start: "",
    pay_period_end: "",
    report_depth: "",
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

  const addShift = () => setShifts(prev => [...prev, { date: "", start: "", end: "", break_minutes: "", notes: "" }]);
  const removeShift = (i) => setShifts(prev => prev.filter((_, idx) => idx !== i));
  const updateShift = (i, field, value) => setShifts(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));

  // Calculate shift hours for display
  const calcShiftHours = (shift) => {
    if (!shift.start || !shift.end) return null;
    const [sh, sm] = shift.start.split(":").map(Number);
    const [eh, em] = shift.end.split(":").map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60;
    mins -= (parseInt(shift.break_minutes) || 0);
    const hrs = mins / 60;
    return hrs;
  };

  const calcShiftOT = (hrs) => {
    if (!hrs) return null;
    const ordinary = Math.min(hrs, 8);
    const halfTime = hrs > 8 ? Math.min(hrs - 8, 2) : 0;
    const doubleTime = hrs > 10 ? hrs - 10 : 0;
    return { ordinary, halfTime, doubleTime };
  };

  const handleSubmit = async () => {
    setSubmitting(true);
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
        shift_data: showShiftHelper ? shifts.filter(s => s.date && s.start && s.end) : [],
        shift_based_overtime_note: "IMPORTANT: Overtime must be calculated per-shift (not weekly total). Each shift over 8 hours triggers overtime independently.",
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

      setProcessing(true);
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
    setSubmitting(false);
  };

  const canSubmit = form.pay_period_start && form.pay_period_end && form.report_depth && (form.gross_pay || uploadedFiles.length > 0);

  if (processing) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4">
      <div className="text-6xl mb-6 animate-pulse">⚖️</div>
      <h2 className="text-2xl font-bold text-white mb-3">Forensic analysis in progress</h2>
      <p className="text-slate-400 text-center max-w-md leading-relaxed mb-8">
        Your personal forensic accountant is examining your payslip against the{" "}
        <strong className="text-white">{profile?.award_name || "applicable Modern Award"}</strong> and Australian workplace law.
      </p>
      <div className="space-y-2 text-sm text-slate-500 text-center">
        {["Checking minimum wage rates", "Validating per-shift overtime calculations", "Verifying superannuation", "Assessing PAYG withholding", "Cross-referencing award entitlements"].map(s => (
          <p key={s}>⏳ {s}</p>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(createPageUrl("Dashboard"))} className="text-slate-400 hover:text-white transition text-sm">
            ← Back
          </button>
          <span className="text-slate-600">|</span>
          <span className="text-white font-semibold">New Payslip Audit</span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Audit Basics */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Audit Details</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm text-slate-300 mb-1.5">Audit Name <span className="text-slate-500">(optional)</span></label>
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

          {/* Report Depth */}
          <div className="mt-4">
            <label className="block text-sm text-slate-300 mb-2">Report Depth</label>
            <div className="flex gap-2">
              {[
                { d: "Basic", icon: "📋" },
                { d: "In-depth", icon: "🔍" },
                { d: "Forensic", icon: "⚖️" },
              ].map(({ d, icon }) => (
                <button key={d} onClick={() => update("report_depth", d)}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all
                    ${form.report_depth === d ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/15 text-slate-300 hover:border-white/30"}`}>
                  {icon} {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* File Upload */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white mb-1">Upload Payslip <span className="text-slate-500 font-normal text-sm">(optional)</span></h3>
          <p className="text-slate-400 text-sm mb-4">Upload your payslip PDF or image for reference, then enter the key figures below.</p>
          <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition
            ${uploading ? "border-blue-400 bg-blue-500/5" : "border-white/15 hover:border-white/30 hover:bg-white/3"}`}>
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFileUpload} />
            {uploading ? (
              <p className="text-blue-400 text-sm animate-pulse">Uploading...</p>
            ) : (
              <>
                <span className="text-3xl mb-2">📎</span>
                <p className="text-slate-300 text-sm font-medium">Drop files here or click to upload</p>
                <p className="text-slate-500 text-xs mt-1">PDF, JPG, PNG supported</p>
              </>
            )}
          </label>
          {uploadedFiles.map((f, i) => (
            <div key={i} className="flex items-center gap-2 mt-2 text-sm text-emerald-300">
              <span>✓</span> {f.file_name}
            </div>
          ))}
        </div>

        {/* Payslip Figures */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white mb-1">Payslip Figures</h3>
          <p className="text-slate-400 text-sm mb-5">Enter the values directly from your payslip. Leave blank if not shown.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { label: "Gross Pay ($)", field: "gross_pay", placeholder: "Total before tax" },
              { label: "Net Pay ($)", field: "net_pay", placeholder: "Take-home amount" },
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
              { label: "Annual Leave Balance (hrs)", field: "leave_balance_annual", placeholder: "As shown on payslip" },
              { label: "Personal/Sick Leave Balance (hrs)", field: "leave_balance_personal", placeholder: "As shown on payslip" },
            ].map(({ label, field, placeholder }) => (
              <div key={field}>
                <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
                <input type="number" step="0.01"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-blue-400 transition text-sm"
                  placeholder={placeholder} value={form[field]} onChange={e => update(field, e.target.value)} />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1.5">Additional Notes <span className="text-slate-600">(optional)</span></label>
              <textarea rows={3}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-blue-400 transition text-sm resize-none"
                placeholder="Public holidays worked, shift types, roster changes, allowances not shown on payslip..."
                value={form.notes} onChange={e => update("notes", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Shift Data — Per-Shift Overtime */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="text-lg font-semibold text-white">Shift Breakdown <span className="text-slate-500 font-normal text-sm">(optional but recommended)</span></h3>
              <p className="text-slate-400 text-sm mt-0.5">Enables accurate per-shift overtime analysis — the most commonly miscalculated entitlement.</p>
            </div>
          </div>

          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl mb-4">
            <p className="text-blue-300 text-xs leading-relaxed">
              <strong className="text-white">⚖️ Why this matters:</strong> Under most Modern Awards, overtime is calculated <strong className="text-white">per shift</strong> — not as a weekly total. A 12-hour shift triggers overtime at hour 8, regardless of how many hours you've worked that week.
            </p>
          </div>

          <button onClick={() => setShowShiftHelper(!showShiftHelper)}
            className={`w-full py-3 rounded-xl border text-sm font-medium transition-all mb-4
              ${showShiftHelper ? "bg-blue-600/20 border-blue-500 text-blue-300" : "bg-white/5 border-white/15 text-slate-300 hover:border-white/30"}`}>
            {showShiftHelper ? "✓ Shift data entry enabled" : "＋ Add my shift times for per-shift overtime analysis"}
          </button>

          {showShiftHelper && (
            <div className="space-y-3">
              {shifts.map((shift, i) => {
                const hrs = calcShiftHours(shift);
                const ot = hrs ? calcShiftOT(hrs) : null;
                return (
                  <div key={i} className="bg-slate-900/50 border border-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-white">Shift {i + 1}</span>
                      {shifts.length > 1 && (
                        <button onClick={() => removeShift(i)} className="text-slate-500 hover:text-red-400 text-xs transition">Remove</button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="col-span-2 sm:col-span-1">
                        <label className="block text-xs text-slate-500 mb-1">Date</label>
                        <input type="date" className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-400 transition"
                          value={shift.date} onChange={e => updateShift(i, "date", e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Start Time</label>
                        <input type="time" className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-400 transition"
                          value={shift.start} onChange={e => updateShift(i, "start", e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">End Time</label>
                        <input type="time" className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-400 transition"
                          value={shift.end} onChange={e => updateShift(i, "end", e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Break (mins)</label>
                        <input type="number" className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-400 transition"
                          placeholder="30" value={shift.break_minutes} onChange={e => updateShift(i, "break_minutes", e.target.value)} />
                      </div>
                    </div>
                    {ot && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-xs px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-300">
                          {ot.ordinary.toFixed(2)}h ordinary
                        </span>
                        {ot.halfTime > 0 && (
                          <span className="text-xs px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300">
                            {ot.halfTime.toFixed(2)}h @ 1.5x
                          </span>
                        )}
                        {ot.doubleTime > 0 && (
                          <span className="text-xs px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300">
                            {ot.doubleTime.toFixed(2)}h @ 2x
                          </span>
                        )}
                        <span className="text-xs px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-slate-400">
                          {hrs.toFixed(2)}h total
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              <button onClick={addShift}
                className="w-full py-2.5 border border-dashed border-white/20 rounded-xl text-slate-400 hover:text-white hover:border-white/40 text-sm transition">
                ＋ Add another shift
              </button>
            </div>
          )}
        </div>

        {/* No contract notice */}
        {profile?.has_written_contract === false && (
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <span className="text-amber-400">⚠️</span>
            <p className="text-amber-300 text-xs">No written contract on file — this will be flagged in your report.</p>
          </div>
        )}

        {/* Submit */}
        <button onClick={handleSubmit} disabled={!canSubmit || submitting}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-bold text-base transition">
          {submitting ? "Submitting..." : "Run Forensic Analysis →"}
        </button>
        <p className="text-center text-slate-600 text-xs pb-8">
          Analysis typically takes 30–60 seconds · Results saved to your account · For informational purposes only
        </p>
      </div>
    </div>
  );
}
