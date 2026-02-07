import { describe, expect, it } from "vitest";
import { estimateRefillRunout } from "../services/refill-estimator.js";

const NOW = new Date("2026-02-07T12:00:00.000Z");

describe("carepilot refill estimator edge cases", () => {
  it("returns confirmation-required result for paused medications", () => {
    const result = estimateRefillRunout(
      {
        medication_id: "med-paused",
        medication_name: "Test Med",
        medication_status: "paused",
      },
      NOW,
    );
    expect(result.runout_estimate_date).toBeNull();
    expect(result.requires_confirmation).toBe(true);
    expect(result.confidence_label).toBe("low");
  });

  it("does not auto-compute runout for PRN regimens", () => {
    const result = estimateRefillRunout(
      {
        medication_id: "med-prn",
        medication_name: "PRN Med",
        regimen_type: "prn",
      },
      NOW,
    );
    expect(result.runout_estimate_date).toBeNull();
    expect(result.requires_confirmation).toBe(true);
  });

  it("computes non-daily schedule using interval", () => {
    const result = estimateRefillRunout(
      {
        medication_id: "med-weekly",
        medication_name: "Weekly Med",
        regimen_type: "non_daily",
        schedule_interval_days: 7,
        last_fill_date: "2026-02-01T00:00:00.000Z",
        quantity_dispensed: 8,
      },
      NOW,
    );
    expect(result.runout_estimate_date).not.toBeNull();
    expect(result.estimated_days_total).toBe(56);
  });

  it("forces confirmation when fill metadata is missing", () => {
    const result = estimateRefillRunout(
      {
        medication_id: "med-missing",
        medication_name: "Missing Fields Med",
        medication_status: "active",
        frequency_per_day: 1,
      },
      NOW,
    );
    expect(result.runout_estimate_date).toBeNull();
    expect(result.requires_confirmation).toBe(true);
  });
});
