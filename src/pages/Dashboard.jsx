import { useState, useEffect } from "react";
import { UserProfile, PayslipAudit } from "@/api/entities";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const RISK_CONFIG = {
  Low:      { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400", label: "Low Risk" },
  Moderate: { color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/30",     dot: "bg-amber-400",   label: "Moderate Risk" },
  High:     { color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/30",   dot: "bg-orange-400",  label: "High Risk" },
  Critical: { color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30",         dot: "bg-red-400",     label: "Critical Risk" },
};

const STATUS_CONFIG = {
  Pending:    { color: "text-slate-400",  label: "Pending" },
  Processing: { color: "text-blue-400",   label: "Analysing..." },
  Complete:   { color: "text-emerald-400",label: "Complete" },
  Error:      { color: "text-red-400",    label: "Error" },
};

// Score band config
const SCORE_BAND = (score) => {
  if (score >= 76) return { label: "Forensic-grade",  color: "text-emerald-400", ring: "stroke-emerald-400", bg: "from-emerald-500/20 to-emerald-500/5", border: "border-emerald-500/30" };
  if (score >= 51) return { label: "Well verified",   color: "text-blue-400",    ring: "stroke-blue-400",    bg: "from-blue-500/20 to-blue-500/5",       border: "border-blue-500/30" };
  if (score >= 26) return { label: "Partially verified", color: "text-amber-400", ring: "stroke-amber-400", bg: "from-amber-500/20 to-amber-500/5",     border: "border-amber-500/30" };
  return               { label: "Unverified",         color: "text-slate-400",   ring: "stroke-slate-500",   bg: "from-slate-500/10 to-slate-500/5",     border: "border-slate-500/30" };
};

// Data source definitions
const SOURCES = [
  {
    id: "payslip_upload",
    label: "Payslip Upload",
    desc: "Manual payslip entry or PDF",
    icon: "📄",
    points: 10,
    action: "upload",
    actionLabel: "Upload Payslip",
  },
  {
    id: "bank_account",
    label: "Bank Account",
    desc: "Verify net pay actually deposited",
    icon: "🏦",
    points: 25,
    action: "basiq",
    actionLabel: "Connect Bank",
  },
  {
    id: "superannuation",
    label: "Super Fund Statement",
    desc: "Confirm super paid on time",
    icon: "🛡️",
    points: 20,
    action: "upload_super",
    actionLabel: "Upload Statement",
  },
  {
    id: "xero_me",
    label: "XeroME",
    desc: "Employer payslip records",
    icon: "💼",
    points: 15,
    action: "coming_soon",
    actionLabel: "Coming Soon",
  },
  {
    id: "deputy_employee",
    label: "Deputy",
    desc: "Your actual shift & hours data",
    icon: "🕐",
    points: 15,
    action: "coming_soon",
    actionLabel: "Coming Soon",
  },
  {
    id: "ato_income_statement",
    label: "ATO Income Statement",
    desc: "PAYG withholding reported to ATO",
    icon: "🏛️",
    points: 15,
    action: "coming_soon",
    actionLabel: "Coming Soon",
  },
];

// SVG circular score gauge
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
          <circle
            cx="64" cy="64" r={radius} fill="none"
            className={band.ring}
            strokeWidth="10"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
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

// Bank connection modal
function BankConnectModal({ profile, onClose, onConnected }) {
  const [step, setStep]     = useState("intro"); // intro | connecting | linked | error
  const [authLink, setAuthLink] = useState(null);
  const [error, setError]   = useState(null);
  const [polling, setPolling] = useState(false);

  const handleConnect = async () => {
    setStep("connecting");
    setError(null);
    try {
      // 1. Create Basiq user (idempotent)
      const createRes = await fetch("/functions/basiqCreateUser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const createData = await createRes.json();
      if (!createData.ok) throw new Error(createData.error || "Failed to create Basiq user");

      const basiqUserId = createData.basiq_user_id;

      // Update profile with basiq_user_id if it's new
      if (!profile.basiq_user_id && profile.id) {
        await UserProfile.update(profile.id, { basiq_user_id: basiqUserId });
      }

      // 2. Get auth link
      const linkRes = await fetch("/functions/basiqGetAuthLink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basiq_user_id: basiqUserId,
          mobile: profile.phone || undefined,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkData.ok) throw new Error(linkData.error || "Failed to generate bank link");

      setAuthLink(linkData.auth_link);
      setStep("link_ready");

    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  };

  const handleOpenLink = () => {
    window.open(authLink, "_blank");
    // After opening, start polling for connection
    setStep("waiting");
    setPolling(true);
    pollForConnection();
  };

  const pollForConnection = async () => {
    // Poll basiqGetAccounts every 5 seconds for up to 3 minutes
    const basiqUserId = profile.basiq_user_id || null;
    if (!basiqUserId) return;

    let attempts = 0;
    const maxAttempts = 36; // 3 min

    const poll = async () => {
      attempts++;
      try {
        const res = await fetch("/functions/basiqGetAccounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ basiq_user_id: basiqUserId }),
        });
        const data = await res.json();
        if (data.ok && data.count > 0) {
          // Connected!
          await UserProfile.update(profile.id, {
            basiq_connected: true,
            basiq_connected_at: new Date().toISOString(),
            connected_sources: [...(profile.connected_sources || []).filter(s => s !== "bank_account"), "bank_account"],
          });
          setStep("linked");
          setPolling(false);
          onConnected();
          return;
        }
      } catch {}

      if (attempts < maxAttempts) {
        setTimeout(poll, 5000);
      } else {
        setPolling(false);
        setStep("timeout");
      }
    };

    setTimeout(poll, 5000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl">

        {step === "intro" && (
          <>
            <div className="text-4xl mb-4 text-center">🏦</div>
            <h3 className="text-xl font-bold text-white text-center mb-2">Connect Your Bank</h3>
            <p className="text-slate-400 text-sm text-center mb-6 leading-relaxed">
              We use <strong className="text-white">Basiq</strong>, an Australian open banking provider, to securely read your transaction history.
              Your bank credentials are <strong className="text-white">never shared with us</strong> — you connect directly with your bank.
            </p>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 space-y-2">
              {["141 Australian banks supported", "CDR-compliant & government-accredited", "Read-only access — we can never move money", "Detects salary deposits & super payments"].map(f => (
                <div key={f} className="flex items-center gap-2 text-sm text-slate-300">
                  <span className="text-emerald-400">✓</span> {f}
                </div>
              ))}
            </div>
            {!profile.phone && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 text-amber-300 text-xs">
                ⚠️ A mobile number is required. Please add your phone number to your profile before connecting.
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/15 text-slate-300 text-sm hover:bg-white/5 transition">
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={!profile.phone}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition">
                Continue →
              </button>
            </div>
          </>
        )}

        {step === "connecting" && (
          <div className="text-center py-6">
            <div className="text-4xl mb-4 animate-pulse">⚙️</div>
            <p className="text-white font-semibold mb-2">Setting up secure connection...</p>
            <p className="text-slate-400 text-sm">Generating your bank connection link</p>
          </div>
        )}

        {step === "link_ready" && (
          <>
            <div className="text-4xl mb-4 text-center">🔗</div>
            <h3 className="text-xl font-bold text-white text-center mb-2">Your Link is Ready</h3>
            <p className="text-slate-400 text-sm text-center mb-6 leading-relaxed">
              Click below to open the secure Basiq portal. Log in with your bank, grant read-only access, then return here.
            </p>
            <button
              onClick={handleOpenLink}
              className="w-full py-3 mb-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition">
              Open Bank Connection Portal →
            </button>
            <button onClick={onClose} className="w-full py-2 text-slate-500 text-sm hover:text-slate-300 transition">
              I'll do this later
            </button>
          </>
        )}

        {step === "waiting" && (
          <div className="text-center py-6">
            <div className="text-4xl mb-4 animate-spin">🔄</div>
            <p className="text-white font-semibold mb-2">Waiting for bank connection...</p>
            <p className="text-slate-400 text-sm mb-4">Complete the bank authorisation in the portal, then return here. This page will update automatically.</p>
            <div className="flex gap-2 justify-center">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        {step === "linked" && (
          <div className="text-center py-6">
            <div className="text-5xl mb-4">✅</div>
            <h3 className="text-xl font-bold text-white mb-2">Bank Connected!</h3>
            <p className="text-slate-400 text-sm mb-6">Your bank account is now linked. Salary deposits and super payments will be cross-referenced in your next audit.</p>
            <button onClick={onClose} className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition">
              Done
            </button>
          </div>
        )}

        {step === "timeout" && (
          <div className="text-center py-6">
            <div className="text-4xl mb-4">⏱️</div>
            <p className="text-white font-semibold mb-2">Connection not detected yet</p>
            <p className="text-slate-400 text-sm mb-4">If you completed the authorisation, it may take a minute. Try refreshing the page.</p>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:bg-white/5 transition">Close</button>
              <button onClick={() => { setStep("intro"); setAuthLink(null); }} className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition">Try Again</button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="text-center py-6">
            <div className="text-4xl mb-4">⚠️</div>
            <p className="text-white font-semibold mb-2">Something went wrong</p>
            <p className="text-red-400 text-xs mb-4">{error}</p>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:bg-white/5 transition">Close</button>
              <button onClick={() => { setStep("intro"); setError(null); }} className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition">Retry</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [audits, setAudits]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBankModal, setShowBankModal] = useState(false);
  const [activeTab, setActiveTab] = useState("audits"); // "audits" | "sources"

  useEffect(() => { loadData(); }, []);

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

  // Compute confidence score from connected_sources
  const computeScore = (sources = []) =>
    SOURCES.filter(s => sources.includes(s.id)).reduce((sum, s) => sum + s.points, 0);

  const score = computeScore(profile?.connected_sources || []);

  // Auto-credit payslip_upload if any completed audit exists
  const effectiveSources = [...(profile?.connected_sources || [])];
  if (audits.some(a => a.status === "Complete") && !effectiveSources.includes("payslip_upload")) {
    effectiveSources.push("payslip_upload");
  }
  const effectiveScore = computeScore(effectiveSources);

  const totalUnderpayment = audits.filter(a => a.status === "Complete").reduce((sum, a) => sum + (a.estimated_underpayment || 0), 0);
  const completedAudits   = audits.filter(a => a.status === "Complete").length;
  const issuesFound       = audits.filter(a => a.discrepancies_found).length;
  const criticalOrHigh    = audits.filter(a => ["High","Critical"].includes(a.risk_rating)).length;

  const handleSourceAction = (source) => {
    if (source.action === "basiq") setShowBankModal(true);
    if (source.action === "upload") navigate(createPageUrl("NewAudit"));
  };

  const isConnected = (sourceId) => {
    if (sourceId === "payslip_upload") return audits.some(a => a.status === "Complete") || effectiveSources.includes("payslip_upload");
    return (profile?.connected_sources || []).includes(sourceId);
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-blue-400 animate-pulse text-lg font-medium">Loading your audits...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Bank Modal */}
      {showBankModal && (
        <BankConnectModal
          profile={profile}
          onClose={() => setShowBankModal(false)}
          onConnected={() => { setShowBankModal(false); loadData(); }}
        />
      )}

      {/* Top Nav */}
      <nav className="border-b border-white/5 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="font-bold text-lg">PayGuard</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm hidden sm:block">G'day, {profile?.full_name?.split(" ")[0] || "there"}</span>
            <button
              onClick={() => navigate(createPageUrl("NewAudit"))}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition">
              + New Audit
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* ── Confidence Score Hero ── */}
        <div className={`bg-gradient-to-br ${SCORE_BAND(effectiveScore).bg} border ${SCORE_BAND(effectiveScore).border} rounded-2xl p-6 mb-6 flex flex-col sm:flex-row items-center gap-6`}>
          <ScoreGauge score={effectiveScore} />
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-white font-bold text-xl mb-1">Payroll Confidence Score</h2>
            <p className="text-slate-400 text-sm mb-4 leading-relaxed">
              The more data sources you connect, the stronger the evidence base for your audit.
              A higher score means findings are cross-verified across multiple independent sources.
            </p>
            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
              {SOURCES.map(s => {
                const connected = isConnected(s.id);
                return (
                  <div key={s.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition
                    ${connected ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "bg-white/5 border-white/10 text-slate-500"}`}>
                    <span>{s.icon}</span>
                    <span>{s.label}</span>
                    {connected && <span className="text-emerald-400">✓</span>}
                    {!connected && <span className="text-slate-600">+{s.points}pts</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Audits Run",    value: completedAudits,                  icon: "📊", color: "text-blue-400" },
            { label: "Issues Found",  value: issuesFound,                      icon: "🔍", color: "text-amber-400" },
            { label: "High / Critical",value: criticalOrHigh,                  icon: "🚨", color: "text-red-400" },
            { label: "Est. Shortfall",value: `$${totalUnderpayment.toFixed(2)}`,icon: "💰", color: "text-emerald-400" },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-2xl mb-2">{icon}</div>
              <div className={`text-2xl font-bold ${color} mb-0.5`}>{value}</div>
              <div className="text-slate-500 text-xs">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Tab Bar ── */}
        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-6 w-fit">
          {[{ id: "audits", label: "📋 Audits" }, { id: "sources", label: "🔗 Data Sources" }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all
                ${activeTab === t.id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── AUDITS TAB ── */}
        {activeTab === "audits" && (
          <>
            {/* Profile strip */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Employment Profile</p>
                  <p className="text-white font-semibold">{profile?.job_title || "—"} · {profile?.employment_type || "—"}</p>
                  <p className="text-slate-400 text-sm mt-0.5">{profile?.award_name || "No award selected"}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-xs mb-1">{profile?.employer_name}</p>
                  <p className="text-blue-400 text-sm font-medium">
                    {profile?.pay_rate_type === "Annual Salary"
                      ? `$${profile?.pay_rate?.toLocaleString()} p.a.`
                      : `$${profile?.pay_rate}/hr`}
                  </p>
                </div>
              </div>
              {profile?.has_written_contract === false && (
                <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
                  <span className="text-amber-400">⚠️</span>
                  <span className="text-amber-300 text-xs">No written contract on file — flagged in your audit reports</span>
                </div>
              )}
            </div>

            {/* Audits list */}
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
                  const risk   = RISK_CONFIG[audit.risk_rating] || {};
                  const status = STATUS_CONFIG[audit.status]    || {};
                  return (
                    <button key={audit.id}
                      onClick={() => navigate(createPageUrl("AuditReport") + `?id=${audit.id}`)}
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
                        <div className="ml-4 text-right shrink-0">
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
          </>
        )}

        {/* ── DATA SOURCES TAB ── */}
        {activeTab === "sources" && (
          <div className="space-y-3">
            <p className="text-slate-400 text-sm mb-2">
              Connect more data sources to increase your Payroll Confidence Score and strengthen the evidence base for your audits.
            </p>
            {SOURCES.map(source => {
              const connected = isConnected(source.id);
              const comingSoon = source.action === "coming_soon";
              return (
                <div key={source.id}
                  className={`bg-white/5 border rounded-2xl p-5 flex items-center gap-4 transition
                    ${connected ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10"}`}>
                  <div className="text-3xl w-10 text-center shrink-0">{source.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-white font-semibold text-sm">{source.label}</span>
                      {connected && <span className="text-xs text-emerald-400 font-medium bg-emerald-500/15 px-2 py-0.5 rounded-full">Connected ✓</span>}
                      {comingSoon && <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">Coming soon</span>}
                      {!connected && !comingSoon && (
                        <span className="text-xs text-blue-400 font-medium">+{source.points} pts</span>
                      )}
                    </div>
                    <p className="text-slate-400 text-xs">{source.desc}</p>
                  </div>
                  <div className="shrink-0">
                    {connected ? (
                      <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <span className="text-emerald-400 text-sm">✓</span>
                      </div>
                    ) : comingSoon ? (
                      <span className="text-xs text-slate-600 px-3 py-1.5 border border-white/10 rounded-lg">Soon</span>
                    ) : (
                      <button
                        onClick={() => handleSourceAction(source)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-semibold text-white transition whitespace-nowrap">
                        {source.actionLabel}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Score breakdown */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mt-4">
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-3">Score Breakdown</p>
              <div className="space-y-2">
                {SOURCES.map(s => {
                  const connected = isConnected(s.id);
                  return (
                    <div key={s.id} className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${connected ? "bg-emerald-400" : "bg-slate-600"}`} />
                      <span className={`text-sm flex-1 ${connected ? "text-slate-300" : "text-slate-600"}`}>{s.label}</span>
                      <span className={`text-sm font-mono font-semibold ${connected ? "text-emerald-400" : "text-slate-600"}`}>
                        {connected ? `+${s.points}` : `+${s.points}`}
                      </span>
                    </div>
                  );
                })}
                <div className="border-t border-white/10 pt-2 flex items-center justify-between">
                  <span className="text-white font-semibold text-sm">Total</span>
                  <span className={`text-lg font-bold ${SCORE_BAND(effectiveScore).color}`}>{effectiveScore} / 100</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
