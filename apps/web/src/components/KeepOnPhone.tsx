"use client";

import { useEffect } from "react";

/**
 * Registers the worker in public/sw.js, which keeps the screens on the phone so that a reload in a
 * dead spot still opens the app. It registers after the page has loaded, so it never competes with
 * the first paint, and a browser without service workers simply carries on without one.
 */
export function KeepOnPhone() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* private window, or the browser refuses: the app still works online */
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
