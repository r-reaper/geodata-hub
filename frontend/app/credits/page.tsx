"use client";

// This page is preserved at /credits for backwards compatibility (old Stripe
// redirect URLs), but the project is now donation-funded. All downloads are
// free. This page now shows how to support the project.

import { useRouter } from "next/navigation";

export default function DonatePage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-slate-600 hover:text-slate-900 font-medium mb-6 inline-flex items-center gap-1"
        >
          ← Back to map
        </button>

        <div className="text-center mb-8">
          <div className="text-5xl mb-3">💝</div>
          <h1 className="text-3xl font-bold text-slate-900">Support Thai GeoData Hub</h1>
          <p className="text-slate-600 mt-2">
            All downloads are <strong>free</strong>. Donations help keep the servers running.
          </p>
        </div>

        <div className="space-y-4">
          <a
            href="https://www.buymeacoffee.com/kampanart"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-4 px-5 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold rounded-xl text-lg shadow-md transition"
          >
            ☕ Buy Me a Coffee
          </a>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-2">🇹🇭 PromptPay (Thai donors)</h3>
            <p className="text-sm text-slate-600 mb-3">
              Open your bank app, choose PromptPay, and send any amount to:
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-sm text-slate-900">
              kamp.guitar@gmail.com
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Works with KBank, SCB, Bangkok Bank, Krungthai, TMBThanachart, and any PromptPay-enabled bank.
            </p>
          </div>
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm text-blue-900">
          <h3 className="font-bold mb-2">Why donate?</h3>
          <ul className="space-y-1 text-xs list-disc list-inside">
            <li>Keeps the Railway backend + Cloudflare R2 storage paid for</li>
            <li>Lets me allocate time to add more data sources (DGA, GISTDA when permissions land)</li>
            <li>Enables future features (more layers, faster servers, mobile-friendly UI)</li>
            <li>Supports independent Thai GIS tooling — no ads, no tracking, no enterprise gates</li>
          </ul>
        </div>

        <p className="mt-8 text-xs text-slate-400 text-center">
          Made with ❤️ in Thailand · Open data for everyone
        </p>
      </div>
    </div>
  );
}
