// Runs in the page's world and forwards tower API responses to tower.js as "dognerd:tower" events.
(() => {
  "use strict";

  const pageFetch = window.fetch;
  window.fetch = function (...args) {
    const response = pageFetch.apply(this, args);
    try {
      const [input] = args;
      const url = new URL(typeof input === "string" ? input : String(input?.url ?? ""), location.origin);
      const procedures = url.pathname.match(/^\/api\/trpc\/(.+)$/)?.[1].split(",") ?? [];
      if (procedures.some((p) => p.startsWith("tower."))) {
        response
          .then((res) => res.clone().text())
          .then((text) => {
            const detail = JSON.stringify({ procedures, text });
            document.dispatchEvent(new CustomEvent("dognerd:tower", { detail }));
          })
          .catch(() => {});
      }
    } catch {}
    return response;
  };
})();
