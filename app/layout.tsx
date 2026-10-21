import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "cn";

// Every page is prerendered at build time and the site has no server of its
// own (the data are static files): the build fails if a page ever needs a
// request-time render (ADR 0001).
export const ensureStatic = "navigation";

const spaceGroteskHeading = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  // The deployment's own origin (e.g. https://walkedby.manuel.fyi; every
  // city is a route under it), for absolute metadata URLs.
  ...(process.env.SITE_URL
    ? { metadataBase: new URL(process.env.SITE_URL) }
    : {}),
  title: "City Walk",
  description: "Deutsche Städte als begehbare 3D-Modelle aus offenen Geodaten",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        inter.variable,
        spaceGroteskHeading.variable
      )}
      lang="de"
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
