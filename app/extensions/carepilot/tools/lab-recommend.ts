import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { InNetworkPreference, LabCandidate } from "../services/lab-ranking.js";
import { rankLabOptions } from "../services/lab-ranking.js";

const DEFAULT_CATALOG: LabCandidate[] = [
  {
    name: "City Diagnostic Lab",
    distance_miles: 2.4,
    price_estimate: 55,
    price_range: "$",
    next_slot: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    rating: 4.6,
    network_match_hint: "in_network_likely",
  },
  {
    name: "Metro Imaging & Labs",
    distance_miles: 4.9,
    price_estimate: 68,
    price_range: "$$",
    next_slot: new Date(Date.now() + 16 * 60 * 60 * 1000).toISOString(),
    rating: 4.4,
    network_match_hint: "unknown",
  },
  {
    name: "Neighborhood Lab Center",
    distance_miles: 1.8,
    price_estimate: 82,
    price_range: "$$",
    next_slot: new Date(Date.now() + 28 * 60 * 60 * 1000).toISOString(),
    rating: 4.1,
    network_match_hint: "out_of_network_likely",
  },
  {
    name: "Regional Care Diagnostics",
    distance_miles: 7.2,
    price_estimate: 60,
    price_range: "$$",
    next_slot: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    rating: 4.8,
    network_match_hint: "unknown",
  },
];

function inNetworkPreference(value: unknown): InNetworkPreference {
  if (value === "no_preference") {
    return "no_preference";
  }
  return "prefer_in_network";
}

function resolveCandidatePool(maxDistanceMiles: number, budgetCap: number): LabCandidate[] {
  const relaxedDistanceCap = Math.max(1, maxDistanceMiles) * 1.5;
  const relaxedBudgetCap = Math.max(10, budgetCap) * 1.75;
  const filtered = DEFAULT_CATALOG.filter(
    (candidate) =>
      candidate.distance_miles <= relaxedDistanceCap && candidate.price_estimate <= relaxedBudgetCap,
  );
  return filtered.length > 0 ? filtered : [...DEFAULT_CATALOG];
}

export function createLabRecommendTool(_api: OpenClawPluginApi) {
  return {
    name: "lab_recommend",
    description: "Recommend labs/clinics using contract-locked ranking and soft network preference.",
    parameters: Type.Object({
      zip_or_geo: Type.String(),
      max_distance_miles: Type.Number({ minimum: 1 }),
      budget_cap: Type.Number({ minimum: 1 }),
      preferred_time_window: Type.String(),
      in_network_preference: Type.Optional(
        Type.Union([Type.Literal("prefer_in_network"), Type.Literal("no_preference")]),
      ),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const zipOrGeo = typeof rawParams.zip_or_geo === "string" ? rawParams.zip_or_geo.trim() : "";
      const maxDistanceMiles =
        typeof rawParams.max_distance_miles === "number" ? rawParams.max_distance_miles : NaN;
      const budgetCap = typeof rawParams.budget_cap === "number" ? rawParams.budget_cap : NaN;
      const preferredTimeWindow =
        typeof rawParams.preferred_time_window === "string" ? rawParams.preferred_time_window.trim() : "";

      if (!zipOrGeo || !Number.isFinite(maxDistanceMiles) || !Number.isFinite(budgetCap) || !preferredTimeWindow) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_input",
              message:
                "zip_or_geo, max_distance_miles, budget_cap, and preferred_time_window are required.",
            },
          ],
        });
      }

      const candidatePool = resolveCandidatePool(maxDistanceMiles, budgetCap);
      const options = rankLabOptions({
        candidates: candidatePool,
        maxDistanceMiles,
        budgetCap,
        inNetworkPreference: inNetworkPreference(rawParams.in_network_preference),
      });

      return jsonResult({
        status: "ok",
        data: {
          zip_or_geo: zipOrGeo,
          preferred_time_window: preferredTimeWindow,
          options,
        },
        errors: [],
      });
    },
  };
}
