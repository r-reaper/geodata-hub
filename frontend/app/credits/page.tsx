"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

const CREDIT_PACKS = [
  { credits: 100,  price_thb: 100,  label: "Starter",    popular: false, hint: "Try it out" },
  { credits: 500,  price_thb: 450,  label: "Explorer",   popular: true,  hint: "Most popular · 10% off" },
  { credits: 1000, price_thb: 800,  label: "Pro",        popular: false, hint: "20% off" },
  { credits: 5000, price_thb: 3500, label: "Enterprise", popular: false, hint: "30% off" },
];

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

function CreditsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const success = params.get("success") === "1";
  const canceled = params.get("canceled") === "1";
  const [credits, setCredits] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  // Read user
  useEffect(() => {
    if (typeof window === "undefined") return;
    setUserId(localStorage.getItem("geodata_email"));
  }, []);

  // Poll for credit balance after Stripe success (webhook may take 1-3 s)
  useEffect(() => {
    if (!success || !userId) return;
    setPolling(true);
    let attempts = 0;
    const fetchOnce = async () => {
      try {
        const r = await fetch(`${API_BASE}/payments/credits/${encodeURIComponent(userId)}`);
        if (r.ok) {
          const d = await r.json();
          setCredits(d.credits);
        }
      } catch {}
    };
    const interval = setInterval(() => {
      attempts++;
      fetchOnce();
      if (attempts >= 5) { clearInterval(interval); setPolling(false); }
    }, 2000);
    fetchOnce();
    return () => clearInterval(interval);
  }, [success, userId]);

  const startCheckout = async (amount: number) => {
    if (!userId) {
      alert("Please go to the map and sign in first.");
      router.push("/");
      return;
    }
    try {
      const origin = window.location.origin;
      const r = await fetch(`${API_BASE}/payments/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          amount,
          redirect_url: `${origin}/credits?success=1`,
          cancel_url: `${origin}/credits?canceled=1`,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.checkout_url) {
        alert(`Could not start checkout: ${data.detail || r.status}`);
        return;
      }
      window.location.href = data.checkout_url;
    } catch (e: any) {
      alert(`Checkout error: ${e.message || e}`);
    }
  };

  // ─── Success state ───
  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-8 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Payment successful!</h1>
          <p className="text-slate-500 mb-4">Your credits have been added.</p>
          {credits !== null ? (
            <div className="bg-blue-50 rounded-xl p-4 mb-6">
              <p className="text-sm text-blue-600">Your balance</p>
              <p className="text-3xl font-bold text-blue-700">{credits.toLocaleString()}</p>
              <p className="text-sm text-blue-500">credits</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400 mb-6">{polling ? "Confirming with payment processor…" : "Loading balance…"}</p>
          )}
          <button
            onClick={() => router.push("/")}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Start downloading →
          </button>
        </div>
      </div>
    );
  }

  // ─── Canceled state ───
  if (canceled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-8 text-center">
          <div className="text-5xl mb-4">😕</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Payment canceled</h1>
          <p className="text-slate-500 mb-6">No worries — your card was not charged.</p>
          <button
            onClick={() => router.push("/")}
            className="w-full bg-slate-100 text-slate-700 py-3 rounded-lg font-semibold hover:bg-slate-200 transition"
          >
            ← Back to map
          </button>
        </div>
      </div>
    );
  }

  // ─── Default: pack picker ───
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-slate-600 hover:text-slate-900 font-medium"
          >
            ← Back to map
          </button>
          {userId && (
            <span className="text-sm text-slate-500">
              Signed in as <span className="font-medium text-slate-700">{userId}</span>
            </span>
          )}
        </div>

        <div className="text-center mb-8">
          <div className="text-4xl mb-2">💎</div>
          <h1 className="text-3xl font-bold text-slate-900">Buy credits</h1>
          <p className="text-slate-500 mt-2">Credits never expire · Pay only for what you download</p>
        </div>

        {!userId && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-900 max-w-md mx-auto">
            Please sign in on the map page first so we can credit your purchase to the right account.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {CREDIT_PACKS.map((p) => (
            <button
              key={p.credits}
              onClick={() => startCheckout(p.credits)}
              disabled={!userId}
              className={`relative text-left p-5 rounded-xl border-2 transition disabled:opacity-50 disabled:cursor-not-allowed ${p.popular ? "border-blue-500 bg-blue-50 hover:bg-blue-100" : "border-slate-200 hover:border-blue-400 bg-white"}`}
            >
              {p.popular && (
                <span className="absolute -top-2.5 left-4 px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded-full">
                  POPULAR
                </span>
              )}
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{p.label}</div>
              <div className="text-3xl font-bold text-slate-900 mt-1">{p.credits.toLocaleString()}</div>
              <div className="text-xs text-slate-500">credits</div>
              <div className="mt-3 text-xl font-bold text-blue-700">฿{p.price_thb.toLocaleString()}</div>
              <div className="text-[11px] text-slate-500 mt-1">{p.hint}</div>
            </button>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 max-w-2xl mx-auto text-sm text-slate-600">
          <p className="font-medium text-slate-900 mb-2">How credits work</p>
          <ul className="space-y-1 text-xs">
            <li>• Areas with up to 50 features are <strong>FREE</strong> — no credits needed</li>
            <li>• Larger downloads cost <strong>1 credit per ~100 features</strong> (minimum 5 credits)</li>
            <li>• <strong>Re-downloads are always free</strong> — if your file fails or expires, get it back at no cost</li>
            <li>• Credits never expire and are non-refundable once used</li>
          </ul>
        </div>

        <p className="mt-6 text-xs text-slate-400 text-center">
          Secure payment by Stripe · Visa, Mastercard, JCB · Thai Baht (THB)
        </p>
      </div>
    </div>
  );
}

export default function CreditsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-slate-400">Loading...</div></div>}>
      <CreditsContent />
    </Suspense>
  );
}
