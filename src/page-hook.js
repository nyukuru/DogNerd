// Runs in the page's world. Forwards API responses as "dognerd:<router>" events, refetches a router's queries
// on "dognerd:refetch" (cancelling the event when it did) and hides what's up for trade from the doghouse.
(() => {
  "use strict";

  // {itemId: qty}, mirrored from extension storage by trade.js.
  const TRADE_KEY = "dognerd:upForTrade";

  function traded() {
    try {
      return JSON.parse(localStorage.getItem(TRADE_KEY) ?? "{}") ?? {};
    } catch {
      return {};
    }
  }

  async function hideTraded(res, procedures) {
    try {
      const counts = traded();
      if (!Object.keys(counts).length || !res.ok) return res;
      const results = JSON.parse(await res.clone().text());
      procedures.forEach((procedure, i) => {
        const data = results?.[i]?.result?.data?.json;
        if (procedure !== "doghouse.getState" || !Array.isArray(data?.inventory)) return;
        data.inventory = data.inventory
          .map((item) => ({ ...item, count: item.count - (counts[item.id] ?? 0) }))
          .filter((item) => item.count > 0);
      });
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify(results), { status: res.status, statusText: res.statusText, headers });
    } catch {
      return res;
    }
  }

  const pageFetch = window.fetch;
  window.fetch = function (...args) {
    let response = pageFetch.apply(this, args);
    try {
      const [input, init] = args;
      const url = new URL(typeof input === "string" ? input : String(input?.url ?? ""), location.origin);
      const procedures = url.pathname.match(/^\/api\/trpc\/(.+)$/)?.[1].split(",") ?? [];
      const routers = ["tower", "doghouse", "storage", "dressup"].filter((r) => procedures.some((p) => p.startsWith(`${r}.`)));
      if (routers.length) {
        response
          .then((res) => res.clone().text())
          .then((text) => {
            const body = typeof init?.body === "string" ? init.body : null;
            const detail = JSON.stringify({ procedures, body, text });
            routers.forEach((r) => document.dispatchEvent(new CustomEvent(`dognerd:${r}`, { detail })));
          })
          .catch(() => {});
      }
      if (procedures.includes("doghouse.getState")) response = response.then((res) => hideTraded(res, procedures));
    } catch {}
    return response;
  };

  function queryClient() {
    const start = document.querySelector("main");
    const key = start && Object.keys(start).find((k) => k.startsWith("__reactFiber$"));
    for (let fiber = start?.[key]; fiber; fiber = fiber.return) {
      const client = fiber.memoizedProps?.value ?? fiber.memoizedProps?.client;
      if (client?.invalidateQueries) return client;
    }
    return null;
  }

  document.addEventListener("dognerd:refetch", (e) => {
    try {
      const client = queryClient();
      if (!client) return;
      // tRPC query keys look like [["doghouse", "getState"], {type: "query"}].
      client.invalidateQueries({ queryKey: [[String(e.detail)]] });
      e.preventDefault();
    } catch {}
  });
})();
