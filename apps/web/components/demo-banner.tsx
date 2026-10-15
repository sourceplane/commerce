import Link from "next/link";

// Shown on every page while no Shopify store is connected: the catalogue is
// the bundled demo (lib/demo) and checkout has no payment provider. Visible
// on purpose — a storefront that looks real must not let anyone think an
// order can be placed.
export function DemoBanner() {
  return (
    <div
      role="note"
      data-demo-banner
      className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
    >
      Demo store: the catalogue is sample data and checkout is not connected —
      connect a payment provider to take orders.{" "}
      <Link href="/about" className="font-medium underline underline-offset-2">
        How this store works
      </Link>
    </div>
  );
}
