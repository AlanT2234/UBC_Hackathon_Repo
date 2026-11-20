import type { ReactNode } from "react";
import { Archivo, Atkinson_Hyperlegible } from "next/font/google";
import "./globals.css";

// Atkinson Hyperlegible was designed for low-vision readers; Archivo's heavy grotesque matches
// the SafeNSound wordmark for headings and amounts.
const sans = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-sans",
});

const display = Archivo({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display",
});

export const metadata = {
  title: "SafeNSound",
  description: "Voice payments for seniors, with scam protection. Spending rules are enforced by the contract.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} font-sans`}>{children}</body>
    </html>
  );
}
