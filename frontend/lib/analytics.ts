"use client";

// Thai GeoData Hub — analytics wrapper around PostHog.
//
// Configuration:
//   Set NEXT_PUBLIC_POSTHOG_KEY (PostHog "Project API key", starts with `phc_`)
//   in Vercel → Environment Variables. Public token, safe to ship in bundle.
//   Optional: NEXT_PUBLIC_POSTHOG_HOST defaults to https://us.i.posthog.com.
//   If you registered on the EU cloud, use https://eu.i.posthog.com.
//
// If the env var is missing, all analytics calls become no-ops (safe in dev).

import posthog from "posthog-js";

let initialised = false;

export function initAnalytics() {
  if (typeof window === "undefined") return;
  if (initialised) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return; // no key → silent no-op
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  posthog.init(key, {
    api_host: host,
    // Privacy-first defaults: no cookies, anonymise IPs, manual page tracking.
    persistence: "memory",       // no cookies (resets between sessions, GDPR-safe)
    ip: false,                   // don't store IPs
    autocapture: false,          // we'll instrument events manually for clean data
    capture_pageview: true,
    capture_pageleave: false,
    disable_session_recording: false,  // session replay enabled (5k/mo free)
    loaded: () => { initialised = true; },
  });
}

/**
 * Track a custom event. Safe to call even if PostHog isn't initialised.
 */
export function track(event: string, props?: Record<string, any>) {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    posthog.capture(event, props);
  } catch {
    // never let analytics throw
  }
}

/**
 * Associate the current visitor with their email (after soft login).
 * PostHog calls this "identify". Lets you correlate a session across pages.
 */
export function identify(email: string | null) {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    if (email) {
      posthog.identify(email, { email });
    } else {
      posthog.reset();
    }
  } catch {}
}

// ── Domain-specific event helpers (typed args, cleaner call sites) ──
//
// Centralising these here means we never typo an event name like
// "donaiton_clicked" in 5 different places.

export const events = {
  // ── Funnel: AOI → layers → download ──
  aoiDrawn:     (area_km2: number, lng: number, lat: number) =>
                  track("aoi_drawn", { area_km2: round2(area_km2), centroid_lng: round3(lng), centroid_lat: round3(lat) }),
  aoiUploaded:  (file_ext: string) =>
                  track("aoi_uploaded", { file_ext }),
  aoiCleared:   () =>
                  track("aoi_cleared"),

  layerSelected: (slug: string, action: "select" | "deselect") =>
                  track("layer_selected", { slug, action }),
  layerPreviewClicked: (slug: string) =>
                  track("layer_preview_clicked", { slug }),

  previewCountRequested: (layers: string[], aoi_area_km2: number) =>
                  track("preview_count_requested", { layers, layer_count: layers.length, aoi_area_km2: round2(aoi_area_km2) }),

  downloadClicked: (layers: string[], formats: string[], crs: string, total_features?: number) =>
                  track("download_clicked", { layers, formats, crs, layer_count: layers.length, total_features }),
  downloadSucceeded: (size_mb: number, duration_s: number, total_features: number) =>
                  track("download_succeeded", { size_mb: round2(size_mb), duration_s: round2(duration_s), total_features }),
  downloadFailed: (error: string) =>
                  track("download_failed", { error: String(error).slice(0, 200) }),

  // ── Donation funnel ──
  donateModalOpened: (trigger: "header" | "pre_download" | "header_other" | "no_credits") =>
                  track("donate_modal_opened", { trigger }),
  donateMethodClicked: (method: "bmac" | "card" | "promptpay" | "github_star" | "share" | "report_bug") =>
                  track("donate_method_clicked", { method }),
  donationStarted: (amount_thb: number, method: "card") =>
                  track("donation_started", { amount_thb, method }),

  // ── Other engagement ──
  langSwitched: (from: string, to: string) =>
                  track("lang_switched", { from, to }),
  introCompleted: () =>
                  track("intro_completed"),
  changelogOpened: (version: string) =>
                  track("changelog_opened", { version }),
  signedIn: (method: "email") =>
                  track("signed_in", { method }),
  signedOut: () =>
                  track("signed_out"),
  layerInfoOpened: (slug: string) =>
                  track("layer_info_opened", { slug }),
  redownloadClicked: (download_id: string) =>
                  track("redownload_clicked", { download_id }),
  preDownloadDecision: (decision: "continue" | "donate") =>
                  track("pre_download_decision", { decision }),
};

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
