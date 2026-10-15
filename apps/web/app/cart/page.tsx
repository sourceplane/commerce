import { redirectToCheckout } from "components/cart/actions";
import Footer from "components/layout/footer";
import Price from "components/price";
import { DEFAULT_OPTION } from "lib/constants";
import { getCart } from "lib/shopify";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false },
};

// The cart as a page, rendered on the server from the same getCart() the
// cart modal reads — so it works without JavaScript, and is a stable URL for
// "view your cart". Checkout is a plain form post to the same server action
// the modal uses.
export default async function CartPage() {
  const cart = await getCart();
  const lines = cart?.lines ?? [];

  return (
    <>
      <div className="mx-auto max-w-(--breakpoint-md) px-4 py-12">
        <h1 className="mb-8 text-4xl font-bold">Your cart</h1>
        {lines.length === 0 ? (
          <p data-cart-empty className="text-lg">
            Your cart is empty.{" "}
            <Link href="/search" className="underline underline-offset-4">
              Browse the store
            </Link>
            .
          </p>
        ) : (
          <>
            <ul className="divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
              {lines.map((item) => (
                <li
                  key={item.merchandise.id}
                  data-cart-line={item.merchandise.id}
                  className="flex items-center gap-4 py-4"
                >
                  <div className="relative h-16 w-16 flex-none overflow-hidden rounded-md border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-black">
                    <Image
                      className="h-full w-full object-cover"
                      width={64}
                      height={64}
                      alt={
                        item.merchandise.product.featuredImage.altText ||
                        item.merchandise.product.title
                      }
                      src={item.merchandise.product.featuredImage.url}
                    />
                  </div>
                  <div className="flex flex-1 flex-col">
                    <Link
                      href={`/product/${item.merchandise.product.handle}`}
                      className="font-medium hover:underline"
                    >
                      {item.merchandise.product.title}
                    </Link>
                    {item.merchandise.title !== DEFAULT_OPTION ? (
                      <span className="text-sm text-neutral-500 dark:text-neutral-400">
                        {item.merchandise.title}
                      </span>
                    ) : null}
                    <span className="text-sm text-neutral-500 dark:text-neutral-400">
                      Quantity <span data-cart-quantity>{item.quantity}</span>
                    </span>
                  </div>
                  <Price
                    className="text-right text-sm"
                    amount={item.cost.totalAmount.amount}
                    currencyCode={item.cost.totalAmount.currencyCode}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-center justify-between text-lg">
              <p>Total</p>
              <Price
                className="text-right font-medium"
                amount={cart!.cost.totalAmount.amount}
                currencyCode={cart!.cost.totalAmount.currencyCode}
              />
            </div>
            <form action={redirectToCheckout} className="mt-8">
              <button
                type="submit"
                className="block w-full rounded-full bg-blue-600 p-3 text-center text-sm font-medium text-white opacity-90 hover:opacity-100"
              >
                Proceed to Checkout
              </button>
            </form>
          </>
        )}
      </div>
      <Footer />
    </>
  );
}
