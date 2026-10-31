(() => {
  "use strict";

  const LOADING = "dognerd-inventory-loading";
  if (!/^\/doghouse\/storage\/?$/.test(location.pathname)) return;
  document.documentElement.classList.add(LOADING);
  browser.storage.local
    .get("settings")
    .then((r) => {
      if (r.settings?.inventory === false) document.documentElement.classList.remove(LOADING);
    })
    .catch(() => document.documentElement.classList.remove(LOADING));
  setTimeout(() => document.documentElement.classList.remove(LOADING), 15000);
})();
