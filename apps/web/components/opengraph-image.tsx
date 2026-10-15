import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SITE_NAME } from "app/site";
import { ImageResponse } from "next/og";
import LogoIcon from "./icons/logo";
import { join } from "path";
import { readFile } from "fs/promises";

export type Props = {
  title?: string;
};

// Upstream reads the font from the filesystem. A Worker has none, so the font
// lives in public/ (a static asset) and is read through the ASSETS binding
// when the filesystem read fails; `next dev` and `next build` read the file.
async function loadFont(): Promise<ArrayBuffer> {
  try {
    const file = await readFile(
      join(process.cwd(), "./public/fonts/Inter-Bold.ttf"),
    );
    return Uint8Array.from(file).buffer;
  } catch {
    const { env } = await getCloudflareContext({ async: true });
    const res = await env.ASSETS.fetch(
      "https://assets.local/fonts/Inter-Bold.ttf",
    );
    return res.arrayBuffer();
  }
}

export default async function OpengraphImage(
  props?: Props,
): Promise<ImageResponse> {
  // The site's name when the route has no title of its own (a page or a
  // collection that does not exist yet).
  const title = props?.title || SITE_NAME;

  const font = await loadFont();

  return new ImageResponse(
    (
      <div tw="flex h-full w-full flex-col items-center justify-center bg-black">
        <div tw="flex flex-none items-center justify-center border border-neutral-700 h-[160px] w-[160px] rounded-3xl">
          <LogoIcon width="64" height="58" fill="white" />
        </div>
        <p tw="mt-12 text-6xl font-bold text-white">{title}</p>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Inter",
          data: font,
          style: "normal",
          weight: 700,
        },
      ],
    },
  );
}
