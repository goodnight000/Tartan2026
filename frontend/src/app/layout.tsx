import "./globals.css";
import "firebaseui/dist/firebaseui.css";
import type { Metadata } from "next";
import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: "MedClaw",
  description: "Hackathon-ready medical copilot"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
            <header className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">MedClaw</div>
              <nav className="flex items-center gap-3 text-sm">
                <a className="text-slate-600 hover:text-slate-900" href="/login">
                  Login
                </a>
                <a className="text-slate-600 hover:text-slate-900" href="/app">
                  Dashboard
                </a>
                <a className="text-slate-600 hover:text-slate-900" href="/profile">
                  Profile
                </a>
              </nav>
            </header>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
