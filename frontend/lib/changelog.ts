// Version + changelog for the "What's New" modal.
//
// HOW TO ADD A NEW RELEASE:
//   1. Bump APP_VERSION below.
//   2. Add a new entry to the top of CHANGELOG (newest first).
//   3. Set new entry's `version` to match APP_VERSION.
//   4. Push. The "✨ NEW" badge will show next to the version in the header
//      until the user clicks the changelog (we track the last-seen version
//      in localStorage as "geodata_seen_version").

export const APP_VERSION = "1.1.0";

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
