(() => {
  "use strict";

  const { el, warnOnce, query, mutate, onResponse, refetch } = DogNerd;

  const ROUTE = /^\/doghouse\/storage\/?$/;
  const BAR = '[class*="storage_actionsBar__"]';
  const BUTTON = "dognerd-storage-button";

  let items = null;
  let moving = false;

  onResponse("storage", (procedure, data) => {
    if (procedure !== "storage.getItems" || !Array.isArray(data)) return;
    items = data;
    schedule();
  });

  async function removeAll() {
    if (moving || !items?.length) return;
    moving = true;
    schedule();
    try {
      await mutate("storage.returnToInventory", { items: items.map((i) => ({ itemId: i.id, qty: i.count })) });
      if (!refetch("storage")) location.reload();
    } catch (e) {
      warnOnce("storage-remove", "couldn't remove the items from storage:", e.message);
    } finally {
      moving = false;
      schedule();
    }
  }

  function showButton() {
    const bar = document.querySelector(BAR);
    const remove = bar?.querySelector(`:scope > button:not(.${BUTTON})`);
    let button = bar?.querySelector(`:scope > .${BUTTON}`);
    if (!remove) {
      button?.remove();
      return;
    }
    if (!button) {
      button = el("button", {
        type: "button",
        className: `${remove.className} ${BUTTON}`,
        textContent: "Remove All",
        onclick: removeAll,
      });
    }
    if (remove.nextElementSibling !== button) remove.after(button);
    button.disabled = moving || !items?.length;
  }

  let scheduled = false;
  let loaded = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!ROUTE.test(location.pathname)) {
        loaded = false;
        return;
      }
      if (!loaded) {
        loaded = true;
        query("storage.getItems")
          .then((data) => {
            items = data;
            schedule();
          })
          .catch((e) => warnOnce("storage-load", "couldn't load the storage:", e.message));
      }
      showButton();
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
