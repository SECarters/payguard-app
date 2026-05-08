import { useState, useEffect } from "react";
import { PayslipAudit } from "@/api/entities";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ReactMarkdown from "react-markdown";

const RISK_CONFIG = {
  Low: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", bar: "bg-emerald-500", label: "Low Risk", icon: "✅", pct: 20 },
  Moderate: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", bar: "bg-amber-500", label: "Moderate Risk", icon: "⚠️", pct: 50 },
  High: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", bar: "bg-orange-500", label: "High Risk", icon: "🔴", pct: 75 },
  Critical: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", bar: "bg-red-500", label: "Critical Risk", icon: "🚨", pct: 100 },
};

export default function AuditReport() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auditId = searchParams.get("id");
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (auditId) loadAudit();
  }, [auditId]);

  const loadAudit = async () => {
    setLoading(true);
    try {
      const a = await PayslipAudit.get(auditId);
      setAudit(a);
      if (a?.status === "Processing" || a?.status === "Pending") {
        setPolling(true);
        setTimeout(pollForCompletion, 3000);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const pollForCompletion = async () => {
    try {
      const a = await PayslipAudit.get(auditId);
      setAudit(a);
      if (a?.status === "Processing" || a?.status === "Pending") {
        setTimeout(pollForCompletion, 4000);
      } else {
        setPolling(false);
      }
    } catch (e) { setPolling(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-blue-400 animate-pulse text-lg font-medium">Loading report...</div>
    </div>
  );

  if (!audit) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <p className="text-slate-400">Report not found.</p>
    </div>
  );

  const risk = RISK_CONFIG[audit.risk_rating] || {};
  const isProcessing = audit.status === "Processing" || audit.status === "Pending";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button onClick={() => navigate(createPageUrl("Dashboard"))} className="text-slate-400 hover:text-white transition text-sm">
            ← Dashboard
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{audit.report_depth} Report</span>
            {audit.risk_rating && (
              <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${risk.bg} ${risk.color}`}>
                {risk.icon} {risk.label}
              </span>
            )}
          </div>
        </div>
      </nav>

      {/* Processing State */}
      {isProcessing && (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
          <div className="text-6xl mb-6 animate-pulse">⚖️</div>
          <h2 className="text-2xl font-bold text-white mb-3">Forensic analysis in progress</h2>
          <p className="text-slate-400 text-center max-w-md">Analysing your payslip against Australian workplace law. This usually takes 30–60 seconds.</p>
          <div className="flex gap-1 mt-8">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
        </div>
      )}

      {!isProcessing && (
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white mb-1">{audit.audit_name || "Payslip Audit Report"}</h1>
            <p className="text-slate-400 text-sm">
              {audit.pay_period_start} → {audit.pay_period_end} · {audit.award_applied || "Award not specified"}
            </p>
          </div>

          {/* Risk Meter */}
          {audit.risk_rating && (
            <div className={`p-5 rounded-2xl border mb-6 ${risk.bg}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Compliance Risk Level</p>
                  <p className={`text-2xl font-bold ${risk.color}`}>{risk.icon} {risk.label}</p>
                </div>
                {audit.estimated_underpayment > 0 && (
                  <div className="text-right">
                    <p className="text-xs text-slate-400 mb-0.5">Estimated Shortfall</p>
                    <p className="text-2xl font-bold text-red-400">−${audit.estimated_underpayment.toFixed(2)}</p>
                  </div>
                )}
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${risk.bar}`} style={{ width: `${risk.pct}%` }} />
              </div>
            </div>
          )}

          {/* Executive Summary */}
          {audit.executive_summary && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Executive Summary</p>
              <p className="text-white leading-relaxed">{audit.executive_summary}</p>
            </div>
          )}

          {/* No Contract Notice */}
          {audit.no_contract_flag && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 mb-6">
              <div className="flex gap-3">
                <span className="text-amber-400 text-xl">⚠️</span>
                <div>
                  <p className="text-amber-300 font-semibold mb-1">No Written Contract on File</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    This audit has been flagged because no written employment contract exists. You are still protected by the Fair Work Act 2009 and your Modern Award, but the absence of a written contract may complicate any formal dispute process.
                  </p>
                  <a href="https://www.fairwork.gov.au/employment-conditions/contracts" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium mt-2">
                    Fair Work Ombudsman — Employment Contracts →
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {audit.recommendations?.length > 0 && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5 mb-6">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Recommended Next Steps</p>
              <ul className="space-y-2">
                {audit.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-blue-400 font-bold mt-0.5">{i + 1}.</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Full Report */}
          {audit.full_report && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-4">Full Forensic Report</p>
              <div className="prose prose-invert prose-sm max-w-none
                prose-headings:text-white prose-headings:font-semibold
                prose-p:text-slate-300 prose-p:leading-relaxed
                prose-strong:text-white
                prose-table:text-sm prose-table:w-full
                prose-th:text-slate-300 prose-th:text-left prose-th:pb-2 prose-th:border-b prose-th:border-white/10
                prose-td:py-2 prose-td:pr-4 prose-td:text-slate-300 prose-td:border-b prose-td:border-white/5
                prose-ul:text-slate-300 prose-li:text-slate-300
                prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline">
                <ReactMarkdown>{audit.full_report}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* Error State */}
          {audit.status === "Error" && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center">
              <p className="text-red-400 font-semibold mb-2">Analysis could not be completed</p>
              <p className="text-slate-400 text-sm">There was an issue processing this audit. Please try running a new audit.</p>
              <button onClick={() => navigate(createPageUrl("NewAudit"))}
                className="mt-4 px-5 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-medium transition">
                Try Again
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 p-4 bg-white/3 border border-white/5 rounded-xl">
            <p className="text-slate-600 text-xs text-center leading-relaxed">
              This report is produced for informational purposes only and does not constitute legal advice. For formal complaints or legal proceedings, seek advice from a qualified industrial relations lawyer or contact the Fair Work Ombudsman at <a href="https://www.fairwork.gov.au" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">fairwork.gov.au</a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
