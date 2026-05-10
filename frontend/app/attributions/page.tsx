"use client";

import { useRouter } from "next/navigation";

const SOURCES = [
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
    license: "Open Database License (ODbL) v1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors",
    layers: ["Provinces", "Districts", "Sub-districts", "Roads", "Waterways", "Railways", "Buildings (OSM)", "Land Use", "Natural Features", "National Parks", "Temples", "POIs"],
    notes: "Crowd-sourced map data. Free to use commercially with attribution. Any database derived and publicly distributed must also be ODbL.",
  },
  {
    name: "Microsoft Building Footprints",
    url: "https://github.com/microsoft/GlobalMLBuildingFootprints",
    license: "Open Database License (ODbL) v1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "Building footprints © Microsoft",
    layers: ["Microsoft Buildings"],
    notes: "Microsoft AI-detected building footprints, ~7 million for Thailand. Same ODbL terms as OSM.",
  },
  {
    name: "Google Open Buildings",
    url: "https://sites.research.google/open-buildings/",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Building footprints © Google",
    layers: ["Google Buildings"],
    notes: "Google AI-detected buildings with confidence scores. CC BY 4.0 — free commercial use with attribution.",
  },
  {
    name: "WorldPop",
    url: "https://www.worldpop.org/",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Population data © WorldPop, University of Southampton",
    layers: ["Population"],
    notes: "Gridded population estimates at 100 m resolution. CC BY 4.0 — free commercial use with citation.",
  },
];

export default function AttributionsPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-slate-600 hover:text-slate-900 font-medium mb-6 inline-flex items-center gap-1"
        >
          ← Back to map
        </button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Data sources & attributions</h1>
          <p className="text-slate-600 mt-2">
            All data on Thai GeoData Hub comes from these open sources. When you download data, the corresponding attribution and license files are bundled inside the ZIP — please follow the terms when using or redistributing.
          </p>
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
          <h3 className="font-bold text-blue-900 mb-2">How to attribute correctly</h3>
          <p className="text-sm text-blue-900 mb-2">
            When you publish a map, app, or report using data from Thai GeoData Hub, include the attribution lines from the <code className="bg-white px-1 rounded text-xs">ATTRIBUTION.txt</code> inside your downloaded ZIP. Typically a one-line credit at the bottom of your map or in your About page is enough.
          </p>
          <p className="text-sm text-blue-900">
            For ODbL data (OSM, Microsoft Buildings), if you publish a database derived from this data, the derived database must also be ODbL-licensed. For CC BY data (Google Buildings, WorldPop), you only need to give credit — your derived work can be any license.
          </p>
        </div>

        <p className="mt-6 text-xs text-slate-400 text-center">
          We do <strong>not</strong> redistribute proprietary or commercial-restricted data (RTSD topo maps, Department of Land cadastre, GISTDA satellite imagery, GADM, etc.). If you need those, contact the original agencies directly.
        </p>
      </div>
    </div>
  );
}
