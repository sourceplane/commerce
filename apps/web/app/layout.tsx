import { CartProvider } from "components/cart/cart-context";
import { DemoBanner } from "components/demo-banner";
import { Navbar } from "components/layout/navbar";
import { WelcomeToast } from "components/welcome-toast";
import { GeistSans } from "geist/font/sans";
import { getCart, isShopifyConfigured } from "lib/shopify";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";
import { SITE_NAME, requestOrigin } from "./site";

// Absolute URLs in the metadata (Open Graph images, canonical links) resolve
// against `metadataBase`, which is the origin of the request being answered
// (app/site.ts) — the site needs no configured URL of its own.
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: requestOrigin(await headers()),
    title: {
      default: SITE_NAME,
      template: `%s | ${SITE_NAME}`,
    },
    robots: {
      follow: true,
      index: true,
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Don't await the fetch, pass the Promise to the context provider
  const cart = getCart();
  const demo = !isShopifyConfigured();

  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="bg-neutral-50 text-black selection:bg-teal-300 dark:bg-neutral-900 dark:text-white dark:selection:bg-pink-500 dark:selection:text-white">
        <CartProvider cartPromise={cart}>
          {demo ? <DemoBanner /> : null}
          <Navbar />
          <main>
            {children}
            <Toaster closeButton />
            <WelcomeToast demo={demo} />
          </main>
        </CartProvider>
      </body>
    </html>
  );
}
