import Footer from "components/layout/footer";
import Price from "components/price";
import { getCart, isShopifyConfigured } from "lib/shopify";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false },
};

// Where "Proceed to Checkout" lands when there is nowhere to pay. With a
// Shopify store connected, a cart's checkout is Shopify's hosted checkout and
// this route only forwards to it. Without one the storefront runs on its demo
// catalogue and has no payment provider, so instead of a failed redirect (or a
// 500) the shopper is told plainly that checkout is not connected yet, and the
// owner is told what connects it.
export default async function CheckoutPage() {
  const cart = await getCart();

  if (isShopifyConfigured()) {
    redirect(cart?.checkoutUrl || "/cart");
  }

  return (
    <>
      <div className="mx-auto max-w-(--breakpoint-md) px-4 py-12">
        <h1 className="mb-6 text-4xl font-bold">Checkout</h1>
        <section
          role="status"
          data-checkout-notice
          className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <h2 className="mb-2 text-xl font-semibold">
            Connect a payment provider to enable checkout
          </h2>
          <p className="mb-3">
            This store is running on its demo catalogue: no store backend and
            no payment provider are connected, so no order can be placed and
            nothing has been charged. Your cart is kept on this device.
          </p>
          <p className="text-sm">
            Store owner: connect a Shopify store and its hosted checkout takes
            payment — set the store&apos;s Storefront API facts as Worker
            secrets, as the repository&apos;s README describes under
            &ldquo;Connecting Shopify&rdquo;.
          </p>
        </section>
        {cart && cart.lines.length > 0 ? (
          <div className="mt-8 flex items-center justify-between text-lg">
            <p>
              {cart.totalQuantity} item{cart.totalQuantity === 1 ? "" : "s"} in
              your cart
            </p>
            <Price
              className="text-right font-medium"
              amount={cart.cost.totalAmount.amount}
              currencyCode={cart.cost.totalAmount.currencyCode}
            />
          </div>
        ) : null}
        <div className="mt-8 flex gap-6 text-sm">
          <Link href="/cart" className="underline underline-offset-4">
            Back to your cart
          </Link>
          <Link href="/search" className="underline underline-offset-4">
            Continue shopping
          </Link>
        </div>
      </div>
      <Footer />
    </>
  );
}
