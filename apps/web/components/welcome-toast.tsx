"use client";

import { SITE_NAME, SOURCE_URL } from "app/site";
import { useEffect } from "react";
import { toast } from "sonner";

export function WelcomeToast({ demo }: { demo: boolean }) {
  useEffect(() => {
    // ignore if screen height is too small
    if (window.innerHeight < 650) return;
    if (!document.cookie.includes("welcome-toast=2")) {
      toast(`🛍️ Welcome to ${SITE_NAME}!`, {
        id: "welcome-toast",
        duration: Infinity,
        onDismiss: () => {
          document.cookie = "welcome-toast=2; max-age=31536000; path=/";
        },
        description: (
          <>
            A high-performance, server-rendered storefront on Cloudflare
            Workers
            {demo
              ? ", showing its demo catalogue until a store is connected"
              : ""}
            .{" "}
            <a
              href={SOURCE_URL}
              className="text-blue-600 hover:underline"
              target="_blank"
            >
              View the source
            </a>
            .
          </>
        ),
      });
    }
  }, [demo]);

  return null;
}
