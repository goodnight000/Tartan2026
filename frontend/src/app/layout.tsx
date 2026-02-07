import "./globals.css";
import "firebaseui/dist/firebaseui.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Cormorant_Garamond, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Providers } from "@/app/providers";
import { MobileNav } from "@/components/MobileNav";
import { TrustBadge } from "@/components/TrustBadge";

const editorial = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-editorial",
  weight: ["400", "500", "600", "700"],
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "CarePilot | Clinical Atelier",
  description:
    "A premium care coordination cockpit with triage-first guidance, transparent actions, and trust-grade records.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${editorial.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <div className="app-shell">
            <div className="atmosphere" aria-hidden="true" />
            <a href="#main-content" className="skip-link">
              Skip to main content
            </a>
            <header className="shell-header">
              <div className="shell-header__inner">
                <Link href="/" className="brand-lockup">
                  <span className="brand-lockup__eyebrow">CarePilot</span>
                  <span className="brand-lockup__title">Clinical Atelier</span>
                </Link>
                <MobileNav />
                <nav className="shell-nav" aria-label="Primary">
                  <Link href="/app">Command Center</Link>
                  <Link href="/profile">Trust Center</Link>
                  <Link href="/onboarding">Intake</Link>
                </nav>
                <div className="flex items-center gap-3">
                  <TrustBadge />
                  <a className="emergency-link" href="tel:911" aria-label="Emergency: Call 911">
                    Emergency: 911
                  </a>
                </div>
              </div>
            </header>
            <main id="main-content" className="shell-main" role="main">
              {children}
            </main>
            <footer className="app-footer" role="contentinfo">
              <p>
                CarePilot is not a substitute for professional medical advice.{" "}
                <a href="tel:911">In an emergency, call 911</a>.{" "}
                <Link href="/profile">Privacy & Data Controls</Link>
              </p>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
