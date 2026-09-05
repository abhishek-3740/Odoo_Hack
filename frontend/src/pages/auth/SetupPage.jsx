import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, landingPathFor } from "../../context/AuthContext";
import { api, authOptions, setStoredToken } from "../../services/api";
import { AuthShell, ErrorBanner, inputClass, labelClass } from "./AuthShell";
import { ArrowRight, Lock, Mail, User, ShieldCheck } from "lucide-react";

function passwordStrength(pw) {
  if (!pw) return { label: "", score: 0 };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const label = score <= 1 ? "Weak" : score <= 3 ? "Fair" : "Strong";
  return { label, score };
}

export function SetupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [alreadySetup, setAlreadySetup] = useState(false);

  useEffect(() => {
    if (user) navigate(landingPathFor(user), { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    authOptions()
      .then((opts) => { if (opts && opts.needsSetup === false) setAlreadySetup(true); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const strength = passwordStrength(form.password);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const canSubmit = form.fullName.trim() && form.email.trim() && form.password.length >= 8 && !mismatch && !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/setup", {
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        password: form.password,
      });
      setStoredToken(res.accessToken);
      window.location.href = "/admin";
    } catch (err) {
      setError(err.message || "Setup failed. An admin account may already exist.");
    } finally {
      setLoading(false);
    }
  };

  if (checking) return null;

  if (alreadySetup) {
    return (
      <AuthShell title="Workspace already configured" subtitle="An administrator account exists. Sign in to continue."
        footer={<Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-800">Go to sign-in ?</Link>}>
        <div className="text-center py-6">
          <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <p className="text-xs text-slate-600 leading-relaxed">Your DealFlow360 workspace is already set up. Contact your administrator if you need access.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set up your workspace" subtitle="Create the first administrator account to get started with DealFlow360."
      footer={<>Already have an account?{" "}<Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-800">Sign in</Link></>}>
      <div className="mb-5 p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-start space-x-2.5">
        <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <div className="text-xs text-indigo-800"><strong>First-time setup.</strong> This page is disabled once an admin account is created. New staff must then be invited by the admin.</div>
      </div>
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <ErrorBanner>{error}</ErrorBanner>
        <div>
          <label htmlFor="setup-name" className={labelClass}>Your full name</label>
          <div className="relative">
            <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input id="setup-name" autoComplete="name" required value={form.fullName} onChange={set("fullName")} placeholder="Aditya Kumar" className={`${inputClass} pl-9`} />
          </div>
        </div>
        <div>
          <label htmlFor="setup-email" className={labelClass}>Work email</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input id="setup-email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} placeholder="admin@yourcompany.com" className={`${inputClass} pl-9`} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="setup-password" className={labelClass}>Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input id="setup-password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} placeholder="At least 8 characters" className={`${inputClass} pl-9`} />
            </div>
            <div className="mt-1.5 flex items-center space-x-2">
              <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full transition-all ${strength.score <= 1 ? "bg-rose-400" : strength.score <= 3 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (strength.score / 5) * 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-500 w-10 text-right">{strength.label}</span>
            </div>
          </div>
          <div>
            <label htmlFor="setup-confirm" className={labelClass}>Confirm password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input id="setup-confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} aria-invalid={mismatch} className={`${inputClass} pl-9 ${mismatch ? "border-rose-300" : ""}`} />
            </div>
            {mismatch && <p className="mt-1 text-[10px] text-rose-600">Passwords do not match.</p>}
          </div>
        </div>
        <button type="submit" disabled={!canSubmit} id="setup-submit" className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-colors">
          <span>{loading ? "Creating admin account…" : "Create admin account"}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </AuthShell>
  );
}
