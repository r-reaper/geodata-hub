"use client";

// Minimal i18n for Thai GeoData Hub.
// Two languages: 'en' (English, default) and 'th' (Thai).
// Persisted in localStorage as 'geodata_lang'.
//
// Usage:
//   const { t, lang, setLang } = useT();
//   t('app.title')          → "Thai GeoData Hub"
//   t('section.step1')      → "Find your area"  /  "ค้นหาพื้นที่"

import { useEffect, useState, useCallback } from "react";

export type Lang = "en" | "th";

// ─────────────────────────────────────────────
// Translation dictionary
// ─────────────────────────────────────────────
//
// Keep keys short and namespaced (header.x, step.x, action.x).
// Strings with {placeholders} are interpolated at call time.

const dict: Record<Lang, Record<string, string>> = {
  en: {
    "app.title":              "Thai GeoData Hub",
    "app.tagline":            "Free Thai OSM downloads · Clip by area",
    "app.online":             "● Online",
    "app.offline":            "Backend unreachable",

    "btn.history":            "📥 History",
    "btn.sources":            "© Sources",
    "btn.donate":             "💝 Donate",
    "btn.signin":             "Sign in",
    "btn.signout":            "Sign out",
    "btn.lang":               "ไทย",

    "step1.title":            "Find your area",
    "step1.placeholder":      "Search Bangkok, Phuket, Chiang Mai…",

    "step2.title":            "Define area of interest",
    "step2.draw":             "✏️ Draw on map",
    "step2.upload":           "📁 Upload GeoJSON or KML",
    "step2.drawing.title":    "Drawing mode",
    "step2.drawing.help":     "Click points on the map. Double-click to finish, or press Esc to cancel.",
    "step2.cancel":           "Cancel drawing",
    "step2.done":             "✓ Area defined",
    "step2.approx":           "Approx. {km} km²",
    "step2.clear":            "Clear & redraw",

    "step3.title":            "Pick data layers",
    "step3.needaoi":          "Define an area first",
    "step3.selected":         "{n} selected",
    "step3.features":         "{n} features",
    "step3.soon":             "Coming soon",
    "step3.raster":           "Raster — population grid",

    "step4.title":            "Format & download",
    "step4.formats":          "Export formats",
    "step4.crs":              "Coordinate Reference System",
    "step4.crsHint":          "Default WGS 84 (lat/lon). Pick UTM for accurate distance/area in meters.",
    "step4.preview":          "Preview feature count",
    "step4.previewing":       "Counting…",
    "step4.total":            "Total: {n}",
    "step4.free":             "FREE",
    "step4.download":         "⬇ Download ZIP",
    "step4.downloading":      "Preparing ZIP…",
    "step4.footer":           "100% free · No login required",
    "step4.retry":            "Last download failed",
    "step4.retryBtn":         "Retry (free)",

    "tip.draw":               'Click "Draw on map" to define your area',
    "tip.drawing":            "Click points · Double-click to finish · Esc to cancel",
    "tip.loading":            "Loading map…",
    "tip.maperror":           "Map failed to load",

    "toast.areaDefined":      "Area defined — now select layers",
    "toast.aoiLoaded":        "Loaded AOI from {file}",
    "toast.signedIn":         "Signed in as {email}",
    "toast.signedOut":        "Signed out",
    "toast.cancelled":        "Drawing cancelled",
    "toast.minPoints":        "Click at least 3 points to draw a polygon",
    "toast.parseFail":        "Could not parse AOI from file. Use GeoJSON Polygon or KML.",
    "toast.layerLoading":     "Loading {layer}…",
    "toast.layerNoView":      "{layer}: no features in current view — zoom out",
    "toast.previewFail":      "Preview failed: {err}",
    "toast.downloadOk":       "Downloading {file}",
    "toast.downloadFail":     "Download failed: {err}",
    "toast.redownloadOk":     "Re-downloading {file} — no charge",

    "login.title":            "Sign in with email",
    "login.subtitle":         "We use your email to remember your download history. No password needed.",
    "login.placeholder":      "you@example.com",
    "login.cancel":           "Cancel",
    "login.continue":         "Continue",
    "login.privacy":          "We never email marketing. Your email is used as your account ID only.",

    "donate.title":           "☕ Buy Me a Coffee · 🇹🇭 PromptPay · 💳 Card",
    "donate.subtitle":        "Downloads are free. For coffee, use the yellow button in the header. Or use one below.",
    "donate.cardTitle":       "💳 Credit / Debit Card",
    "donate.cardHint":        "Visa · Mastercard · JCB · secured by Stripe",
    "donate.cardCustom":      "Custom amount",
    "donate.cardCustomPh":    "Enter amount in THB",
    "donate.cardPay":         "Donate ฿{n}",
    "donate.cardMin":         "Minimum ฿20",
    "donate.bmac":            "☕ Buy Me a Coffee",
    "donate.bmacHint":        "Apple Pay · PayPal · works worldwide",
    "donate.promptpay":       "🇹🇭 PromptPay",
    "donate.promptpayScan":   "Scan the QR with any Thai bank app",
    "donate.promptpayNumber": "Or send to phone number:",
    "donate.promptpayAccount":"Account: Mr. Kampanart Srisuwan",
    "donate.altTitle":        "Other ways to support",
    "donate.altShare":        "📣 Share with the Thai GIS community",
    "donate.altStar":         "⭐ Star the GitHub repo",
    "donate.altReport":       "🐛 Report bugs or request features",
    "donate.footer":          "🙏 Any amount welcome — made with ❤️ in Thailand",
    "donate.thanks":          "Thanks for your support!",

    // Pre-download nudge
    "predownload.title":      "Quick question",
    "predownload.subtitle":   "All downloads are free. Would you like to support before continuing?",
    "predownload.continue":   "Continue download",
    "predownload.donate":     "💝 Donate first",

    "history.title":          "Download history",
    "history.subtitle":       "Re-download anytime — no charge",
    "history.empty":          "No downloads yet. Your purchases will appear here.",
    "history.again":          "⬇ Download again (free)",
    "history.expired":        "Expired — re-download unavailable",
    "history.loading":        "Loading…",
    "history.signinFirst":    "Sign in to see your download history",

    "intro.title":            "Welcome to Thai GeoData Hub",
    "intro.subtitle":         "Download free OpenStreetMap data for any area in Thailand in 4 simple steps:",
    "intro.s1.t":             "Find your area",
    "intro.s1.d":             "Search a city or jump to Bangkok / Chiang Mai / Phuket / Pattaya.",
    "intro.s2.t":             "Define your AOI",
    "intro.s2.d":             "Draw a polygon on the map, or upload a GeoJSON / KML.",
    "intro.s3.t":             "Pick layers",
    "intro.s3.d":             "Roads, buildings, waterways, POIs, admin boundaries — 12 layers in total.",
    "intro.s4.t":             "Download ZIP",
    "intro.s4.d":             "100% free — SHP, GeoJSON, KML included with proper attribution files.",
    "intro.cta":              "Got it — let's go",

    "details.geometry":       "Geometry",
    "details.featureCount":   "Feature count",
    "details.crs":            "Native CRS",
    "details.updated":        "Last updated",
    "details.source":         "Source:",
    "details.license":        "License:",
    "details.attribution":    "Required attribution:",
    "details.crsAvailable":   "Available output CRS",
    "details.schema":         "Attribute schema ({n} fields)",
    "details.schemaField":    "Field",
    "details.schemaType":     "Type",
    "details.schemaSample":   "Sample",
    "details.bbox":           "Coverage bbox (W, S, E, N)",
    "details.loading":        "Loading layer details…",

    "credits.button":         "Need more credits — buy now",

    // Changelog / version
    "changelog.title":        "What's new",
    "changelog.subtitle":     "Recent updates to Thai GeoData Hub",
    "changelog.viewAll":      "View on GitHub →",
    "changelog.close":        "Close",
    "changelog.badgeNew":     "NEW",
  },

  th: {
    "app.title":              "Thai GeoData Hub",
    "app.tagline":            "ดาวน์โหลดข้อมูล OSM ฟรี · เลือกพื้นที่ได้",
    "app.online":             "● ออนไลน์",
    "app.offline":            "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้",

    "btn.history":            "📥 ประวัติ",
    "btn.sources":            "© แหล่งข้อมูล",
    "btn.donate":             "💝 บริจาค",
    "btn.signin":             "เข้าสู่ระบบ",
    "btn.signout":            "ออกจากระบบ",
    "btn.lang":               "EN",

    "step1.title":            "ค้นหาพื้นที่",
    "step1.placeholder":      "ค้นหา กรุงเทพฯ, ภูเก็ต, เชียงใหม่…",

    "step2.title":            "กำหนดพื้นที่ที่สนใจ",
    "step2.draw":             "✏️ วาดบนแผนที่",
    "step2.upload":           "📁 อัปโหลดไฟล์ GeoJSON หรือ KML",
    "step2.drawing.title":    "โหมดวาด",
    "step2.drawing.help":     "คลิกจุดบนแผนที่ ดับเบิลคลิกเพื่อจบ หรือกด Esc เพื่อยกเลิก",
    "step2.cancel":           "ยกเลิกการวาด",
    "step2.done":             "✓ กำหนดพื้นที่แล้ว",
    "step2.approx":           "ประมาณ {km} ตร.กม.",
    "step2.clear":            "ล้าง & วาดใหม่",

    "step3.title":            "เลือกชั้นข้อมูล",
    "step3.needaoi":          "กำหนดพื้นที่ก่อน",
    "step3.selected":         "เลือกแล้ว {n} ชั้น",
    "step3.features":         "{n} จุดข้อมูล",
    "step3.soon":             "เร็วๆ นี้",
    "step3.raster":           "ราสเตอร์ — กริดประชากร",

    "step4.title":            "รูปแบบและดาวน์โหลด",
    "step4.formats":          "รูปแบบไฟล์",
    "step4.crs":              "ระบบพิกัด (CRS)",
    "step4.crsHint":          "เริ่มต้นเป็น WGS 84 (lat/lon) เลือก UTM สำหรับคำนวณระยะทาง/พื้นที่เป็นเมตร",
    "step4.preview":          "พรีวิวจำนวน Feature",
    "step4.previewing":       "กำลังนับ…",
    "step4.total":            "ทั้งหมด: {n}",
    "step4.free":             "ฟรี",
    "step4.download":         "⬇ ดาวน์โหลด ZIP",
    "step4.downloading":      "กำลังเตรียม ZIP…",
    "step4.footer":           "ฟรี 100% · ไม่ต้องล็อกอิน",
    "step4.retry":            "ดาวน์โหลดล่าสุดล้มเหลว",
    "step4.retryBtn":         "ลองใหม่ (ฟรี)",

    "tip.draw":               'กด "วาดบนแผนที่" เพื่อกำหนดพื้นที่ของคุณ',
    "tip.drawing":            "คลิกจุด · ดับเบิลคลิกเพื่อจบ · Esc เพื่อยกเลิก",
    "tip.loading":            "กำลังโหลดแผนที่…",
    "tip.maperror":           "โหลดแผนที่ไม่สำเร็จ",

    "toast.areaDefined":      "กำหนดพื้นที่แล้ว — เลือกชั้นข้อมูลต่อ",
    "toast.aoiLoaded":        "โหลด AOI จาก {file} แล้ว",
    "toast.signedIn":         "เข้าสู่ระบบเป็น {email}",
    "toast.signedOut":        "ออกจากระบบแล้ว",
    "toast.cancelled":        "ยกเลิกการวาดแล้ว",
    "toast.minPoints":        "ต้องคลิกอย่างน้อย 3 จุดเพื่อสร้างพื้นที่",
    "toast.parseFail":        "อ่านไฟล์ AOI ไม่ได้ ต้องเป็น GeoJSON Polygon หรือ KML",
    "toast.layerLoading":     "กำลังโหลด {layer}…",
    "toast.layerNoView":      "{layer}: ไม่มีข้อมูลในพื้นที่นี้ — ขยายมุมมอง",
    "toast.previewFail":      "พรีวิวล้มเหลว: {err}",
    "toast.downloadOk":       "กำลังดาวน์โหลด {file}",
    "toast.downloadFail":     "ดาวน์โหลดล้มเหลว: {err}",
    "toast.redownloadOk":     "ดาวน์โหลด {file} ใหม่ — ไม่คิดค่าใช้จ่าย",

    "login.title":            "เข้าสู่ระบบด้วยอีเมล",
    "login.subtitle":         "เราใช้อีเมลเพื่อจดจำประวัติการดาวน์โหลด ไม่ต้องมีรหัสผ่าน",
    "login.placeholder":      "you@example.com",
    "login.cancel":           "ยกเลิก",
    "login.continue":         "ดำเนินการต่อ",
    "login.privacy":          "เราไม่ส่งอีเมลโฆษณา อีเมลใช้เป็น ID ของบัญชีเท่านั้น",

    "donate.title":           "☕ Buy Me a Coffee · 🇹🇭 พร้อมเพย์ · 💳 บัตรเครดิต",
    "donate.subtitle":        "ดาวน์โหลดทุกอย่างฟรี · กดปุ่ม Buy Me a Coffee สีเหลืองที่ด้านบน หรือเลือกช่องทางด้านล่าง",
    "donate.cardTitle":       "💳 บัตรเครดิต / เดบิต",
    "donate.cardHint":        "Visa · Mastercard · JCB · ปลอดภัยด้วย Stripe",
    "donate.cardCustom":      "จำนวนกำหนดเอง",
    "donate.cardCustomPh":    "กรอกจำนวนเงิน (THB)",
    "donate.cardPay":         "บริจาค ฿{n}",
    "donate.cardMin":         "ขั้นต่ำ ฿20",
    "donate.bmac":            "☕ Buy Me a Coffee",
    "donate.bmacHint":        "Apple Pay · PayPal · ใช้ได้ทั่วโลก",
    "donate.promptpay":       "🇹🇭 พร้อมเพย์",
    "donate.promptpayScan":   "สแกน QR ด้วยแอปธนาคารใดก็ได้",
    "donate.promptpayNumber": "หรือโอนเข้าเบอร์:",
    "donate.promptpayAccount":"ชื่อบัญชี: นาย กัมปนาท ศรีสุวรรณ",
    "donate.altTitle":        "วิธีสนับสนุนอื่นๆ",
    "donate.altShare":        "📣 แชร์ในชุมชน GIS ไทย",
    "donate.altStar":         "⭐ กดดาวให้ GitHub repo",
    "donate.altReport":       "🐛 แจ้งบั๊กหรือเสนอฟีเจอร์",
    "donate.footer":          "🙏 ยินดีรับทุกจำนวน — สร้างด้วย ❤️ ในประเทศไทย",
    "donate.thanks":          "ขอบคุณที่สนับสนุน!",

    // Pre-download nudge
    "predownload.title":      "คำถามสั้นๆ",
    "predownload.subtitle":   "ดาวน์โหลดทุกครั้งฟรี อยากสนับสนุนโปรเจกต์ก่อนดาวน์โหลดไหม?",
    "predownload.continue":   "ดาวน์โหลดต่อ",
    "predownload.donate":     "💝 บริจาคก่อน",

    "history.title":          "ประวัติการดาวน์โหลด",
    "history.subtitle":       "ดาวน์โหลดซ้ำได้ทุกเมื่อ — ฟรี",
    "history.empty":          "ยังไม่มีการดาวน์โหลด รายการจะปรากฏที่นี่",
    "history.again":          "⬇ ดาวน์โหลดอีกครั้ง (ฟรี)",
    "history.expired":        "หมดอายุ — ดาวน์โหลดซ้ำไม่ได้",
    "history.loading":        "กำลังโหลด…",
    "history.signinFirst":    "เข้าสู่ระบบก่อนเพื่อดูประวัติการดาวน์โหลด",

    "intro.title":            "ยินดีต้อนรับสู่ Thai GeoData Hub",
    "intro.subtitle":         "ดาวน์โหลดข้อมูล OpenStreetMap ฟรี สำหรับพื้นที่ใดในประเทศไทยใน 4 ขั้นตอน:",
    "intro.s1.t":             "ค้นหาพื้นที่",
    "intro.s1.d":             "ค้นหาชื่อเมือง หรือกระโดดไปกรุงเทพฯ / เชียงใหม่ / ภูเก็ต / พัทยา",
    "intro.s2.t":             "กำหนดพื้นที่ AOI",
    "intro.s2.d":             "วาดรูปหลายเหลี่ยมบนแผนที่ หรืออัปโหลด GeoJSON / KML",
    "intro.s3.t":             "เลือกชั้นข้อมูล",
    "intro.s3.d":             "ถนน อาคาร แหล่งน้ำ POI ขอบเขตการปกครอง — มีให้เลือกหลายชั้น",
    "intro.s4.t":             "ดาวน์โหลด ZIP",
    "intro.s4.d":             "ฟรี 100% — มี SHP, GeoJSON, KML พร้อมไฟล์ระบุที่มา",
    "intro.cta":              "เข้าใจแล้ว — เริ่มเลย",

    "details.geometry":       "ประเภทรูปทรง",
    "details.featureCount":   "จำนวนข้อมูล",
    "details.crs":            "CRS ต้นฉบับ",
    "details.updated":        "อัปเดตล่าสุด",
    "details.source":         "ที่มา:",
    "details.license":        "สัญญาอนุญาต:",
    "details.attribution":    "ต้องระบุที่มา:",
    "details.crsAvailable":   "CRS ที่ส่งออกได้",
    "details.schema":         "โครงสร้างข้อมูล ({n} คอลัมน์)",
    "details.schemaField":    "ฟิลด์",
    "details.schemaType":     "ประเภท",
    "details.schemaSample":   "ตัวอย่าง",
    "details.bbox":           "ขอบเขต (W, S, E, N)",
    "details.loading":        "กำลังโหลดข้อมูลชั้น…",

    "credits.button":         "ต้องการเครดิตเพิ่ม — ซื้อเลย",

    // Changelog / version
    "changelog.title":        "มีอะไรใหม่",
    "changelog.subtitle":     "อัปเดตล่าสุดของ Thai GeoData Hub",
    "changelog.viewAll":      "ดูบน GitHub →",
    "changelog.close":        "ปิด",
    "changelog.badgeNew":     "ใหม่",
  },
};

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

const STORAGE_KEY = "geodata_lang";

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? String(vars[key]) : `{${key}}`));
}

export function useT() {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved === "th" || saved === "en") setLangState(saved);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next;
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const s = dict[lang][key] ?? dict.en[key] ?? key;
      return interpolate(s, vars);
    },
    [lang]
  );

  const toggle = useCallback(() => setLang(lang === "en" ? "th" : "en"), [lang, setLang]);

  return { t, lang, setLang, toggle };
}
