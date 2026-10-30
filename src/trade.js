(() => {
  "use strict";

  const { el, warnOnce, query, gameClass: g, spriteUrl, activeDog, onResponse, refetch, watchStored, quantitySelector } = DogNerd;

  const ROUTE = /^\/doghouse\/?$/;
  const TRADE_KEY = "upForTrade";
  // {itemId: qty} in the page's localStorage, which page-hook.js subtracts from the game's doghouse counts.
  const MIRROR_KEY = "dognerd:upForTrade";
  const SECTION = "dognerd-trade-section";
  const TRADE_BUTTON = "dognerd-trade-button";
  const DIALOG = "dognerd-trade-dialog";

  // {itemId: {name, image, qty}}
  let trade = {};
  // Unfiltered doghouse.getState, the game itself only sees counts minus what's up for trade.
  let house = null;
  let bulk = false;
  let selected = new Set();

  const realItem = (id) => house?.inventory.find((i) => i.id === id) ?? null;
  const itemNamed = (name) => house?.inventory.find((i) => i.name === name) ?? null;
  const tradedQty = (item) => Math.min(trade[item.id]?.qty ?? 0, item.count);

  function mirror() {
    const text = JSON.stringify(Object.fromEntries(Object.entries(trade).map(([id, t]) => [id, t.qty])));
    try {
      if (localStorage.getItem(MIRROR_KEY) === text) return;
      localStorage.setItem(MIRROR_KEY, text);
    } catch (e) {
      warnOnce("trade-mirror", "couldn't hide the trade items from the doghouse:", e.message);
      return;
    }
    refetch("doghouse");
  }

  function applyTrade(fresh) {
    trade = fresh ?? {};
    mirror();
    schedule();
  }

  watchStored(TRADE_KEY, applyTrade);

  // changes: [[item, qty]] with the item's unfiltered count, a qty of 0 takes the item off trade.
  function setTrade(changes) {
    const next = { ...trade };
    for (const [item, qty] of changes) {
      const kept = Math.min(item.count, qty);
      if (kept > 0) next[item.id] = { name: item.name, image: item.image, qty: kept };
      else delete next[item.id];
    }
    applyTrade(next);
    browser.storage.local.set({ [TRADE_KEY]: next }).catch((e) => warnOnce("trade-save", "couldn't save the trade list:", e.message));
  }

  onResponse("doghouse", (procedure, data) => {
    if (procedure !== "doghouse.getState" || !data?.inventory) return;
    house = data;
    schedule();
  });

  const cancelIn = (node) => [...node.querySelectorAll("button")].find((b) => b.textContent === "Cancel");

  function showDialogButton() {
    const dialog = document.querySelector(`[role="dialog"]:not(.${DIALOG})`);
    // Clothes put "Put on <dog>" buttons in the first row, so this goes in Donate's row.
    const row = dialog?.querySelector('[class*="ButtonGroup_rowContainer__"]:has(> [class*="Button_danger__"])');
    if (!row || row.querySelector(`:scope > .${TRADE_BUTTON}`)) return;
    const model = row.querySelector(':scope > [class*="Button_neutral__"]') ?? row.querySelector(":scope > button");
    const button = el("button", { type: "button", className: `${model.className} ${TRADE_BUTTON}`, textContent: "Put Up for Trade" });
    button.onclick = () => {
      const item = itemNamed(dialog.querySelector('[class*="doghouse_itemTitle__"]')?.textContent);
      if (!item) return;
      const input = dialog.querySelector('[class*="QuantitySelector_input__"]');
      const qty = Math.max(1, parseInt(input?.value, 10) || 1);
      // The game's quantity only counts what isn't up for trade yet.
      setTrade([[item, tradedQty(item) + qty]]);
      cancelIn(dialog)?.click();
    };
    row.append(button);
  }

  function openDialog(item) {
    const qty = tradedQty(item);
    const close = () => {
      overlay.remove();
      removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    const amount = qty > 1 ? quantitySelector(qty) : null;
    const button = (text, onclick) =>
      el("button", { type: "button", className: `${g("Button_button")} ${g("Button_neutral")} ${g("ButtonGroup_buttonContainer")}`, textContent: text, onclick });
    const row = (buttons) => el("div", { className: `${g("ButtonGroup_rowContainer")} ${g("ButtonGroup_row")}` }, buttons);
    const remove = button("Remove from Trade", () => {
      setTrade([[item, qty - (amount?.value() ?? qty)]]);
      close();
    });
    const content = el("div", { className: `${g("Dialog_content")} ${g("Dialog_contentWide")} ${DIALOG}`, role: "dialog", tabIndex: -1 }, [
      el("div", { className: g("Dialog_modalBody") }, [
        el("div", { className: `${g("Dialog_body")} ${g("Dialog_bodyWide")}` }, [
          el("div", { className: g("doghouse_itemDialogBody") }, [
            el("img", { className: g("doghouse_itemPreviewImage"), src: spriteUrl(`/${item.image}`), alt: "" }),
            el("h2", { className: g("doghouse_itemTitle"), textContent: item.name }),
            ...(amount ? [amount.node] : []),
            el("div", { className: g("ButtonGroup_groupContainer") }, [row([remove]), row([button("Cancel", close)])]),
          ]),
        ]),
      ]),
    ]);
    const overlay = el("div", { className: g("Dialog_overlay") }, [content]);
    overlay.dataset.state = content.dataset.state = "open";
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
    addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    content.focus();
  }

  function card(item) {
    const qty = tradedQty(item);
    const node = el("button", { type: "button", className: g("ItemCard_card") }, [
      el("div", { className: g("ItemCard_iconWrap") }, [
        el("img", { className: g("ItemCard_icon"), src: spriteUrl(`/${item.image}`), alt: item.name }),
        ...(qty > 1 ? [el("span", { className: g("ItemCard_badge"), textContent: `x${qty}` })] : []),
      ]),
      el("p", { className: g("ItemCard_name"), textContent: item.name }),
    ]);
    node.dataset.itemId = item.id;
    node.onclick = () => {
      if (!bulk) return openDialog(item);
      if (!selected.delete(item.id)) selected.add(item.id);
      schedule();
    };
    return node;
  }

  const tradedItems = () =>
    (house?.inventory ?? []).filter((i) => tradedQty(i) > 0).sort((a, b) => a.name.localeCompare(b.name));

  async function copyAsText(button) {
    const lines = tradedItems().map((i) => `~ ${i.name}${tradedQty(i) > 1 ? ` x${tradedQty(i)}` : ""}`);
    const text = ["♡ items up for sale ♡", ...lines].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied!";
    } catch (e) {
      warnOnce("trade-copy", "couldn't copy the trade list:", e.message);
      button.textContent = "Couldn't Copy";
    }
    setTimeout(() => (button.textContent = "Copy as Text"), 1500);
  }

  async function copyAsImage(button) {
    const items = tradedItems().map((i) => ({ name: i.name, image: i.image, qty: tradedQty(i) }));
    button.disabled = true;
    try {
      // Passing the pending blob keeps the click's permission to write the clipboard while it draws.
      const png = DogNerdTradeImage.render(items, activeDog(house?.dogs)?.name);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      button.textContent = "Copied!";
    } catch (e) {
      warnOnce("trade-image", "couldn't copy the trade image:", e.message);
      button.textContent = "Couldn't Copy";
    }
    button.disabled = false;
    setTimeout(() => (button.textContent = "Copy as Image"), 1500);
  }

  function showSection() {
    const content = document.querySelector('[class*="Layout_content__"]');
    if (!content) return;
    const items = tradedItems();
    let section = content.querySelector(`:scope > .${SECTION}`);
    if (!items.length) {
      section?.remove();
      bulk = false;
      selected.clear();
      return;
    }
    if (!section) {
      section = el("div", { className: SECTION }, [
        el("div", { className: g("doghouse_bulkActionsBar") }),
        el("div", { className: `${g("ItemGrid_grid")} ${g("ItemGrid_medium")}` }),
      ]);
    }
    if (content.lastElementChild !== section) content.append(section);
    showSectionBar(section.firstElementChild, items);
    const grid = section.lastElementChild;
    const sig = JSON.stringify(items.map((i) => [i.id, i.name, i.image, tradedQty(i)]));
    if (grid.dataset.sig !== sig) {
      grid.dataset.sig = sig;
      grid.replaceChildren(...items.map(card));
    }
    for (const node of grid.children) node.classList.toggle(g("ItemCard_selected"), selected.has(node.dataset.itemId));
  }

  function showSectionBar(bar, items) {
    const ids = new Set(items.map((i) => i.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    const sig = JSON.stringify([bulk, selected.size > 0]);
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    const button = (variant, text, onclick) =>
      el("button", { type: "button", className: `${g("Button_button")} ${g(variant)}`, textContent: text, onclick });
    const leave = () => {
      bulk = false;
      selected.clear();
      schedule();
    };
    if (!bulk) {
      const copy = button("Button_neutral", "Copy as Text", () => copyAsText(copy));
      const copyImage = button("Button_neutral", "Copy as Image", () => copyAsImage(copyImage));
      bar.replaceChildren(
        button("Button_neutral", "Bulk Actions", () => {
          bulk = true;
          schedule();
        }),
        copy,
        copyImage,
      );
      return;
    }
    const remove = button("Button_primary", "Remove from Trade", () => {
      setTrade([...selected].map(realItem).filter(Boolean).map((i) => [i, 0]));
      leave();
    });
    remove.disabled = !selected.size;
    bar.replaceChildren(el("div", { className: g("doghouse_bulkActionsContainer") }, [remove, button("Button_neutral", "Cancel", leave)]));
  }

  const gameSelection = () =>
    [...document.querySelectorAll(`[class*="ItemCard_selected__"]:not(.${SECTION} *)`)]
      .map((node) => itemNamed(node.querySelector('[class*="ItemCard_name__"]')?.textContent))
      .filter(Boolean);

  function showBulkButton() {
    const box = document.querySelector(`[class*="doghouse_bulkActionsContainer__"]:not(.${SECTION} *)`);
    const donate = box?.querySelector(':scope > [class*="Button_danger__"]');
    if (!donate) return;
    let button = box.querySelector(`:scope > .${TRADE_BUTTON}`);
    if (!button) {
      button = el("button", { type: "button", className: `${box.firstElementChild.className} ${TRADE_BUTTON}`, textContent: "Put Up for Trade" });
      button.onclick = () => {
        setTrade(gameSelection().map((i) => [i, i.count]));
        cancelIn(box)?.click();
      };
    }
    if (donate.previousElementSibling !== button) donate.before(button);
    button.disabled = !gameSelection().length;
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
        // The game keeps its layout across client-side navigation.
        document.querySelector(`.${SECTION}`)?.remove();
        document.querySelector(`.${DIALOG}`)?.parentElement.remove();
        bulk = false;
        selected.clear();
        return;
      }
      if (!loaded) {
        loaded = true;
        query("doghouse.getState")
          .then((data) => {
            house = data;
            schedule();
          })
          .catch((e) => warnOnce("trade-load", "couldn't load the doghouse:", e.message));
      }
      showSection();
      showDialogButton();
      showBulkButton();
    });
  }

  // Selecting a card in bulk mode only changes its class.
  document.addEventListener("click", schedule, true);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
