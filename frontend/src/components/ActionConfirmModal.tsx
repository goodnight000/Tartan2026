"use client";

import { motion } from "framer-motion";
import { Shield, Calendar, Pill, MapPin, Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/TrustBadge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionPlan } from "@/lib/types";

const toolMeta: Record<string, { title: string; icon: typeof Zap; verb: string }> = {
  appointment_book: { title: "Confirm Appointment Booking", icon: Calendar, verb: "Book" },
  medication_refill_request: { title: "Confirm Prescription Refill", icon: Pill, verb: "Request" },
  lab_clinic_discovery: { title: "Confirm Lab & Clinic Search", icon: Search, verb: "Search" },
  book_appointment: { title: "Confirm Appointment Booking", icon: Calendar, verb: "Book" },
  request_refill: { title: "Confirm Prescription Refill", icon: Pill, verb: "Request" },
  find_pharmacy: { title: "Confirm Pharmacy Search", icon: MapPin, verb: "Search" },
  find_provider: { title: "Confirm Provider Search", icon: Search, verb: "Search" },
  schedule_reminder: { title: "Confirm Reminder Setup", icon: Calendar, verb: "Set" },
};

function getToolMeta(tool: string) {
  return toolMeta[tool] ?? { title: "Confirm Action", icon: Zap, verb: "Execute" };
}

function humanizeParams(params: Record<string, unknown>): Array<{ label: string; value: string }> {
  const entries: Array<{ label: string; value: string }> = [];
  for (const [key, val] of Object.entries(params)) {
    if (val === null || val === undefined || val === "") continue;
    const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const value = typeof val === "object" ? JSON.stringify(val) : String(val);
    entries.push({ label, value });
  }
  return entries;
}

export function ActionConfirmModal({
  plan,
  open,
  onClose,
  onConfirm,
  pending = false,
}: {
  plan: ActionPlan | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending?: boolean;
}) {
  if (!plan) return null;
  const meta = getToolMeta(plan.tool);
  const Icon = meta.icon;
  const params = humanizeParams(plan.params);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (!isOpen ? onClose() : null)}>
      <DialogContent>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.2, 0.85, 0.2, 1] }}
        >
          <DialogHeader className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[color:var(--cp-primary-soft)]">
                  <Icon className="h-4 w-4 text-[color:var(--cp-primary)]" aria-hidden="true" />
                </div>
                <DialogTitle className="text-2xl leading-none">{meta.title}</DialogTitle>
              </div>
              <Badge className="border-[color:var(--cp-primary)]/35 bg-[color:var(--cp-primary-soft)] text-[color:var(--cp-primary)]">
                Tier {plan.tier}
              </Badge>
            </div>
            <DialogDescription className="text-sm leading-6 text-[color:var(--cp-muted)]">
              {plan.consent_prompt ||
                "CarePilot is ready to run this action on your behalf. Review the details below and approve if correct."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <section className="space-y-2 rounded-2xl border border-[color:var(--cp-line)] bg-white/80 p-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--cp-muted)]">
                What
              </h4>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-[color:var(--cp-primary)]">{plan.tool}</span>
              </div>
            </section>

            {params.length > 0 && (
              <section className="space-y-2 rounded-2xl border border-[color:var(--cp-line)] bg-white/80 p-4">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--cp-muted)]">
                  Details
                </h4>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {params.map(({ label, value }, index) => (
                    <div key={`${index}-${label}`}>
                      <dt className="text-[11px] font-medium text-[color:var(--cp-muted)]">{label}</dt>
                      <dd className="text-sm font-medium text-[color:var(--cp-text)]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <div className="flex items-center gap-3 text-xs text-[color:var(--cp-muted)]">
              <TrustBadge />
              <span>Cancel now if anything looks incorrect before execution.</span>
            </div>
          </div>

          <DialogFooter className="mt-5">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              icon={<Shield className="h-3.5 w-3.5" />}
              disabled={pending}
              loading={pending}
            >
              {pending ? "Processing..." : `${meta.verb} & Record Consent`}
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
