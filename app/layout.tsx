import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plan interaction builder",
  description: "Turn a building-plan PDF into an interactive symbol map",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he">
      <body>{children}</body>
    </html>
  );
}
