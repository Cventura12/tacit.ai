import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tacit",
  description: "Local evidence agent — one consequential request, every claim traceable.",
  openGraph: {
    title: "Tacit",
    description: "Local evidence agent — one consequential request, every claim traceable.",
    url: "/",
    siteName: "Tacit",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Tacit",
    description: "Local evidence agent — one consequential request, every claim traceable.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${fraunces.variable} ${inter.variable} h-full antialiased`}
      >
        <body className="h-full bg-bg text-ink font-sans overflow-hidden">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
