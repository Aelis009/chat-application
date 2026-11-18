import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chatter — Real-time chat",
  description: "A simple real-time chat app for friends.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
