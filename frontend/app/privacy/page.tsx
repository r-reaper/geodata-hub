"use client";

import { useRouter } from "next/navigation";
import { useT } from "../../lib/i18n";

export default function PrivacyPage() {
  const router = useRouter();
  const { t, lang, toggle } = useT();
  const back = lang === "th" ? "← กลับไปที่แผนที่" : "← Back to map";

  // Bilingual content kept inline so the page is fast and crawlable.
  const isTh = lang === "th";

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 font-sans">
      <div className="max-w-3xl mx-auto">
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

        <h1 className="text-3xl text-slate-900 font-medium mb-2">
          {isTh ? "นโยบายความเป็นส่วนตัว" : "Privacy"}
        </h1>
        <p className="text-slate-500 text-sm font-light mb-8">
          {isTh ? "ปรับปรุงล่าสุด: 15 พฤษภาคม 2026" : "Last updated: 15 May 2026"}
        </p>

        <div className="space-y-6 text-slate-700">
          <Section
            title={isTh ? "สรุปสั้น ๆ" : "TL;DR"}
            body={
              isTh
                ? "ใช้งานเว็บไซต์ได้แบบไม่ต้องสมัครสมาชิก ไม่เก็บข้อมูลส่วนตัว ใช้ PostHog เก็บสถิติการใช้งานแบบไม่ระบุตัวตน ไม่มีการขายข้อมูลให้บุคคลที่สาม"
                : "Use without signup. No personal data is collected. PostHog records anonymous usage stats so we can improve the site. No data is sold."
            }
          />

          <Section
            title={isTh ? "ข้อมูลที่เก็บ" : "What we collect"}
            list={
              isTh
                ? [
                    "อีเมล (เฉพาะถ้าคุณกดเข้าสู่ระบบ) — เก็บไว้ใน localStorage ของเบราว์เซอร์คุณเท่านั้น",
                    "ขอบเขตพื้นที่ที่คุณวาด (AOI) — เก็บใน localStorage เพื่อให้ไม่หายเมื่อรีเฟรชหน้า",
                    "สถิติแบบไม่ระบุตัวตน: หน้าที่ดู ปุ่มที่กด ชั้นข้อมูลที่เลือก ขนาดพื้นที่ — เก็บผ่าน PostHog",
                    "ประวัติการดาวน์โหลด — เก็บที่ฝั่งเซิร์ฟเวอร์ผูกกับอีเมลของคุณ (ถ้าเข้าสู่ระบบ)",
                  ]
                : [
                    "Email (only if you sign in) — stored in your browser's localStorage only.",
                    "Area-of-interest polygon you draw — stored in localStorage so it survives refresh.",
                    "Anonymous usage stats: pageviews, clicks, layer selections, AOI size — collected via PostHog.",
                    "Download history — stored on our server, keyed to your email if signed in.",
                  ]
            }
          />

          <Section
            title={isTh ? "PostHog (เครื่องมือเก็บสถิติ)" : "PostHog analytics"}
            body={
              isTh
                ? "เราใช้ PostHog Cloud (US) ตั้งค่าให้ไม่เก็บที่อยู่ IP ไม่ใช้คุกกี้ (ใช้ memory persistence) และเก็บข้อมูลแบบไม่ระบุตัวตน คุณสามารถปิดได้ด้วยการเปิดโหมด Do Not Track ในเบราว์เซอร์ของคุณ"
                : "We use PostHog Cloud (US region). It's configured to NOT store IP addresses, NOT use cookies (memory persistence only), and collect data anonymously. You can opt out by enabling Do Not Track in your browser."
            }
          />

          <Section
            title={isTh ? "ข้อมูลที่ดาวน์โหลด" : "Downloaded data"}
            body={
              isTh
                ? "ข้อมูล GIS ที่คุณดาวน์โหลดเป็นข้อมูลเปิดจาก OpenStreetMap, Microsoft, WorldPop และ NASA — ดูสัญญาอนุญาตที่หน้า /attributions ทุกครั้งที่ดาวน์โหลดจะมีไฟล์ระบุที่มาและสัญญาอนุญาตแนบใน ZIP"
                : "GIS data you download is open data from OpenStreetMap, Microsoft, WorldPop, and NASA. See /attributions for full licenses. Every ZIP includes attribution + license files."
            }
          />

          <Section
            title={isTh ? "การลบข้อมูล" : "Deleting your data"}
            body={
              isTh
                ? "ต้องการให้ลบประวัติการดาวน์โหลดหรืออีเมลของคุณ? ส่งข้อความผ่านปุ่ม 💬 ข้อเสนอแนะ หรืออีเมลถึง kamp.guitar@gmail.com พร้อมแจ้งอีเมลที่ใช้ลงทะเบียน เราจะลบให้ภายใน 7 วัน"
                : "Want your download history or email removed? Use the 💬 Feedback button or email kamp.guitar@gmail.com with the email you signed up with. We'll delete it within 7 days."
            }
          />

          <Section
            title={isTh ? "คุกกี้" : "Cookies"}
            body={
              isTh
                ? "เราไม่ใช้คุกกี้ ข้อมูลที่ค้างอยู่ในเบราว์เซอร์ของคุณ (อีเมล AOI ภาษา) ใช้ localStorage ซึ่งคุณลบได้ตลอดเวลาจากการตั้งค่าเบราว์เซอร์"
                : "We don't use cookies. Persisted browser data (email, AOI, language preference) uses localStorage, which you can clear anytime from browser settings."
            }
          />

          <Section
            title={isTh ? "ผู้ดูแล" : "Contact"}
            body="kamp.guitar@gmail.com"
          />
        </div>

        <p className="mt-10 text-[11px] text-slate-400 text-center font-light">
          © {new Date().getFullYear()} Thai GeoData Hub
        </p>
      </div>
    </div>
  );
}

function Section({ title, body, list }: { title: string; body?: string; list?: string[] }) {
  return (
    <section>
      <h2 className="text-xl text-slate-900 font-medium mb-2">{title}</h2>
      {body && <p className="font-light leading-relaxed">{body}</p>}
      {list && (
        <ul className="list-disc list-inside space-y-1 font-light leading-relaxed">
          {list.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
