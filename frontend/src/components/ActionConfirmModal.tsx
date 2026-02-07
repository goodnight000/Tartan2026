"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from "@/components/ui/dialog";
import type { ActionPlan } from "@/lib/types";

export function ActionConfirmModal({
  plan,
  open,
  onClose,
  onConfirm
}: {
  plan: ActionPlan | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!plan) return null;
  return (
    <Dialog open={open} onOpenChange={(isOpen) => (!isOpen ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Confirm action</h2>
            <Badge>Tier {plan.tier}</Badge>
          </div>
          <p className="text-sm text-slate-600">
            {plan.consent_prompt ||
              "The assistant is ready to perform an action. Confirm to proceed."}
          </p>
        </DialogHeader>
        <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
          <div className="font-semibold">Tool</div>
          <div className="mb-2">{plan.tool}</div>
          <div className="font-semibold">Params</div>
          <pre className="overflow-auto text-xs">
            {JSON.stringify(plan.params, null, 2)}
          </pre>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm & Execute</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
