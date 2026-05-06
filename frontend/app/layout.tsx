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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased bg-zinc-950 text-zinc-100`}
    >
      <body className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col">
          <MainWithChatPanel>{children}</MainWithChatPanel>
        </main>
        <footer className="border-t border-white/5 bg-zinc-950/50 backdrop-blur-md">
          <div className="mx-auto w-full max-w-6xl px-6 py-4 text-xs text-zinc-600">
            Backend: http://localhost:8000 • Ollama: http://localhost:11434
          </div>
        </footer>
      </body>
    </html>
  );
}
