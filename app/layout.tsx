import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Checkup Agent — Max your free health check-up",
  description: "Max your free ₹30,000 health check-up — compare Bengaluru providers and get a ready-to-book plan.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
