"use client";

// Donation landing page (kept at /credits for backward compat with old Stripe URLs).

import { useRouter } from "next/navigation";
import { useT } from "../../lib/i18n";

export default function DonatePage() {
  const router = useRouter();
  const { t, lang, toggle } = useT();

  const headline    = lang === "th" ? "สนับสนุน Thai GeoData Hub" : "Support Thai GeoData Hub";
  const tagline     = lang === "th"
    ? "ดาวน์โหลดทั้งหมดฟรี · ขอบคุณที่ช่วยให้เซิร์ฟเวอร์ทำงานต่อได้"
    : "All downloads are free · thanks for keeping the lights on";
  const ptTitle     = lang === "th" ? "🇹🇭 พร้อมเพย์ (สำหรับผู้บริจาคชาวไทย)" : "🇹🇭 PromptPay (Thai donors)";
  const ptHelp      = lang === "th"
    ? "เปิดแอปธนาคาร เลือกพร้อมเพย์ และส่งจำนวนเงินที่ต้องการไปยัง:"
    : "Open your bank app, choose PromptPay, and send any amount to:";
  const ptBanks     = lang === "th"
    ? "ใช้ได้กับ KBank, SCB, Bangkok Bank, Krungthai, TMBThanachart และธนาคารที่รองรับพร้อมเพย์ทุกแห่ง"
    : "Works with KBank, SCB, Bangkok Bank, Krungthai, TMBThanachart, and any PromptPay-enabled bank.";
  const whyTitle    = lang === "th" ? "ทำไมต้องบริจาค?" : "Why donate?";
  const whyPoints   = lang === "th"
    ? [
        "ค่า Railway backend และ Cloudflare R2 storage",
        "เพื่อให้มีเวลาเพิ่มแหล่งข้อมูลอื่นๆ (DGA, GISTDA เมื่อได้รับอนุญาต)",
        "เพิ่มฟีเจอร์ในอนาคต (ชั้นข้อมูลเพิ่ม, เซิร์ฟเวอร์เร็วขึ้น, UI สำหรับมือถือ)",
        "สนับสนุนเครื่องมือ GIS ของไทยที่อิสระ — ไม่มีโฆษณา ไม่มีการติดตาม ไม่มีกำแพง enterprise",
      ]
    : [
        "Keeps the Railway backend + Cloudflare R2 storage paid for",
        "Lets me allocate time to add more data sources (DGA, GISTDA when permissions land)",
        "Enables future features (more layers, faster servers, mobile-friendly UI)",
        "Supports independent Thai GIS tooling — no ads, no tracking, no enterprise gates",
      ];
  const back        = lang === "th" ? "← กลับไปที่แผนที่" : "← Back to map";
  const footer      = lang === "th"
    ? "สร้างด้วย ❤️ ในประเทศไทย · ข้อมูลเปิดสำหรับทุกคน"
    : "Made with ❤️ in Thailand · Open data for everyone";

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 font-sans">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-slate-600 hover:text-slate-900 font-light"
          >
            {back}
          </button>
          <button
            onClick={toggle}
            className="px-2.5 py-1.5 rounded-md hover:bg-slate-100 text-slate-700 text-xs border border-slate-200"
          >
            {t("btn.lang")}
          </button>
        </div>

        <div className="text-center mb-8">
          <div className="text-5xl mb-3">💝</div>
          <h1 className="text-3xl text-slate-900 font-medium">{headline}</h1>
          <p className="text-slate-600 mt-2 font-light">{tagline}</p>
        </div>

        <div className="space-y-4">
          <a
            href="https://www.buymeacoffee.com/kampanart"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-4 px-5 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-medium rounded-xl text-lg shadow-sm transition"
          >
            {t("donate.bmac")}
          </a>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-slate-900 mb-2 font-medium">{ptTitle}</h3>
            <p className="text-sm text-slate-600 mb-3 font-light">{ptHelp}</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-sm text-slate-900">
              kamp.guitar@gmail.com
            </div>
            <p className="text-xs text-slate-500 mt-2 font-light">{ptBanks}</p>
          </div>
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm text-blue-900">
          <h3 className="mb-2 font-medium">{whyTitle}</h3>
          <ul className="space-y-1 text-xs list-disc list-inside font-light">
            {whyPoints.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>

        <p className="mt-8 text-xs text-slate-400 text-center font-light">{footer}</p>
      </div>
    </div>
  );
}
