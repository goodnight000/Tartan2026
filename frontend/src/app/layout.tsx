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
          <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
