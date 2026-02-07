import Link from "next/link";
import { Shield, AlertTriangle, Database, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const pillars = [
  {
    title: "Triage Before Convenience",
    detail:
      "Every message is safety-scored before recommendations or transactions are proposed.",
    tone: "status-chip status-chip--danger",
    label: "Safety First",
  },
  {
    title: "Action Workbench",
    detail:
      "Booking, refill, and discovery actions are explicit, confirmable, and lifecycle-tracked.",
    tone: "status-chip status-chip--info",
    label: "Transparent Execution",
  },
  {
    title: "Clinical Memory",
    detail:
      "Conditions, medications, and symptom trajectories stay coherent across every conversation.",
    tone: "status-chip status-chip--success",
    label: "Longitudinal Context",
  },
];

const trustSignals = [
  {
    icon: Shield,
    title: "End-to-End Encrypted",
    detail: "Your health data is encrypted at rest and in transit.",
  },
  {
    icon: AlertTriangle,
    title: "Emergency Detection",
    detail: "Real-time triage catches emergencies and directs you to 911.",
  },
  {
    icon: Database,
    title: "You Control Your Data",
    detail: "Export or delete your data anytime from the Trust Center.",
  },
];

const howItWorks = [
  { step: "1", title: "Share Your Context", detail: "Complete a quick clinical intake so CarePilot understands your needs." },
  { step: "2", title: "Ask Anything", detail: "Describe symptoms, request refills, or ask for provider recommendations." },
  { step: "3", title: "Review & Act", detail: "Approve consent-gated actions and track outcomes in your audit log." },
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="surface-card reveal grid gap-8 p-8 md:grid-cols-[1.15fr_0.85fr] md:p-12">
        <div className="space-y-6">
          <p className="editorial-eyebrow">Premium Care Coordination</p>
          <h1 className="panel-title max-w-3xl text-[clamp(2.5rem,7vw,5rem)] leading-[0.9]">
            A clinical command center built for trust, speed, and clarity.
          </h1>
          <p className="panel-subtitle max-w-2xl text-base md:text-lg">
            CarePilot combines triage-safe guidance, persistent health memory, and consent-based action workflows so users can move from concern to resolution without guesswork.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" icon={<ArrowRight className="h-4 w-4" />}>
              <Link href="/login">Enter Command Center</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/onboarding">Preview Intake Flow</Link>
            </Button>
          </div>
        </div>
        <div className="grid gap-3">
          {[
            ["Voice Transcript", "Ready for review before send"],
            ["Document Analysis", "Lab and imaging summaries with uncertainty cues"],
            ["Apple Health Signals", "Per-metric permissions with sync transparency"],
            ["Trust Receipts", "Consent snapshots + auditable outcomes"],
          ].map(([title, detail], index) => (
            <Card key={title} className="reveal space-y-2 p-4" style={{ animationDelay: `${index * 90}ms` }}>
              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--cp-muted)]">
                {title}
              </div>
              <div className="text-sm text-[color:var(--cp-text)]">{detail}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* Trust signals */}
      <section className="grid gap-4 md:grid-cols-3" aria-label="Trust signals">
        {trustSignals.map((signal, index) => {
          const Icon = signal.icon;
          return (
            <Card
              key={signal.title}
              className="reveal flex items-start gap-4 p-5"
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--cp-primary-soft)]">
                <Icon className="h-5 w-5 text-[color:var(--cp-primary)]" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg leading-tight">{signal.title}</h3>
                <p className="mt-1 text-sm text-[color:var(--cp-muted)]">{signal.detail}</p>
              </div>
            </Card>
          );
        })}
      </section>

      {/* How it works */}
      <section aria-label="How it works">
        <Card className="reveal space-y-6 p-8" style={{ animationDelay: "120ms" }}>
          <div className="text-center">
            <p className="editorial-eyebrow">How It Works</p>
            <h2 className="panel-title mt-2 text-[clamp(1.8rem,4vw,3rem)]">Three steps to better care</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {howItWorks.map((item, index) => (
              <div key={item.step} className="reveal flex flex-col items-center text-center" style={{ animationDelay: `${200 + index * 100}ms` }}>
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[color:var(--cp-primary)] bg-white text-lg font-bold text-[color:var(--cp-primary)]">
                  {item.step}
                </div>
                <h3 className="mt-3 text-xl leading-tight">{item.title}</h3>
                <p className="mt-1 text-sm text-[color:var(--cp-muted)]">{item.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Pillars */}
      <section className="grid gap-4 md:grid-cols-3" aria-label="Core pillars">
        {pillars.map((pillar, index) => (
          <Card key={pillar.title} className="reveal space-y-3 p-5" style={{ animationDelay: `${120 + index * 100}ms` }}>
            <span className={pillar.tone}>{pillar.label}</span>
            <h2 className="text-3xl leading-none">{pillar.title}</h2>
            <p className="panel-subtitle">{pillar.detail}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
