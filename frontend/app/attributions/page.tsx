"use client";

import { useRouter } from "next/navigation";
import { useT } from "../../lib/i18n";

const SOURCES = [
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
    license: "Open Database License (ODbL) v1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors",
    layers: [
      "Provinces", "Districts", "Sub-districts",
      "Roads", "Waterways", "Railways",
      "Buildings (OSM)", "Land Use", "Natural Features",
      "National Parks", "Temples", "POIs",
    ],
    notes: "Crowd-sourced map data, the backbone of the catalog (12 layers). Free to use commercially with attribution. Any database derived from this data and publicly distributed must also be ODbL-licensed.",
  },
  {
    name: "Microsoft Building Footprints",
    url: "https://github.com/microsoft/GlobalMLBuildingFootprints",
    license: "Open Database License (ODbL) v1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "Building footprints © Microsoft",
    layers: ["Buildings (Microsoft, urban)"],
    notes: "Microsoft AI-detected building footprints, cropped to 8 Thai metropolitan areas (Bangkok metro, Chiang Mai, Chiang Rai, Phuket, Pattaya, Hat Yai, Khon Kaen, Korat) — ~2.73 million buildings. Same ODbL terms as OSM.",
  },
  {
    name: "WorldPop",
    url: "https://www.worldpop.org/",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Population data © WorldPop, University of Southampton",
    layers: ["Population (2020)"],
    notes: "Gridded population estimates at 100 m resolution, UN-adjusted for 2020. Total ~70 M people across Thailand. CC BY 4.0 — free commercial use with citation.",
  },
  {
    name: "NASA SRTM",
    url: "https://www.earthdata.nasa.gov/sensors/srtm",
    license: "Public domain (U.S. Government work)",
    licenseUrl: "https://www.usa.gov/government-works",
    attribution: "Elevation data: NASA SRTM",
    layers: ["Elevation (SRTM 30m)"],
    notes: "NASA Shuttle Radar Topography Mission, 1 arc-second (30 m) global digital elevation model. U.S. Government work — public domain, no restrictions. Elevation range covered: -96 m to 2,823 m (sea-level depressions to Doi Inthanon).",
  },
];

export default function AttributionsPage() {
  const router = useRouter();
  const { t, lang, toggle } = useT();
  const back = lang === "th" ? "← กลับไปที่แผนที่" : "← Back to map";
  const title = lang === "th" ? "แหล่งข้อมูลและการระบุที่มา" : "Data sources & attributions";
  const intro = lang === "th"
    ? "ข้อมูลทั้งหมดบน Thai GeoData Hub มาจากแหล่งข้อมูลเปิดเหล่านี้ ทุกครั้งที่ดาวน์โหลด ไฟล์ระบุที่มาและสัญญาอนุญาตที่เกี่ยวข้องจะแนบมาใน ZIP — กรุณาปฏิบัติตามเงื่อนไขเมื่อใช้งานหรือเผยแพร่ซ้ำ"
    : "All data on Thai GeoData Hub comes from these open sources. When you download data, the corresponding attribution and license files are bundled inside the ZIP — please follow the terms when using or redistributing.";

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-slate-600 hover:text-slate-900 font-light inline-flex items-center gap-1"
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

        <div className="mb-8">
          <h1 className="text-3xl text-slate-900 font-medium">{title}</h1>
          <p className="text-slate-600 mt-2 font-light">{intro}</p>
        </div>

        <div className="space-y-5">
          {SOURCES.map((s) => (
            <div key={s.name} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className="flex flex-wrap justify-between items-start gap-3 mb-3">
                <h2 className="text-xl font-bold text-slate-900">{s.name}</h2>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Visit source ↗
                </a>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">License</div>
                  <a href={s.licenseUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">
                    {s.license} ↗
                  </a>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Required attribution</div>
                  <code className="text-sm text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">{s.attribution}</code>
                </div>
              </div>

              <div className="mb-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-1">Layers in this catalog</div>
                <div className="flex flex-wrap gap-1.5">
                  {s.layers.map((l) => (
                    <span key={l} className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{l}</span>
                  ))}
                </div>
              </div>

              <p className="text-xs text-slate-600">{s.notes}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="font-medium text-blue-900 mb-2">How to attribute correctly</h3>
          <p className="text-sm text-blue-900 mb-2 font-light">
            When you publish a map, app, or report using data from Thai GeoData Hub, include the attribution lines from the <code className="bg-white px-1 rounded text-xs">ATTRIBUTION.txt</code> inside your downloaded ZIP. Typically a one-line credit at the bottom of your map or in your About page is enough.
          </p>
          <p className="text-sm text-blue-900 font-light">
            For <strong>ODbL</strong> data (OSM, Microsoft Buildings), if you publish a database derived from this data, the derived database must also be ODbL-licensed. For <strong>CC BY 4.0</strong> data (WorldPop), you only need to give credit — your derived work can be any license. <strong>NASA SRTM</strong> is public domain with no restrictions, but crediting NASA is good practice.
          </p>
        </div>

        <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 font-light">
          <p className="mb-1.5">
            <strong className="text-slate-900">Not redistributed here</strong> (would require explicit permissions):
          </p>
          <ul className="list-disc list-inside space-y-0.5 ml-1">
            <li>Royal Thai Survey Department (RTSD) topographic maps</li>
            <li>Department of Land cadastre / property parcels</li>
            <li>GISTDA satellite imagery (THEOS, THEOS-2)</li>
            <li>GADM administrative boundaries (not free for commercial)</li>
            <li>Google Open Buildings (full v3 dataset — temporarily excluded for storage)</li>
          </ul>
          <p className="mt-2">If you need those, contact the original agencies directly.</p>
        </div>

        <p className="mt-6 text-[11px] text-slate-400 text-center font-light">
          © {new Date().getFullYear()} Thai GeoData Hub · Open data redistribution under each source&apos;s license
        </p>
      </div>
    </div>
  );
}
