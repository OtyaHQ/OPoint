import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OtyaPoint Workforce",
  description: "Secure workforce and branch operations for OtyaPoint.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
