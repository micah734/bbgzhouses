import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HouseDeck",
  description: "A modern, portable house points app for schools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
