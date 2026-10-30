(() => {
  "use strict";

  // Runs before the page paints so the game's storage list never shows before the inventory replaces it.
  const LOADING = "dognerd-inventory-loading";
  if (!/^\/doghouse\/storage\/?$/.test(location.pathname)) return;
  document.documentElement.classList.add(LOADING);
  browser.storage.local
    .get("inventoryOverhaul")
    .then((r) => {
      if (r.inventoryOverhaul === false) document.documentElement.classList.remove(LOADING);
    })
    .catch(() => document.documentElement.classList.remove(LOADING));
  // In case inventory.js never takes over.
  setTimeout(() => document.documentElement.classList.remove(LOADING), 15000);
})();
