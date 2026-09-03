import type { Metadata } from "next";
import { Archivo, Archivo_Narrow, Heebo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const label = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-label",
  display: "swap",
});
const body = Heebo({
  subsets: ["latin", "hebrew"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Plan room",
  description: "Turn a building-plan PDF into an interactive symbol map",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="he"
      className={`${display.variable} ${label.variable} ${body.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
