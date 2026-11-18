import type { ReactNode } from "react";
import { Atkinson_Hyperlegible, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const sans = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-sans",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-serif",
});

export const metadata = {
  title: "Guardian",
  description: "A voice payment guardian. Spending rules are enforced by the contract.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable} font-sans`}>{children}</body>
    </html>
  );
}
