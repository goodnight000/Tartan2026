import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <p className="text-xs tracking-[0.3em] uppercase text-slate-500">MedClaw</p>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink">
          A calm, reliable medical copilot with memory and safe action gates.
        </h1>
        <p className="text-slate-600 max-w-2xl">
          Start with onboarding, then use the dashboard and persistent chatbot panel.
        </p>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/login">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="grid md:grid-cols-3 gap-6">
        {[
          {
            title: "Safety-first",
            body: "Emergency triage before any agentic actions."
          },
          {
            title: "Persistent memory",
            body: "Profiles and symptom logs power smarter guidance."
          },
          {
            title: "Transparent actions",
            body: "Consent gate before searches or bookings."
          }
        ].map((item) => (
          <Card key={item.title}>
            <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
            <p className="text-sm text-slate-600">{item.body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
