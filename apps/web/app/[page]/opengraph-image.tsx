import OpengraphImage from "components/opengraph-image";
import { getPage } from "lib/shopify";

// Next 16 passes an image route's params as a Promise (upstream reads them
// synchronously, which made every page's image a 500).
export default async function Image({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const page = await getPage((await params).page);
  const title = page?.seo?.title || page?.title;

  return await OpengraphImage({ title });
}
