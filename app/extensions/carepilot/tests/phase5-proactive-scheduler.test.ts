import { describe, expect, it } from "vitest";
import {
  buildAppointmentReminderJobs,
  buildFollowUpNudgeJob,
  buildRefillReminderJobs,
  resolveScheduledLocalTimestamp,
} from "../services/proactive-scheduler.js";

function localDateTime(utcIso: string, timeZone: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(utcIso));
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) {
      throw new Error(`Missing Intl part: ${type}`);
    }
    return value;
  };
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    time: `${pick("hour")}:${pick("minute")}`,
  };
}

describe("carepilot phase5 proactive scheduler", () => {
  it("builds appointment reminder jobs with main/systemEvent cron shape", () => {
    const jobs = buildAppointmentReminderJobs({
      appointmentId: "apt-123",
      timeZone: "America/New_York",
      appointmentLocalDate: "2026-02-10",
      appointmentLocalTime: "14:30",
    });

    expect(jobs).toHaveLength(2);
    for (const draft of jobs) {
      expect(draft.job.sessionTarget).toBe("main");
      expect(draft.job.payload.kind).toBe("systemEvent");
      expect(draft.job.schedule.kind).toBe("at");
      expect(draft.job.name).toContain("carepilot-appointment");
      expect(draft.dedupeKey).toContain(draft.jobId);
    }
  });

  it("maps spring-forward invalid local time to next valid local minute", () => {
    const resolved = resolveScheduledLocalTimestamp({
      timeZone: "America/New_York",
      localDate: "2026-03-08",
      localTime: "02:30",
    });

    const local = localDateTime(resolved.utcIso, "America/New_York");
    expect(resolved.resolution).toBe("next_valid_local_minute");
    expect(local.date).toBe("2026-03-08");
    expect(local.time).toBe("03:00");
  });

  it("uses first occurrence for fall-back repeated local time and emits dedupe key", () => {
    const draft = buildFollowUpNudgeJob({
      followUpId: "fallback-1",
      timeZone: "America/New_York",
      localDate: "2026-11-01",
      localTime: "01:30",
    });

    expect(draft.job.schedule.kind).toBe("at");
    const atIso = draft.job.schedule.kind === "at" ? draft.job.schedule.at : new Date(0).toISOString();
    const local = localDateTime(atIso, "America/New_York");
    expect(draft.isRepeatedLocalTime).toBe(true);
    expect(local.date).toBe("2026-11-01");
    expect(local.time).toBe("01:30");
    expect(draft.dedupeKey).toBe(`${draft.jobId}:2026-11-01`);
  });

  it("builds refill reminder jobs for default day offsets", () => {
    const drafts = buildRefillReminderJobs({
      medicationId: "med-1",
      timeZone: "America/Los_Angeles",
      runOutLocalDate: "2026-07-20",
    });

    expect(drafts).toHaveLength(3);
    const names = drafts.map((draft) => draft.job.name);
    expect(names).toEqual([
      "carepilot-refill-med-1-5d",
      "carepilot-refill-med-1-2d",
      "carepilot-refill-med-1-1d",
    ]);
  });
});
