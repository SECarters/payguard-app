import { useState, useEffect } from "react";
import { UserProfile, PayslipAudit } from "@/api/entities";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const RISK_CONFIG = {
  Low: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400", label: "Low Risk" },
  Moderate: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", dot: "bg-amber-400", label: "Moderate Risk" },
  High: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", dot: "bg-orange-400", label: "High Risk" },
  Critical: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", dot: "bg-red-400", label: "Critical Risk" },
};

const STATUS_CONFIG = {
  Pending: { color: "text-slate-400", label: "Pending" },
  Processing: { color: "text-blue-400", label: "Analysing..." },
  Complete: { color: "text-emerald-400", label: "Complete" },
  Error: { color: "text-red-400", label: "Error" },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const profiles = await UserProfile.list();
      if (!profiles?.length) { navigate(createPageUrl("Onboarding")); return; }
      const p = profiles[0];
      if (!p.onboarding_complete) { navigate(createPageUrl("Onboarding")); return; }
      setProfile(p);
      const a = await PayslipAudit.list();
      setAudits(a || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const totalUnderpayment = audits.filter(a => a.status === "Complete").reduce((sum, a) => sum + (a.estimated_underpayment || 0), 0);
  const completedAudits = audits.filter(a => a.status === "Complete").length;
  const issuesFound = audits.filter(a => a.discrepancies_found).length;
  const criticalOrHigh = audits.filter(a => ["High","Critical"].includes(a.risk_rating)).length;

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-blue-400 animate-pulse text-lg font-medium">Loading your audits...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top Nav */}
      <nav className="border-b border-white/5 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="font-bold text-lg">PayGuard</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm hidden sm:block">G'day, {profile?.full_name?.split(" ")[0] || "there"}</span>
            <button onClick={() => navigate(createPageUrl("NewAudit"))}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition">
              + New Audit
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Audits Run", value: completedAudits, icon: "📊", color: "text-blue-400" },
            { label: "Issues Found", value: issuesFound, icon: "🔍", color: "text-amber-400" },
            { label: "High / Critical", value: criticalOrHigh, icon: "🚨", color: "text-red-400" },
            { label: "Est. Shortfall", value: `$${totalUnderpayment.toFixed(2)}`, icon: "💰", color: "text-emerald-400" },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-2xl mb-2">{icon}</div>
              <div className={`text-2xl font-bold ${color} mb-0.5`}>{value}</div>
              <div className="text-slate-500 text-xs">{label}</div>
            </div>
          ))}
        </div>

        {/* Profile Summary */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Your Employment Profile</p>
              <p className="text-white font-semibold">{profile?.job_title || "—"} · {profile?.employment_type || "—"}</p>
              <p className="text-slate-400 text-sm mt-0.5">{profile?.award_name || "No award selected"}</p>
            </div>
            <div className="text-right">
              <p className="text-slate-500 text-xs mb-1">{profile?.employer_name}</p>
              <p className="text-blue-400 text-sm font-medium">{profile?.pay_rate_type === "Annual Salary" ? `$${profile?.pay_rate?.toLocaleString()} p.a.` : `$${profile?.pay_rate}/hr`}</p>
            </div>
          </div>
          {profile?.has_written_contract === false && (
            <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
              <span className="text-amber-400">⚠️</span>
              <span className="text-amber-300 text-xs">No written contract on file — this is flagged in your audit reports</span>
            </div>
          )}
        </div>

        {/* Audits List */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Your Audits</h2>
          <span className="text-slate-500 text-sm">{audits.length} total</span>
        </div>

        {audits.length === 0 ? (
          <div className="bg-white/5 border border-dashed border-white/10 rounded-2xl p-12 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <p className="text-white font-semibold mb-2">No audits yet</p>
            <p className="text-slate-400 text-sm mb-6">Upload your first payslip and let your personal forensic accountant get to work.</p>
            <button onClick={() => navigate(createPageUrl("NewAudit"))}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition">
              Start Your First Audit →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {audits.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).map(audit => {
              const risk = RISK_CONFIG[audit.risk_rating] || {};
              const status = STATUS_CONFIG[audit.status] || {};
              return (
                <button key={audit.id} onClick={() => navigate(createPageUrl("AuditReport") + `?id=${audit.id}`)}
                  className="w-full bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-2xl p-5 text-left transition-all group">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-semibold">{audit.audit_name || "Payslip Audit"}</span>
                        <span className={`text-xs font-medium ${status.color}`}>· {status.label}</span>
                      </div>
                      <p className="text-slate-500 text-xs">
                        {audit.pay_period_start && audit.pay_period_end
                          ? `${audit.pay_period_start} → ${audit.pay_period_end}`
                          : "Pay period not specified"}
                        {" · "}{audit.report_depth} report
                      </p>
                      {audit.executive_summary && (
                        <p className="text-slate-400 text-xs mt-2 line-clamp-2">{audit.executive_summary}</p>
                      )}
                    </div>
                    <div className="ml-4 text-right">
                      {audit.risk_rating && (
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${risk.bg} ${risk.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                          {risk.label}
                        </div>
                      )}
                      {audit.estimated_underpayment > 0 && (
                        <p className="text-red-400 text-xs font-semibold mt-1.5">−${audit.estimated_underpayment.toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-3 text-blue-400 text-xs font-medium opacity-0 group-hover:opacity-100 transition">
                    View full report →
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
