// The site's identity, written once. The navbar, the footer, the page titles
// and the Open Graph image read SITE_NAME; the footer's source link goes to
// SOURCE_URL. Instantiating the site under a new name rewrites both to that
// name and its repository, so keep them literal and on one line each.
export const SITE_NAME = "Next.js Commerce";
export const SOURCE_URL = "https://github.com/sourceplane/commerce";

// The origin a request was made to, for every absolute URL the site renders
// about itself (metadataBase, robots.txt, sitemap.xml). Every route renders
// per request anyway, so the site needs no configured origin: on workers.dev,
// on a custom domain or under `wrangler dev` it is whatever host the visitor
// asked for.
export function requestOrigin(headers: {
  get(name: string): string | null;
}): URL | undefined {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return undefined;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = headers.get("x-forwarded-proto") ?? (local ? "http" : "https");
  try {
    return new URL(`${proto}://${host}`);
  } catch {
    return undefined;
  }
}
