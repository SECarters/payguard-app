import { useState } from "react";
import { UserProfile } from "@/api/entities";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const AWARDS = [
  { name: "Clerks — Private Sector Award 2020", code: "MA000002", industry: "Administration & Clerical" },
  { name: "Fast Food Industry Award 2010", code: "MA000003", industry: "Hospitality & Food" },
  { name: "General Retail Industry Award 2020", code: "MA000004", industry: "Retail" },
  { name: "Hospitality Industry (General) Award 2020", code: "MA000009", industry: "Hospitality & Food" },
  { name: "Building and Construction General On-site Award 2020", code: "MA000020", industry: "Construction & Trades" },
  { name: "Manufacturing and Associated Industries and Occupations Award 2020", code: "MA000010", industry: "Manufacturing" },
  { name: "Road Transport and Distribution Award 2020", code: "MA000038", industry: "Transport & Logistics" },
  { name: "Social, Community, Home Care and Disability Services Industry Award 2010", code: "MA000100", industry: "Community & Disability Services" },
  { name: "Restaurant Industry Award 2020", code: "MA000119", industry: "Hospitality & Food" },
  { name: "Health Professionals and Support Services Award 2020", code: "MA000027", industry: "Health & Medical" },
  { name: "Nurses Award 2020", code: "MA000034", industry: "Health & Medical" },
  { name: "Security Services Industry Award 2020", code: "MA000016", industry: "Security" },
  { name: "Hair and Beauty Industry Award 2010", code: "MA000005", industry: "Hair & Beauty" },
  { name: "Pharmacy Industry Award 2020", code: "MA000012", industry: "Health & Medical" },
  { name: "Educational Services (Schools) General Staff Award 2020", code: "MA000076", industry: "Education" },
  { name: "Miscellaneous Award 2020", code: "MA000104", industry: "Other" },
];

const INDUSTRIES = [...new Set(AWARDS.map(a => a.industry))].sort();

const STEPS = ["Your Details", "Employment", "Award & Pay", "Report Style"];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showNoContractInfo, setShowNoContractInfo] = useState(false);
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

  const filteredAwards = form.industry
    ? AWARDS.filter(a => a.industry === form.industry)
    : AWARDS;

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
      await UserProfile.create({ ...form, pay_rate: parseFloat(form.pay_rate), onboarding_complete: true });
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
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">PayGuard</h1>
          <p className="text-blue-300 text-sm">Your personal forensic payroll auditor</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-between mb-8 px-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all
                ${i < step ? "bg-blue-500 text-white" : i === step ? "bg-white text-slate-900" : "bg-slate-700 text-slate-400"}`}>
                {i < step ? "✓" : i + 1}
              </div>
              <div className={`flex-1 h-0.5 mx-1 ${i < STEPS.length - 1 ? (i < step ? "bg-blue-500" : "bg-slate-700") : "hidden"}`} />
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-1">{STEPS[step]}</h2>
          <p className="text-slate-400 text-sm mb-6">
            {step === 0 && "Let's start with your basic details."}
            {step === 1 && "Tell us about your employment situation."}
            {step === 2 && "This helps us benchmark your pay accurately."}
            {step === 3 && "Choose how detailed you want your audit reports."}
          </p>

          {/* Step 0: Personal Details */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Full Name</label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="Your full name" value={form.full_name} onChange={e => update("full_name", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Phone (optional)</label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="0400 000 000" value={form.phone} onChange={e => update("phone", e.target.value)} />
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

          {/* Step 1: Employment */}
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

          {/* Step 2: Award & Pay */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Industry</label>
                <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                  value={form.industry} onChange={e => { update("industry", e.target.value); update("award_name", ""); update("award_code", ""); }}>
                  <option value="" className="bg-slate-800">Select your industry</option>
                  {INDUSTRIES.map(i => <option key={i} value={i} className="bg-slate-800">{i}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Modern Award</label>
                <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                  value={form.award_name} onChange={e => {
                    const award = AWARDS.find(a => a.name === e.target.value);
                    update("award_name", e.target.value);
                    update("award_code", award?.code || "");
                  }}>
                  <option value="" className="bg-slate-800">Select your award</option>
                  {filteredAwards.map(a => <option key={a.code} value={a.name} className="bg-slate-800">{a.name}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">Not sure? <a href="https://www.fairwork.gov.au/employment-conditions/awards/find-my-award" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Find your award on the Fair Work website →</a></p>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Classification Level (optional)</label>
                <input className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                  placeholder="e.g. Level 3, Grade 2, Band B" value={form.classification_level} onChange={e => update("classification_level", e.target.value)} />
              </div>

              {/* Pay Rate with No Contract option */}
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Pay Rate (as per your contract)</label>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium">$</span>
                    <input type="number" className="w-full bg-white/10 border border-white/20 rounded-xl pl-8 pr-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
                      placeholder="0.00" value={form.pay_rate} onChange={e => update("pay_rate", e.target.value)} />
                  </div>
                  <select className="bg-white/10 border border-white/20 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-blue-400 transition"
                    value={form.pay_rate_type} onChange={e => update("pay_rate_type", e.target.value)}>
                    <option value="Hourly" className="bg-slate-800">per hour</option>
                    <option value="Annual Salary" className="bg-slate-800">per year</option>
                  </select>
                </div>

                {/* No Written Contract button */}
                <button onClick={() => { update("has_written_contract", false); setShowNoContractInfo(true); }}
                  className="mt-3 text-sm text-amber-400 hover:text-amber-300 underline underline-offset-2 transition">
                  I don't have a written contract from my employer
                </button>

                {showNoContractInfo && (
                  <div className="mt-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                    <div className="flex items-start gap-3">
                      <span className="text-amber-400 text-lg">⚠️</span>
                      <div>
                        <p className="text-amber-300 font-medium text-sm mb-2">You still have rights — but it's worth knowing the risks.</p>
                        <p className="text-slate-300 text-xs leading-relaxed mb-2">
                          Even without a written contract, you are still protected by the Fair Work Act 2009, the National Employment Standards, and your applicable Modern Award. Your employer is legally required to pay you correctly regardless of whether a written agreement exists.
                        </p>
                        <p className="text-slate-300 text-xs leading-relaxed mb-2">
                          <strong className="text-white">Your risk:</strong> Without a written contract, it can be harder to prove your agreed rate, hours, or role — especially in a dispute.
                        </p>
                        <p className="text-slate-300 text-xs leading-relaxed mb-3">
                          <strong className="text-white">Your employer's risk:</strong> Employers without written contracts face greater scrutiny from the Fair Work Ombudsman and reduced ability to enforce workplace obligations.
                        </p>
                        <a href="https://www.fairwork.gov.au/employment-conditions/contracts" target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium">
                          Learn more at Fair Work Ombudsman →
                        </a>
                        <p className="text-xs text-slate-500 mt-2">This will be noted in your audit reports.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Report Style */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-slate-400 text-sm">Choose your default report style. You can always change this for individual audits.</p>
              {[
                {
                  level: "Basic",
                  icon: "📋",
                  title: "Basic",
                  desc: "Plain English verdict. Quick, clear, no jargon. Perfect if you just want to know if something looks wrong.",
                  badge: "Simple"
                },
                {
                  level: "In-depth",
                  icon: "🔍",
                  title: "In-depth",
                  desc: "Full breakdown of each pay component — overtime, penalties, super, PAYG. Explained clearly with comparison tables.",
                  badge: "Recommended"
                },
                {
                  level: "Forensic",
                  icon: "⚖️",
                  title: "Forensic",
                  desc: "Professional-grade audit. Every calculation shown, legislative references cited, discrepancy tables, escalation recommendations.",
                  badge: "Most Thorough"
                }
              ].map(({ level, icon, title, desc, badge }) => (
                <button key={level} onClick={() => update("preferred_report_depth", level)}
                  className={`w-full text-left p-4 rounded-xl border transition-all
                    ${form.preferred_report_depth === level ? "bg-blue-600/20 border-blue-500 ring-1 ring-blue-500" : "bg-white/5 border-white/15 hover:border-white/30"}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-semibold">{title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                          ${level === "Basic" ? "bg-slate-600 text-slate-300" : level === "In-depth" ? "bg-blue-600 text-blue-100" : "bg-purple-600 text-purple-100"}`}>
                          {badge}
                        </span>
                      </div>
                      <p className="text-slate-400 text-xs leading-relaxed">{desc}</p>
                    </div>
                    {form.preferred_report_depth === level && (
                      <span className="text-blue-400 text-lg">✓</span>
                    )}
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
          Powered by Fair Work Ombudsman compliance logic · For informational purposes only
        </p>
      </div>
    </div>
  );
}
