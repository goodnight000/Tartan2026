import type { ActionPlan } from "@/lib/types";

/**
 * Creates request-scoped agent tools for the Dedalus runner.
 *
 * Uses positional string params (not destructured objects) because the
 * Dedalus SDK extracts schemas via regex on Function.prototype.toString().
 * Destructured params like `({ query, location })` produce broken schema
 * keys (e.g. "{ query"). Positional params extract cleanly.
 *
 * All params default to type:"string" in the generated schema, so numbers
 * are parsed internally.
 */
export function createAgentTools(pendingActions: ActionPlan[]) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

  // --- Tier 1: auto-executed, read-only ---

  async function find_nearby_pharmacies(
    query: string,
    location: string,
    radius_miles: string
  ): Promise<string> {
    const res = await fetch(`${backendUrl}/actions/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: {
          tier: 1,
          tool: "find_nearby_pharmacies",
          params: {
            query: query || "pharmacy",
            location: location || "",
            radius_miles: Number(radius_miles) || 5,
          },
        },
        user_confirmed: true,
      }),
    });
    if (!res.ok) return JSON.stringify({ error: `Backend error: ${res.status}` });
    const data = await res.json();
    return JSON.stringify(data.result ?? data);
  }
  (find_nearby_pharmacies as any).description =
    "Search for nearby pharmacies using Google Places. " +
    "Parameters: query (search text like 'pharmacy' or '24hr pharmacy'), " +
    "location (city or address like 'Pittsburgh, PA'), " +
    "radius_miles (search radius as a number, default 5).";

  async function find_nearby_labs(
    query: string,
    location: string,
    radius_miles: string
  ): Promise<string> {
    const res = await fetch(`${backendUrl}/actions/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: {
          tier: 1,
          tool: "find_nearby_labs",
          params: {
            query: query || "medical lab",
            location: location || "",
            radius_miles: Number(radius_miles) || 5,
          },
        },
        user_confirmed: true,
      }),
    });
    if (!res.ok) return JSON.stringify({ error: `Backend error: ${res.status}` });
    const data = await res.json();
    return JSON.stringify(data.result ?? data);
  }
  (find_nearby_labs as any).description =
    "Search for nearby medical labs and diagnostic centers using Google Places. " +
    "Parameters: query (search text like 'blood test lab'), " +
    "location (city or address like 'Pittsburgh, PA'), " +
    "radius_miles (search radius as a number, default 5).";

  async function find_specialists(
    query: string,
    location: string,
    radius_miles: string
  ): Promise<string> {
    const res = await fetch(`${backendUrl}/actions/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: {
          tier: 1,
          tool: "find_specialists",
          params: {
            query: query || "medical specialist",
            location: location || "",
            radius_miles: Number(radius_miles) || 5,
          },
        },
        user_confirmed: true,
      }),
    });
    if (!res.ok) return JSON.stringify({ error: `Backend error: ${res.status}` });
    const data = await res.json();
    return JSON.stringify(data.result ?? data);
  }
  (find_specialists as any).description =
    "Search for nearby medical specialists and doctors using Google Places. " +
    "Parameters: query (specialty like 'cardiologist' or 'dermatologist'), " +
    "location (city or address like 'Pittsburgh, PA'), " +
    "radius_miles (search radius as a number, default 5).";

  // --- Tier 2: require user confirmation ---

  async function book_appointment(
    provider_name: string,
    date: string,
    time: string,
    reason: string
  ): Promise<string> {
    const plan: ActionPlan = {
      tier: 2,
      tool: "booking_mock",
      params: { provider_name, date, time, reason },
      consent_prompt:
        `I'd like to book an appointment with ${provider_name || "the provider"} ` +
        `on ${date || "a date you choose"} at ${time || "a time you choose"} ` +
        `for: ${reason || "general visit"}. Shall I proceed?`,
    };
    pendingActions.push(plan);
    return JSON.stringify({
      status: "pending_confirmation",
      message:
        "The booking request has been prepared and will be shown to the user for confirmation.",
    });
  }
  (book_appointment as any).description =
    "Book an appointment with a healthcare provider. Requires user confirmation. " +
    "Parameters: provider_name (name of doctor or practice), " +
    "date (requested date in YYYY-MM-DD format), " +
    "time (requested time like '10:00 AM'), " +
    "reason (reason for the visit).";

  async function request_refill(
    medication_name: string,
    pharmacy: string,
    notes: string
  ): Promise<string> {
    const plan: ActionPlan = {
      tier: 2,
      tool: "refill_request",
      params: { medication_name, pharmacy, notes },
      consent_prompt:
        `I'd like to request a refill for ${medication_name || "your medication"} ` +
        `at ${pharmacy || "your preferred pharmacy"}. Shall I proceed?`,
    };
    pendingActions.push(plan);
    return JSON.stringify({
      status: "pending_confirmation",
      message:
        "The refill request has been prepared and will be shown to the user for confirmation.",
    });
  }
  (request_refill as any).description =
    "Request a prescription medication refill. Requires user confirmation. " +
    "Parameters: medication_name (name of the medication to refill), " +
    "pharmacy (preferred pharmacy name or location), " +
    "notes (additional notes for the pharmacist).";

  return [
    find_nearby_pharmacies,
    find_nearby_labs,
    find_specialists,
    book_appointment,
    request_refill,
  ];
}
