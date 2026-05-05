import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MainWithChatPanel } from "@/components/MainWithChatPanel";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AIR4 — Personal Finance",
  description: "Swedbank CSV upload, categorization, insights, and chat",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-screen flex-col bg-white text-zinc-950">
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col">
          <MainWithChatPanel>{children}</MainWithChatPanel>
        </main>
        <footer className="border-t border-zinc-100 bg-white">
          <div className="mx-auto w-full max-w-6xl px-6 py-4 text-xs text-zinc-500">
            Backend: http://localhost:8000 • Ollama: http://localhost:11434
          </div>
        </footer>
      </body>
    </html>
  );
}
