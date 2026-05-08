import { useState, useEffect } from "react";
import { UserProfile, PayslipAudit, AwardUpdateAlert } from "@/api/entities";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const SUPERAGENT_URL = "https://app.base44.com/superagent/69fd84730feb263990f95eb3";

const RISK_CONFIG = {
  Low:      { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400", label: "Low Risk" },
  Moderate: { color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/30",     dot: "bg-amber-400",   label: "Moderate Risk" },
  High:     { color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/30",   dot: "bg-orange-400",  label: "High Risk" },
  Critical: { color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30",         dot: "bg-red-400",     label: "Critical Risk" },
};

const SCORE_BAND = (score) => {
  if (score >= 76) return { label: "Forensic-grade",      color: "text-emerald-400", ring: "stroke-emerald-400", bg: "from-emerald-500/20 to-emerald-500/5", border: "border-emerald-500/30" };
  if (score >= 51) return { label: "Well verified",       color: "text-blue-400",    ring: "stroke-blue-400",    bg: "from-blue-500/20 to-blue-500/5",       border: "border-blue-500/30" };
  if (score >= 26) return { label: "Partially verified",  color: "text-amber-400",   ring: "stroke-amber-400",   bg: "from-amber-500/20 to-amber-500/5",     border: "border-amber-500/30" };
  return               { label: "Unverified",             color: "text-slate-400",   ring: "stroke-slate-500",   bg: "from-slate-500/10 to-slate-500/5",     border: "border-slate-500/30" };
};

const URGENCY_CONFIG = {
  Low:      { color: "text-slate-400",   bg: "bg-slate-500/10 border-slate-500/30" },
  Moderate: { color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/30" },
  High:     { color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/30" },
  Critical: { color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30" },
};

function ScoreGauge({ score }) {
  const band = SCORE_BAND(score);
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
          <circle cx="64" cy="64" r={radius} fill="none"
            className={band.ring} strokeWidth="10"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.8s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-bold ${band.color}`}>{score}</span>
          <span className="text-slate-500 text-xs">/ 100</span>
        </div>
      </div>
      <span className={`text-sm font-semibold mt-2 ${band.color}`}>{band.label}</span>
      <span className="text-slate-500 text-xs mt-0.5">Payroll Confidence Score</span>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [audits, setAudits] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [profiles, auditList, alertList] = await Promise.all([
        UserProfile.list(),
        PayslipAudit.list("-created_date"),
        AwardUpdateAlert.list("-created_date"),
      ]);
      setProfile(profiles[0] || null);
      setAudits(auditList || []);
      setAlerts((alertList || []).filter(a => a.change_detected));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-blue-400 animate-pulse text-lg font-medium">Loading dashboard...</div>
    </div>
  );

  if (!profile?.onboarding_complete) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">⚖️</div>
          <h2 className="text-2xl font-bold text-white mb-3">Welcome to PayGuard</h2>
          <p className="text-slate-400 mb-6 leading-relaxed">
            Complete your employment profile first so PayGuard can benchmark your pay against the correct Modern Award.
          </p>
          <button onClick={() => navigate(createPageUrl("Onboarding"))}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold transition">
            Set Up My Profile →
          </button>
        </div>
      </div>
    );
  }

  const score = profile.confidence_score || 0;
  const band = SCORE_BAND(score);
  const completedAudits = audits.filter(a => a.status === "Complete");
  const totalUnderpayment = completedAudits.reduce((sum, a) => sum + (a.estimated_underpayment || 0), 0);
  const highRiskAudits = completedAudits.filter(a => ["High", "Critical"].includes(a.risk_rating));

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="text-white font-semibold">PayGuard</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm hidden sm:block">{profile.full_name}</span>
            <span className="text-slate-600 text-sm hidden sm:block">·</span>
            <span className="text-slate-400 text-sm hidden sm:block">{profile.award_name || "No award set"}</span>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* ── START AUDIT BANNER ── */}
        <div className="bg-gradient-to-r from-blue-600/30 to-indigo-600/20 border border-blue-500/30 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-xs text-blue-300 uppercase tracking-wider mb-1 font-medium">Forensic AI Audit Engine</p>
            <h2 className="text-xl font-bold text-white mb-1">Ready to audit your payslip?</h2>
            <p className="text-slate-300 text-sm leading-relaxed">
              Upload a payslip or enter your pay details and the PayGuard AI will check it against your Modern Award, super obligations, and Fair Work entitlements.
            </p>
          </div>
          <a href={SUPERAGENT_URL} target="_blank" rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-2 px-6 py-3.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold transition shadow-lg shadow-blue-600/30 text-sm whitespace-nowrap">
            ⚖️ Start Audit in Chat →
          </a>
        </div>

        {/* ── STATS ROW ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Audits Run", value: completedAudits.length, icon: "📋", color: "text-blue-400" },
            { label: "Total Shortfall Found", value: totalUnderpayment > 0 ? `$${totalUnderpayment.toFixed(2)}` : "$0.00", icon: "💰", color: totalUnderpayment > 0 ? "text-red-400" : "text-emerald-400" },
            { label: "High Risk Periods", value: highRiskAudits.length, icon: "🚨", color: highRiskAudits.length > 0 ? "text-orange-400" : "text-emerald-400" },
            { label: "Award Alerts", value: alerts.length, icon: "🔔", color: alerts.length > 0 ? "text-amber-400" : "text-slate-400" },
          ].map(s => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-slate-500 text-xs mb-2">{s.icon} {s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── MAIN GRID ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Score Gauge */}
          <div className={`bg-gradient-to-b ${band.bg} border ${band.border} rounded-2xl p-6 flex flex-col items-center`}>
            <ScoreGauge score={score} />
            <div className="w-full mt-6 space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Data Sources Connected</p>
              {[
                { label: "Payslip Upload", connected: (profile.connected_sources || []).includes("payslip_upload"), points: 10 },
                { label: "Bank Account", connected: profile.basiq_connected, points: 25 },
                { label: "Super Statement", connected: (profile.connected_sources || []).includes("superannuation"), points: 20 },
                { label: "XeroME", connected: (profile.connected_sources || []).includes("xero_me"), points: 15 },
                { label: "Deputy", connected: (profile.connected_sources || []).includes("deputy_employee"), points: 15 },
                { label: "ATO Income Statement", connected: (profile.connected_sources || []).includes("ato_income_statement"), points: 15 },
              ].map(src => (
                <div key={src.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${src.connected ? "bg-emerald-400" : "bg-slate-600"}`} />
                    <span className={src.connected ? "text-slate-300" : "text-slate-500"}>{src.label}</span>
                  </div>
                  <span className={`font-mono ${src.connected ? "text-emerald-400" : "text-slate-600"}`}>+{src.points}</span>
                </div>
              ))}
            </div>
            <a href={SUPERAGENT_URL} target="_blank" rel="noopener noreferrer"
              className="mt-5 w-full text-center py-2.5 rounded-xl border border-blue-500/40 text-blue-400 text-xs font-medium hover:bg-blue-500/10 transition">
              Connect more sources in chat →
            </a>
          </div>

          {/* Audit History */}
          <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-white">Audit History</p>
              <a href={SUPERAGENT_URL} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition">+ New Audit →</a>
            </div>

            {audits.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-slate-400 text-sm mb-1">No audits yet</p>
                <p className="text-slate-600 text-xs mb-4">Run your first audit in the PayGuard chat</p>
                <a href={SUPERAGENT_URL} target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-white text-xs font-medium transition">
                  Start First Audit →
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                {audits.slice(0, 8).map(audit => {
                  const risk = RISK_CONFIG[audit.risk_rating] || {};
                  return (
                    <button key={audit.id}
                      onClick={() => navigate(createPageUrl("AuditReport") + `?id=${audit.id}`)}
                      className="w-full text-left bg-white/3 hover:bg-white/8 border border-white/8 rounded-xl p-4 transition group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{audit.audit_name || "Payslip Audit"}</p>
                          <p className="text-slate-500 text-xs mt-0.5">
                            {audit.pay_period_start} → {audit.pay_period_end}
                          </p>
                          {audit.award_applied && (
                            <p className="text-slate-600 text-xs mt-0.5 truncate">{audit.award_applied}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {audit.risk_rating && (
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${risk.bg} ${risk.color}`}>
                              {risk.label}
                            </span>
                          )}
                          {audit.estimated_underpayment > 0 && (
                            <span className="text-xs text-red-400 font-mono">−${audit.estimated_underpayment.toFixed(2)}</span>
                          )}
                          {audit.status === "Processing" && (
                            <span className="text-xs text-blue-400 animate-pulse">Analysing...</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── AWARD ALERTS ── */}
        {alerts.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <p className="text-sm font-semibold text-white mb-4">🔔 Award Change Alerts</p>
            <div className="space-y-3">
              {alerts.slice(0, 5).map(alert => {
                const urg = URGENCY_CONFIG[alert.urgency] || URGENCY_CONFIG.Low;
                return (
                  <div key={alert.id} className={`border rounded-xl p-4 ${urg.bg}`}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <p className={`text-sm font-semibold ${urg.color}`}>{alert.award_name}</p>
                        <p className="text-slate-500 text-xs">{alert.check_date} · {alert.change_type?.replace(/_/g, " ")}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${urg.bg} ${urg.color}`}>
                        {alert.urgency}
                      </span>
                    </div>
                    <p className="text-slate-300 text-xs leading-relaxed line-clamp-3">{alert.change_summary}</p>
                    {alert.effective_date && (
                      <p className="text-slate-500 text-xs mt-2">Effective: {alert.effective_date}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PROFILE SUMMARY ── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-white">Employment Profile</p>
            <a href={SUPERAGENT_URL} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 transition">Update in chat →</a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: "Employment Type", value: profile.employment_type },
              { label: "Award", value: profile.award_name },
              { label: "Classification", value: profile.classification_level || "Not set" },
              { label: "Pay Rate", value: profile.pay_rate ? `$${profile.pay_rate}/${profile.pay_rate_type === "Hourly" ? "hr" : profile.pay_rate_type === "Annual" ? "yr" : "wk"}` : "Not set" },
              { label: "Employer", value: profile.employer_name },
              { label: "State", value: profile.state },
            ].map(f => (
              <div key={f.label}>
                <p className="text-slate-500 text-xs mb-0.5">{f.label}</p>
                <p className="text-white text-sm font-medium truncate">{f.value || "—"}</p>
              </div>
            ))}
          </div>
          {!profile.has_written_contract && (
            <div className="mt-4 flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <span className="text-amber-400">⚠️</span>
              <p className="text-amber-300 text-xs">No written employment contract on file — audits flagged accordingly</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center pb-4">
          <p className="text-slate-600 text-xs leading-relaxed">
            PayGuard uses Fair Work Ombudsman data. Reports are for informational purposes only and do not constitute legal advice.
            For formal disputes, contact the <a href="https://www.fairwork.gov.au" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400">Fair Work Ombudsman</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
