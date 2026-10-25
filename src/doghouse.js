(() => {
  "use strict";

  const { el, warnOnce, query, mutate, activeDog, onResponse, refetch, watchStored } = DogNerd;

  const ROUTE = /^\/doghouse\/?$/;
  const BAR = '[class*="doghouse_bulkActionsBar__"]:not(.dognerd-trade-section *)';
  const BUTTON = "dognerd-doghouse-button";
  const TRADE_KEY = "upForTrade";
  const COMBAT_SLOTS = 4;

  let house = null;
  let trinketSlots = 3;
  let moving = false;
  let trade = {};

  onResponse("doghouse", (procedure, data) => {
    if (procedure !== "doghouse.getState" || !data?.inventory) return;
    house = data;
    schedule();
  });

  // "<span>Type:</span> trinket" in the item description.
  const combatType = (item) => item.description?.match(/Type:<\/span>\s*(\w+)/)?.[1] ?? null;

  function keep(item, dog) {
    const categories = item.categories ?? [];
    if (item.bait || categories.includes("seed")) return item.count;
    if ((item.food || item.book) && !item.consumedByDog?.[dog]) return item.count;
    if (categories.includes("combat")) return combatType(item) === "trinket" ? trinketSlots : COMBAT_SLOTS;
    return 0;
  }

  function plans() {
    const inventory = (house?.inventory ?? [])
      .map((i) => ({ ...i, count: i.count - (trade[i.id]?.qty ?? 0) }))
      .filter((i) => i.count > 0);
    const dog = activeDog(house?.dogs)?.uuid;
    const move = (i, qty) => ({ itemId: i.id, qty });
    const clothes = inventory.filter((i) => i.isCosmetic).map((i) => move(i, i.count));
    const extras = inventory
      .filter((i) => !i.isCosmetic && i.count > keep(i, dog))
      .map((i) => move(i, i.count - keep(i, dog)));
    return {
      clothes: { closet: clothes },
      smart: { closet: clothes, storage: extras },
    };
  }

  async function moveAll(plan) {
    if (moving) return;
    moving = true;
    schedule();
    try {
      for (const [to, items] of Object.entries(plan)) {
        if (items.length) await mutate("doghouse.moveItems", { items, to });
      }
      if (!refetch("doghouse")) location.reload();
    } catch (e) {
      warnOnce("doghouse-move", "couldn't move the items:", e.message);
    } finally {
      moving = false;
      schedule();
    }
  }

  const BUTTONS = [
    { key: "clothes", label: "Put All Clothes in Closet" },
    { key: "smart", label: "Smart Store" },
  ];

  function showButtons() {
    const bar = document.querySelector(BAR);
    const bulk = bar?.querySelector(`:scope > button:not(.${BUTTON})`);
    if (!bulk) {
      bar?.querySelectorAll(`:scope > .${BUTTON}`).forEach((b) => b.remove());
      return;
    }
    const all = plans();
    let after = bulk;
    for (const { key, label } of BUTTONS) {
      let button = bar.querySelector(`:scope > .${BUTTON}[data-key="${key}"]`);
      if (!button) {
        button = el("button", { type: "button", className: `${bulk.className} ${BUTTON}`, textContent: label });
        button.dataset.key = key;
        button.onclick = () => moveAll(plans()[key]);
      }
      if (after.nextElementSibling !== button) after.after(button);
      after = button;
      button.disabled = moving || Object.values(all[key]).every((items) => !items.length);
    }
  }

  watchStored(TRADE_KEY, (stored) => {
    trade = stored ?? {};
    schedule();
  });

  async function load() {
    try {
      const [state, options] = await Promise.all([
        query("doghouse.getState"),
        query("tower.getOptions").catch(() => null),
      ]);
      house = state;
      if (options?.trinketSlotCount) trinketSlots = options.trinketSlotCount;
      schedule();
    } catch (e) {
      warnOnce("doghouse-load", "couldn't load the doghouse:", e.message);
    }
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
        load();
      }
      showButtons();
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
