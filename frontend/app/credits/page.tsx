"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function CreditsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const success = params.get("success") === "1";
  const canceled = params.get("canceled") === "1";
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!success) return;
    const userId = localStorage.getItem("geodata_email");
    if (!userId) return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/payments/credits/${encodeURIComponent(userId)}`);
        if (res.ok) {
          const data = await res.json();
          setCredits(data.credits);
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [success]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-8 text-center">
        {success ? (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Payment Successful!</h1>
            <p className="text-gray-500 mb-4">Your credits have been added to your account.</p>
            {credits !== null && (
              <div className="bg-blue-50 rounded-xl p-4 mb-6">
                <p className="text-sm text-blue-600">Current Balance</p>
                <p className="text-3xl font-bold text-blue-700">{credits.toLocaleString()}</p>
                <p className="text-sm text-blue-500">credits</p>
              </div>
            )}
            <button
              onClick={() => router.push("/")}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Start Downloading →
            </button>
          </>
        ) : canceled ? (
          <>
            <div className="text-5xl mb-4">😕</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Payment Canceled</h1>
            <p className="text-gray-500 mb-6">No worries — your card was not charged.</p>
            <button
              onClick={() => router.push("/")}
              className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition"
            >
              ← Back to Map
            </button>
          </>
        ) : (
          <>
            <div className="text-5xl mb-4">💳</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Credits</h1>
            <p className="text-gray-500 mb-6">Manage your Thai GeoData Hub credits.</p>
            <button
              onClick={() => router.push("/")}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Go to Map →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function CreditsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>}>
      <CreditsContent />
    </Suspense>
  );
}
