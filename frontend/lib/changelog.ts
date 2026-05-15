// Version + changelog for the "What's New" modal.
//
// HOW TO ADD A NEW RELEASE:
//   1. Bump APP_VERSION below.
//   2. Add a new entry to the top of CHANGELOG (newest first).
//   3. Set new entry's `version` to match APP_VERSION.
//   4. Push. The "✨ NEW" badge will show next to the version in the header
//      until the user clicks the changelog (we track the last-seen version
//      in localStorage as "geodata_seen_version").

export const APP_VERSION = "1.3.4";

export interface ChangelogEntry {
  version:    string;
  date:       string;             // YYYY-MM-DD
  title_en:   string;
  title_th:   string;
  items_en:   string[];
  items_th:   string[];
  tag?:       "feature" | "fix" | "data";
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.3.4",
    date:    "2026-05-15",
    tag:     "fix",
    title_en: "Mobile banner now actually visible on iPhone",
    title_th: "แบนเนอร์มือถือขึ้นบน iPhone แล้วจริง",
    items_en: [
      "🐛 FIX: 'Open on desktop' banner was hidden inside the 0-height map cell on iOS — moved to position:fixed at top level with inline styles so it shows no matter what",
    ],
    items_th: [
      "🐛 แก้: แบนเนอร์ 'เปิดบนคอมพิวเตอร์' ซ่อนอยู่ในช่องแผนที่ที่สูง 0 บน iOS — ย้ายไปอยู่ตำแหน่ง fixed ด้านบนสุดให้แสดงแน่นอน",
    ],
  },
  {
    version: "1.3.3",
    date:    "2026-05-15",
    tag:     "feature",
    title_en: "Mobile visitors get a friendly 'open on desktop' nudge",
    title_th: "ผู้ใช้มือถือเห็นคำแนะนำให้เปิดบนคอม",
    items_en: [
      "💻 NEW: Soft banner on phones suggesting users open the site on a desktop — GIS workflows are easier with a mouse and a larger screen",
      "✕ Dismissible and persisted, so returning visitors aren't nagged",
      "🗺 Map still loads for anyone who wants to try; donation / feedback / sources still work",
    ],
    items_th: [
      "💻 ใหม่: แบนเนอร์บนมือถือ แนะนำให้เปิดบนคอมพิวเตอร์ — งาน GIS ใช้เมาส์และจอใหญ่จะง่ายกว่ามาก",
      "✕ ปิดได้และจำไว้ ผู้ใช้กลับมาจะไม่เห็นซ้ำ",
      "🗺 แผนที่ยังโหลดได้ปกติสำหรับคนที่อยากลอง บริจาค ส่งข้อเสนอแนะ ดูแหล่งข้อมูลใช้ได้หมด",
    ],
  },
  {
    version: "1.3.2",
    date:    "2026-05-15",
    tag:     "fix",
    title_en: "iOS Safari: map now visible (JS-driven viewport)",
    title_th: "iOS Safari: เห็นแผนที่แล้ว",
    items_en: [
      "🐛 FIX: map invisible on older iPhones — measure viewport in JS instead of relying on dvh / 100vh",
      "🔄 Map resizes when iOS URL bar collapses (visualViewport listener)",
      "🛟 Map cell has a min-height fallback so it can't collapse to zero",
    ],
    items_th: [
      "🐛 แก้: แผนที่ไม่ขึ้นบน iPhone รุ่นเก่า — วัดความสูงจอด้วย JS แทน",
      "🔄 แผนที่ปรับขนาดอัตโนมัติเมื่อแถบ URL บน iOS หุบ",
      "🛟 ช่องแผนที่มีความสูงขั้นต่ำกัน collapse",
    ],
  },
  {
    version: "1.3.1",
    date:    "2026-05-15",
    tag:     "fix",
    title_en: "iOS Safari fixes — map visible, cleaner mobile header",
    title_th: "แก้ไข iOS Safari — แผนที่แสดงได้ ลดความรกของแถบบน",
    items_en: [
      "🐛 FIX: Map now renders on iPhone Safari (100vh → 100dvh)",
      "📱 Mobile header decluttered: only ☰ menu, title, Donate, lang, sign in",
      "🧰 Secondary actions (Feedback / History / Sources / Privacy / version) moved into a tap-friendly grid inside the bottom-sheet drawer",
    ],
    items_th: [
      "🐛 แก้: แผนที่ขึ้นบน iPhone Safari แล้ว (เปลี่ยน 100vh เป็น 100dvh)",
      "📱 แถบด้านบนบนมือถือเรียบง่ายขึ้น: เหลือแค่เมนู ☰ ชื่อ Donate ภาษา และเข้าสู่ระบบ",
      "🧰 ปุ่มรอง (ข้อเสนอแนะ / ประวัติ / แหล่งข้อมูล / นโยบาย / เวอร์ชัน) ย้ายไปอยู่ในตารางในถาดเลื่อนขึ้น แตะง่าย",
    ],
  },
  {
    version: "1.3.0",
    date:    "2026-05-15",
    tag:     "feature",
    title_en: "Launch-ready: favicon, OG previews, privacy page",
    title_th: "พร้อมเปิดตัว: favicon, ลิงก์พรีวิว, หน้านโยบายความเป็นส่วนตัว",
    items_en: [
      "🎯 NEW: Favicon — Thai-flag map pin in the browser tab",
      "🖼 NEW: Rich link previews on LINE / Facebook / X (auto-generated 1200×630)",
      "🔒 NEW: /privacy page — clear PostHog disclosure, bilingual",
      "💳 Stripe disabled — donation-only via PromptPay + Buy Me a Coffee",
      "📖 README refreshed to match current architecture",
    ],
    items_th: [
      "🎯 ใหม่: ไอคอนแท็บเบราว์เซอร์ — หมุดแผนที่สีธงไทย",
      "🖼 ใหม่: พรีวิวลิงก์สวยบน LINE / Facebook / X (สร้างอัตโนมัติ 1200×630)",
      "🔒 ใหม่: หน้า /privacy — ชี้แจงเรื่อง PostHog แบบสองภาษา",
      "💳 ปิด Stripe — รับบริจาคผ่าน PromptPay + Buy Me a Coffee เท่านั้น",
      "📖 ปรับ README ให้ตรงกับสถาปัตยกรรมจริง",
    ],
  },
  {
    version: "1.2.0",
    date:    "2026-05-14",
    tag:     "feature",
    title_en: "UX polish — feedback, mobile, error states",
    title_th: "ปรับ UX — ส่งข้อเสนอแนะ มือถือ และจัดการ error",
    items_en: [
      "💬 NEW: Feedback button — request a layer, share data, or report a bug",
      "📱 Mobile-friendly: sidebar becomes a bottom-sheet drawer on phones",
      "🎯 High-contrast drawing cursor — visible on any basemap color",
      "⚠️ Prominent retry banner when the backend is waking up",
      "🔍 Better SEO: bilingual title + rich link previews on LINE / Facebook / X",
      "🧹 Repo cleanup: removed unused files, scrubbed local paths from history",
    ],
    items_th: [
      "💬 ใหม่: ปุ่มข้อเสนอแนะ — ขอชั้นข้อมูลใหม่ แชร์ข้อมูล หรือแจ้งบั๊ก",
      "📱 รองรับมือถือ: ไซด์บาร์กลายเป็นถาดเลื่อนขึ้นจากด้านล่าง",
      "🎯 เคอร์เซอร์วาดพื้นที่ชัดเจน — มองเห็นได้บนทุกสีของแผนที่",
      "⚠️ แบนเนอร์ลองใหม่เด่นชัดเมื่อ backend กำลังตื่นจากสลีป",
      "🔍 SEO ดีขึ้น: ชื่อเว็บไทย/อังกฤษ พรีวิวลิงก์สวยบน LINE / Facebook / X",
      "🧹 จัดระเบียบโค้ด: ลบไฟล์ที่ไม่ได้ใช้ ลบ path ส่วนตัวออกจากประวัติ git",
    ],
  },
  {
    version: "1.1.0",
    date:    "2026-05-11",
    tag:     "data",
    title_en: "Major data expansion + Buy Me a Coffee",
    title_th: "เพิ่มชั้นข้อมูลใหม่ + ปุ่ม Buy Me a Coffee",
    items_en: [
      "🏔 NEW: SRTM 30m elevation raster — elevation, slope, viewshed",
      "🏢 NEW: 2.73M Microsoft Buildings cropped to 8 major Thai cities",
      "👥 NEW: WorldPop population grid (100m resolution)",
      "☕ Buy Me a Coffee button now in the header — clearly visible",
      "💳 Donations: credit/debit card via Stripe (any amount, ฿20+)",
      "🇹🇭 PromptPay QR + phone 083-256-2524 for Thai donors",
    ],
    items_th: [
      "🏔 ใหม่: ข้อมูลความสูง SRTM 30 เมตร — ความสูง ความลาดชัน ทัศนวิสัย",
      "🏢 ใหม่: อาคาร Microsoft 2.73 ล้านแห่ง ใน 8 เมืองหลักของไทย",
      "👥 ใหม่: ข้อมูลประชากร WorldPop (ความละเอียด 100 เมตร)",
      "☕ ปุ่ม Buy Me a Coffee อยู่บนแถบด้านบนแล้ว — เห็นชัดเจน",
      "💳 บริจาค: บัตรเครดิต/เดบิต ผ่าน Stripe (ทุกจำนวน ตั้งแต่ ฿20)",
      "🇹🇭 พร้อมเพย์ QR + เบอร์ 083-256-2524 สำหรับผู้บริจาคชาวไทย",
    ],
  },
  {
    version: "1.0.0",
    date:    "2026-05-08",
    tag:     "feature",
    title_en: "Thai language + minimal typography",
    title_th: "เพิ่มภาษาไทย + ฟอนต์มินิมอลใหม่",
    items_en: [
      "🇹🇭 Thai / English language toggle (90+ UI strings localized)",
      "✨ IBM Plex Sans Thai — single font family for both languages",
      "🎨 Lighter typography for a cleaner, minimal look",
    ],
    items_th: [
      "🇹🇭 สลับภาษาไทย / อังกฤษได้ (แปลกว่า 90 ข้อความ)",
      "✨ ใช้ฟอนต์ IBM Plex Sans Thai — รองรับทั้ง 2 ภาษา",
      "🎨 ปรับฟอนต์ให้บางขึ้น ดูสะอาดและเรียบหรู",
    ],
  },
  {
    version: "0.9.0",
    date:    "2026-05-08",
    tag:     "feature",
    title_en: "Layer details + CRS conversion",
    title_th: "ข้อมูลเชิงลึกของชั้นข้อมูล + แปลง CRS",
    items_en: [
      "ⓘ Layer info modal: source, license, schema, sample values",
      "🌐 CRS dropdown: WGS 84, Web Mercator, UTM 47N/48N",
      "📜 Legal: ATTRIBUTION.txt + LICENSE.txt + README.txt in every ZIP",
    ],
    items_th: [
      "ⓘ หน้าต่างข้อมูลชั้น: ที่มา สัญญาอนุญาต โครงสร้าง ตัวอย่างข้อมูล",
      "🌐 ระบบพิกัดให้เลือก: WGS 84, Web Mercator, UTM 47N/48N",
      "📜 ไฟล์เอกสารกฎหมายแนบมากับ ZIP ทุกครั้ง",
    ],
  },
  {
    version: "0.8.0",
    date:    "2026-05-07",
    tag:     "feature",
    title_en: "AOI drawing + map preview + download history",
    title_th: "วาดพื้นที่ + พรีวิวบนแผนที่ + ประวัติดาวน์โหลด",
    items_en: [
      "✏️ Draw polygon on map, or upload GeoJSON / KML",
      "👁 Preview layers on the map before downloading",
      "📥 Download history with free re-download",
      "🗺 12 OpenStreetMap layers: roads, buildings, POIs, admin boundaries…",
    ],
    items_th: [
      "✏️ วาดพื้นที่บนแผนที่ หรืออัปโหลด GeoJSON / KML",
      "👁 ดูตัวอย่างชั้นข้อมูลบนแผนที่ก่อนดาวน์โหลด",
      "📥 ประวัติการดาวน์โหลด ดาวน์โหลดซ้ำได้ฟรี",
      "🗺 มี OSM ครบ 12 ชั้น: ถนน อาคาร POI ขอบเขตการปกครอง…",
    ],
  },
];
