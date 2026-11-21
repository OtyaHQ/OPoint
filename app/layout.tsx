import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opoint — Business Operations",
  description: "Retail and fintech agency operations, unified with clear financial separation.",
  applicationName: "Opoint",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050812",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
