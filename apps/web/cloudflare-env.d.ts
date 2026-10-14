// The bindings the app reads through getCloudflareContext(). `wrangler types`
// would generate this from wrangler.jsonc; the one binding the code touches
// is kept by hand so the build needs no rendered config.
declare global {
  interface CloudflareEnv {
    ASSETS: {
      fetch(
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response>;
    };
  }
}

export {};
