import { useState, useMemo } from "react";
import { UserProfile } from "@/api/entities";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { AWARDS, INDUSTRIES } from "../data/awards";

const STEPS = ["Your Details", "Employment", "Award & Pay", "Report Style"];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showNoContractInfo, setShowNoContractInfo] = useState(false);
  const [awardSearch, setAwardSearch] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    state: "",
    employment_type: "",
    industry: "",
    award_name: "",
    award_code: "",
    classification_level: "",
    job_title: "",
    employer_name: "",
    employment_start_date: "",
    pay_rate: "",
    pay_rate_type: "Hourly",
    has_written_contract: true,
    no_contract_acknowledged: false,
    preferred_report_depth: "In-depth",
    onboarding_complete: false,
  });

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  // Filtered awards based on industry selection + search
  const filteredAwards = useMemo(() => {
    let list = form.industry ? AWARDS.filter(a => a.industry === form.industry) : AWARDS;
    if (awardSearch.trim()) {
      const q = awardSearch.toLowerCase();
      list = list.filter(a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
    }
    return list;
  }, [form.industry, awardSearch]);

  const canProceed = () => {
    if (step === 0) return form.full_name && form.state;
    if (step === 1) return form.employment_type && form.employer_name;
    if (step === 2) return form.award_name && form.pay_rate && form.pay_rate_type;
    if (step === 3) return form.preferred_report_depth;
    return true;
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await UserProfile.create({
        ...form,
        pay_rate: parseFloat(form.pay_rate),
        onboarding_complete: true,
      });
      navigate(createPageUrl("Dashboard"));
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4 shadow-lg shadow-blue-600/30">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">PayGuard</h1>
          <p className="text-blue-300 text-sm">Your personal forensic payroll auditor</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center mb-8 px-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all shrink-0
                ${i < step ? "bg-blue-500 text-white" : i === step ? "bg-white text-slate-900" : "bg-slate-700 text-slate-400"}`}>
                {i < step ? "✓" : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 transition-all ${i < step ? "bg-blue-500" : "bg-slate-700"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-1">{STEPS[step]}</h2>
          <p className="text-slate-400 text-sm mb-6">
            {step === 0 && "Let's start with your basic details."}
            {step === 1 && "Tell us about your employment situation."}
            {step === 2 && "This is used to benchmark your pay accurately against the law."}
            {step === 3 && "Choose how detailed you want your audit reports."}
          </p>

          {/* ── STEP 0: Personal Details ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Full Name</label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="Your full name" value={form.full_name} onChange={e => update("full_name", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Phone <span className="text-slate-500 font-normal">(required for bank connection)</span></label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="+61400 000 000 — needed to link your bank account" value={form.phone} onChange={e => update("phone", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">State / Territory</label>
                <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                  value={form.state} onChange={e => update("state", e.target.value)}>
                  <option value="" className="bg-slate-800">Select your state</option>
                  {["ACT","NSW","NT","QLD","SA","TAS","VIC","WA"].map(s => (
                    <option key={s} value={s} className="bg-slate-800">{s}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ── STEP 1: Employment ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Employment Type</label>
                <div className="grid grid-cols-3 gap-3">
                  {["Full-time","Part-time","Casual"].map(t => (
                    <button key={t} onClick={() => update("employment_type", t)}
                      className={`py-3 rounded-xl border text-sm font-medium transition-all
                        ${form.employment_type === t ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/20 text-slate-300 hover:border-white/40"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Employer Name</label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="Your employer's business name" value={form.employer_name} onChange={e => update("employer_name", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Job Title</label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="e.g. Retail Sales Assistant, Kitchen Hand" value={form.job_title} onChange={e => update("job_title", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Employment Start Date</label>
                <input type="date" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                  value={form.employment_start_date} onChange={e => update("employment_start_date", e.target.value)} />
              </div>
            </div>
          )}

          {/* ── STEP 2: Award & Pay ── */}
          {step === 2 && (
            <div className="space-y-4">

              {/* Industry filter */}
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Filter by Industry (optional)</label>
                <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                  value={form.industry} onChange={e => { update("industry", e.target.value); update("award_name", ""); update("award_code", ""); setAwardSearch(""); }}>
                  <option value="" className="bg-slate-800">All industries</option>
                  {INDUSTRIES.map(i => <option key={i} value={i} className="bg-slate-800">{i}</option>)}
                </select>
              </div>

              {/* Award search + select */}
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">
                  Modern Award <span className="text-slate-500 font-normal">({AWARDS.length} awards from Fair Work Ombudsman)</span>
                </label>
                <input
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition text-sm mb-2"
                  placeholder="Search awards by name or code..."
                  value={awardSearch}
                  onChange={e => setAwardSearch(e.target.value)}
                />
                <div className="max-h-52 overflow-y-auto rounded-xl border border-white/15 bg-slate-900/60 divide-y divide-white/5">
                  {filteredAwards.length === 0 && (
                    <p className="text-slate-500 text-sm px-4 py-3">No awards match your search.</p>
                  )}
                  {filteredAwards.map(a => (
                    <button key={a.code} onClick={() => { update("award_name", a.name); update("award_code", a.code); setAwardSearch(""); }}
                      className={`w-full text-left px-4 py-3 text-sm transition hover:bg-white/5
                        ${form.award_code === a.code ? "bg-blue-600/20 text-white" : "text-slate-300"}`}>
                      <span className="font-medium">{a.name}</span>
                      <span className="text-slate-500 ml-2 text-xs">[{a.code}]</span>
                    </button>
                  ))}
                </div>
                {form.award_name && (
                  <div className="mt-2 px-3 py-2 bg-blue-600/10 border border-blue-500/30 rounded-lg text-sm">
                    <span className="text-blue-300">✓ Selected: </span>
                    <span className="text-white">{form.award_name}</span>
                    <span className="text-slate-500 ml-1">[{form.award_code}]</span>
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-1.5">
                  Not sure? <a href="https://www.fairwork.gov.au/employment-conditions/awards/find-my-award" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Find your award on the Fair Work website →</a>
                </p>
              </div>

              {/* Classification */}
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Classification Level <span className="text-slate-500 font-normal">(optional)</span></label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="e.g. Level 3, Grade 2, Band B" value={form.classification_level} onChange={e => update("classification_level", e.target.value)} />
              </div>

              {/* Pay Rate */}
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Pay Rate (as per your employment arrangement)</label>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium">$</span>
                    <input type="number" step="0.01" className="w-full bg-white/10 border border-white/20 rounded-xl pl-8 pr-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                      placeholder="0.00" value={form.pay_rate} onChange={e => update("pay_rate", e.target.value)} />
                  </div>
                  <select className="bg-white/10 border border-white/20 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                    value={form.pay_rate_type} onChange={e => update("pay_rate_type", e.target.value)}>
                    <option value="Hourly" className="bg-slate-800">per hour</option>
                    <option value="Annual Salary" className="bg-slate-800">per year</option>
                  </select>
                </div>

                {/* No Written Contract */}
                <button onClick={() => { update("has_written_contract", false); update("no_contract_acknowledged", true); setShowNoContractInfo(true); }}
                  className="mt-3 text-sm text-amber-400 hover:text-amber-300 underline underline-offset-2 transition flex items-center gap-1.5">
                  <span>⚠️</span> I don't have a written contract from my employer
                </button>

                {showNoContractInfo && (
                  <div className="mt-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                    <div className="flex items-start gap-3">
                      <span className="text-amber-400 text-lg shrink-0">⚠️</span>
                      <div>
                        <p className="text-amber-300 font-semibold text-sm mb-2">You still have rights — but here's what you should know.</p>
                        <p className="text-slate-300 text-xs leading-relaxed mb-2">
                          Even without a written contract, you are fully protected by the <strong className="text-white">Fair Work Act 2009</strong>, the <strong className="text-white">National Employment Standards</strong>, and your applicable Modern Award. Your employer must pay you correctly regardless.
                        </p>
                        <p className="text-slate-300 text-xs leading-relaxed mb-2">
                          <strong className="text-white">Your risk:</strong> Without a written contract, it's harder to prove your agreed rate, hours, or role in a dispute.
                        </p>
                        <p className="text-slate-300 text-xs leading-relaxed mb-3">
                          <strong className="text-white">Your employer's risk:</strong> Greater exposure to FWO scrutiny and reduced ability to enforce workplace obligations.
                        </p>
                        <a href="https://www.fairwork.gov.au/employment-conditions/contracts" target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium">
                          Learn more at Fair Work Ombudsman →
                        </a>
                        <p className="text-xs text-slate-500 mt-2">This will be flagged in all your audit reports.</p>
                        <button onClick={() => { update("has_written_contract", true); update("no_contract_acknowledged", false); setShowNoContractInfo(false); }}
                          className="mt-2 text-xs text-slate-500 hover:text-slate-400 underline">
                          I do have a contract — dismiss this
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 3: Report Style ── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-slate-400 text-sm">Choose your default report style. You can always change this for individual audits.</p>
              {[
                {
                  level: "Basic",
                  icon: "📋",
                  desc: "Plain English verdict. Quick, clear, no jargon. Perfect if you just want to know if something looks wrong.",
                  badge: "Simple",
                  badgeColor: "bg-slate-600 text-slate-300",
                },
                {
                  level: "In-depth",
                  icon: "🔍",
                  desc: "Full breakdown of each pay component — overtime, penalties, super, PAYG. Clearly explained with comparison tables.",
                  badge: "Recommended",
                  badgeColor: "bg-blue-600 text-blue-100",
                },
                {
                  level: "Forensic",
                  icon: "⚖️",
                  desc: "Professional-grade audit. Every calculation shown, legislative references cited, per-shift overtime analysis, discrepancy tables, and escalation recommendations.",
                  badge: "Most Thorough",
                  badgeColor: "bg-purple-600 text-purple-100",
                },
              ].map(({ level, icon, desc, badge, badgeColor }) => (
                <button key={level} onClick={() => update("preferred_report_depth", level)}
                  className={`w-full text-left p-4 rounded-xl border transition-all
                    ${form.preferred_report_depth === level ? "bg-blue-600/20 border-blue-500 ring-1 ring-blue-500" : "bg-white/5 border-white/15 hover:border-white/30"}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-semibold">{level}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{badge}</span>
                      </div>
                      <p className="text-slate-400 text-xs leading-relaxed">{desc}</p>
                    </div>
                    {form.preferred_report_depth === level && <span className="text-blue-400 text-lg">✓</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-8">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)}
                className="px-5 py-3 rounded-xl border border-white/20 text-slate-300 hover:bg-white/5 transition text-sm font-medium">
                Back
              </button>
            )}
            <button
              onClick={step === STEPS.length - 1 ? handleSubmit : () => setStep(s => s + 1)}
              disabled={!canProceed() || saving}
              className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition">
              {saving ? "Setting up your account..." : step === STEPS.length - 1 ? "Start My First Audit →" : "Continue →"}
            </button>
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-4">
          Award data sourced directly from the Fair Work Ombudsman · For informational purposes only
        </p>
      </div>
    </div>
  );
}
