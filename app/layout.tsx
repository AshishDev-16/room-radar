import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Room Radar — Read the room",
  description: "A live social prediction game for 2–8 players.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
