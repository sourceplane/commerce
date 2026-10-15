import { headers } from "next/headers";
import { requestOrigin } from "./site";

export default async function robots() {
  const origin = requestOrigin(await headers())?.origin ?? "";

  return {
    rules: [
      {
        userAgent: "*",
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
