(() => {
  "use strict";

  const { el, icon, norm, warnOnce, query, mutate, loadStyles, spriteUrl, gameClass: g, onResponse, watchStored, watchSetting, watchTrade, dialog, confirmDialog, activeDog } = DogNerd;

  const ROUTE = /^\/doghouse\/storage\/?$/;
  const AREAS_KEY = "inventoryAreas";
  const TRADE_KEY = "upForTrade";
  const ACTIVE = "dognerd-inventory-active";
  const SECTION = "dognerd-inventory";
  const TRAY = "dognerd-inventory-tray";
  const COPY = "dognerd-inventory-copy";
  const DIALOG = "dognerd-inventory-dialog";
  // Set by inventory-early.js.
  const LOADING = "dognerd-inventory-loading";
  const TITLE = "Inventory";
  const KNOB = browser.runtime.getURL("img/slider-knob.svg");
  // Breed changers from the wiki's Dog page, the game only flags the dice.
  const TRANSFORMATIONS = new Set(
    [
      "Calico Pill", "Cactus Pill", "Cursed Rodin Plushie", "Cyber Pill", "Enchanted Snowflake", "Freaky Pill", "Lucky Coin",
      "Magic Apple", "Magical Candy Corn", "Magical Doggy Plushie", "Multi-dimensional Dice", "Primordial Peeper",
      "Purple Pill", "Rainbow Pill", "Sinister Pill", "Stinkie",
    ].map(norm),
  );
  const TRANSFORMS = new Set(["randomize-dog", "transform-dog"]);
  const TRANSFORMATION = { value: "transformation", label: "Transformations" };
  const TYPE_SORT = { value: "type", label: "Type" };
  const AREAS = [
    { key: "doghouse", label: "Doghouse", move: "Put in doghouse" },
    { key: "storage", label: "Storage", move: "Put in storage" },
    { key: "closet", label: "Closet", move: "Put in closet" },
    { key: "trade", label: "Up for Trade", move: "Put Up for Trade" },
  ];

  let enabled = true;
  let tradeOn = true;
  let areas = AREAS;
  let styled = false;
  let styling = null;
  let shown = new Set(AREAS.map((a) => a.key));
  // {doghouse, storage, closet} as the game returns them, doghouse counts include what's up for trade.
  let lists = null;
  let cache = null;
  let trade = {};
  let dogs = [];
  let visible = [];
  let moving = false;
  // [done, total] requests of the move in progress.
  let progress = null;
  let gaveUp = false;
  let loads = 0;
  const addedOptions = [];
  // itemId -> {area: qty}
  const selected = new Map();

  watchSetting("inventory", (on) => {
    enabled = on;
    schedule();
  });

  watchSetting("trade", (on) => {
    tradeOn = on;
    areas = on ? AREAS : AREAS.filter(({ key }) => key !== "trade");
    schedule();
  });

  watchStored(AREAS_KEY, (stored) => {
    if (Array.isArray(stored)) shown = new Set(stored);
    schedule();
  });

  watchTrade((fresh) => {
    trade = fresh;
    cache = null;
    schedule();
  });

  async function load() {
    const seq = ++loads;
    try {
      const [house, storage, dressup] = await Promise.all([
        query("doghouse.getState"),
        query("storage.getItems"),
        query("dressup.getState", {}),
      ]);
      if (seq !== loads) return;
      lists = { doghouse: house.inventory, storage, closet: dressup.cosmetics };
      dogs = house.dogs;
      cache = null;
      document.dispatchEvent(new CustomEvent("dognerd:inventory", { detail: lists }));
      schedule();
    } catch (e) {
      warnOnce("inventory-load", "couldn't load the inventory:", e.message);
      if (!lists) giveUp();
    }
  }

  let reload = null;
  for (const router of ["doghouse", "storage", "dressup"]) {
    onResponse(router, () => {
      // A move reloads once it's done, its own requests would show half-finished counts.
      if (!lists || moving || !ROUTE.test(location.pathname)) return;
      clearTimeout(reload);
      reload = setTimeout(load, 300);
    });
  }

  const hasCardRules = (sheet) => {
    try {
      return [...sheet.cssRules].some((rule) => rule.selectorText?.includes("ItemCard_card__"));
    } catch {
      return false;
    }
  };

  // Storage's own styles don't have the item cards, and Next turns off a previous page's with media="x".
  function ensureStyles() {
    const source = [...document.querySelectorAll('style, link[rel="stylesheet"]')].find((n) => n.sheet && hasCardRules(n.sheet));
    if (source) {
      document.head.append(
        source.tagName === "STYLE" ? el("style", { textContent: source.textContent }) : el("link", { rel: "stylesheet", href: source.href }),
      );
      return (styled = true);
    }
    styling ??= loadStyles("/doghouse")
      .catch((e) => warnOnce("inventory-styles", "couldn't load the item card styles:", e.message))
      .finally(() => {
        styled = true;
        schedule();
      });
    return false;
  }

  const merged = () => (cache ??= build());

  function build() {
    const byId = new Map();
    for (const where of ["doghouse", "storage", "closet"]) {
      for (const i of lists[where]) {
        let item = byId.get(i.id);
        if (!item) {
          item = { id: i.id, name: i.name, image: i.image, price: 0, categories: ["cosmetic"], petpet: false };
          for (const { key } of AREAS) item[key] = 0;
          byId.set(i.id, item);
        }
        item[where] += i.count;
        // Closet items come without a price or categories.
        if (i.categories) {
          Object.assign(item, { price: i.price ?? 0, categories: i.categories, petpet: !!i.petpet });
          Object.assign(item, { food: i.food, book: i.book, useable: i.useable?.action, navigate: i.navigate, consumedByDog: i.consumedByDog ?? {} });
        }
        if (TRANSFORMS.has(i.useable?.action) || TRANSFORMATIONS.has(norm(i.name))) item.transformation = true;
      }
    }
    for (const item of byId.values()) if (item.transformation) item.categories = [...item.categories, TRANSFORMATION.value];
    for (const item of byId.values()) {
      item.trade = Math.min(trade[item.id]?.qty ?? 0, item.doghouse);
      item.doghouse -= item.trade;
    }
    return [...byId.values()];
  }

  const total = (item) => areas.reduce((sum, { key }) => sum + (shown.has(key) ? item[key] : 0), 0);

  const SORTS = {
    "name-asc": (a, b) => a.name.localeCompare(b.name),
    "name-desc": (a, b) => b.name.localeCompare(a.name),
    "quantity-desc": (a, b) => total(b) - total(a),
    "quantity-asc": (a, b) => total(a) - total(b),
    "price-desc": (a, b) => b.price - a.price,
    "price-asc": (a, b) => a.price - b.price,
  };

  function options(bar) {
    const [type, sort] = bar.querySelectorAll("select");
    return {
      search: bar.querySelector("input")?.value.trim().toLowerCase() ?? "",
      type: type?.value ?? "all",
      types: [...(type?.options ?? [])].filter((o) => o.value !== "all").map((o) => [o.value, o.textContent]),
      sort: SORTS[sort?.value] ?? SORTS["name-asc"],
      byType: sort?.value === TYPE_SORT.value,
    };
  }

  function group(item, types) {
    const values = types.map(([value]) => value);
    const ranks = [...item.categories, ...(item.petpet ? ["petpet"] : [])].map((t) => values.indexOf(t)).filter((r) => r >= 0);
    return ranks.length ? Math.min(...ranks) : types.length;
  }

  function visibleItems(bar) {
    const { search, type, types, sort, byType } = options(bar);
    return merged()
      .map((i) => Object.assign(i, { group: group(i, types) }))
      .filter((i) => total(i) > 0)
      .filter((i) => !search || i.name.toLowerCase().includes(search))
      .filter((i) => type === "all" || i.categories.includes(type) || (type === "petpet" && i.petpet))
      .sort((a, b) => (byType ? a.group - b.group : 0) || sort(a, b) || a.name.localeCompare(b.name));
  }

  const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
  const chosen = (id) => sum(selected.get(id) ?? {});

  // Cards are kept between redraws so items.js's badges on them don't blink out while it re-adds them.
  const cards = new Map();

  function card(item) {
    let node = cards.get(item.id);
    if (!node) {
      node = el("button", { type: "button", className: g("ItemCard_card") }, [
        el("div", { className: g("ItemCard_iconWrap") }, [
          el("img", { className: g("ItemCard_icon"), src: spriteUrl(`/${item.image}`), alt: item.name }),
        ]),
        el("p", { className: g("ItemCard_name"), textContent: item.name }),
      ]);
      node.dataset.itemId = item.id;
      node.onclick = () => {
        if (!selected.delete(item.id)) return openDialog(item.id);
        schedule();
      };
      cards.set(item.id, node);
    }
    const count = total(item);
    const picked = chosen(item.id);
    const sig = JSON.stringify([count, picked]);
    if (node.dataset.sig !== sig) {
      node.dataset.sig = sig;
      const wrap = node.firstChild;
      wrap.querySelectorAll(':scope > [class*="ItemCard_badge__"], :scope > .dognerd-picked').forEach((n) => n.remove());
      wrap.append(
        ...(count > 1 ? [el("span", { className: g("ItemCard_badge"), textContent: `x${count}` })] : []),
        ...(picked ? [el("span", { className: "dognerd-item-badge dognerd-picked", textContent: `${picked} selected` })] : []),
      );
    }
    node.classList.toggle(g("ItemCard_selected"), selected.has(item.id));
    return node;
  }

  const fits = (item, to) => to !== "closet" || item.categories.includes("cosmetic");

  function sources(item, to) {
    if (!fits(item, to)) return {};
    const from = {};
    for (const [area, qty] of Object.entries(selected.get(item.id) ?? {})) {
      const n = Math.min(qty, item[area]);
      if (area !== to && shown.has(area) && n > 0) from[area] = n;
    }
    return from;
  }

  async function saveTrade(plan, to) {
    if (!tradeOn) return;
    const next = { ...trade };
    for (const { item, from } of plan) {
      if (to !== "trade" && !from.trade) continue;
      const qty = to === "trade" ? item.trade + sum(from) : item.trade - from.trade;
      if (qty > 0) next[item.id] = { name: item.name, image: item.image, qty };
      else delete next[item.id];
    }
    return browser.storage.local.set({ [TRADE_KEY]: next });
  }

  // plan: [{item, from: {area: qty}}], everything passes through the doghouse.
  function applyPlan(plan, to) {
    const adjust = (where, item, delta) => {
      const list = lists[where];
      const found = list.find((i) => i.id === item.id);
      if (found) found.count += delta;
      else list.push({ ...Object.values(lists).flat().find((i) => i.id === item.id), count: delta });
      lists[where] = list.filter((i) => i.count > 0);
      cache = null;
    };
    for (const { item, from } of plan) {
      let moved = 0;
      for (const [where, qty] of Object.entries(from)) {
        moved += qty;
        if (where === "storage" || where === "closet") {
          adjust(where, item, -qty);
          adjust("doghouse", item, qty);
        }
      }
      if (to === "storage" || to === "closet") {
        adjust("doghouse", item, -moved);
        adjust(to, item, moved);
      }
    }
    document.dispatchEvent(new CustomEvent("dognerd:inventory", { detail: lists }));
  }

  async function move(plan, to) {
    if (moving || !plan.length) return;
    moving = true;
    const stored = plan.filter(({ from }) => from.storage).map(({ item, from }) => ({ itemId: item.id, qty: from.storage }));
    const closet = plan.reduce((sum, { from }) => sum + (from.closet ?? 0), 0);
    const toArea = to === "storage" || to === "closet";
    progress = [0, (stored.length ? 1 : 0) + closet + (toArea ? 1 : 0)];
    const step = async (procedure, input) => {
      await mutate(procedure, input);
      progress[0]++;
      schedule();
    };
    try {
      applyPlan(plan, to);
      schedule();
      if (stored.length) await step("storage.returnToInventory", { items: stored });
      // The game's closet takes out one copy per call.
      for (const { item, from } of plan) {
        for (let n = 0; n < (from.closet ?? 0); n++) await step("dressup.removeFromCloset", { itemId: item.id });
      }
      if (toArea) {
        const items = plan.map(({ item, from }) => ({ itemId: item.id, qty: sum(from) }));
        await step("doghouse.moveItems", { items, to });
      }
      await saveTrade(plan, to);
    } catch (e) {
      warnOnce("inventory-move", "couldn't move the items:", e.message);
    } finally {
      moving = false;
      progress = null;
      selected.clear();
      schedule();
      load();
    }
  }

  const picked = () => merged().filter((i) => selected.has(i.id));

  function moveSelected(to) {
    const plan = picked()
      .map((item) => ({ item, from: sources(item, to) }))
      .filter(({ from }) => Object.keys(from).length);
    return move(plan, to);
  }

  function verbFor(item) {
    if (fits(item, "closet")) return "Put on";
    if (item.food) return "Feed to";
    if (item.book) return "Read to";
    if (item.useable) return "Use on";
    if (item.petpet) return "Give to";
    return null;
  }

  async function takeOut(item) {
    if (item.doghouse) return;
    if (item.storage) await mutate("storage.returnToInventory", { items: [{ itemId: item.id, qty: 1 }] });
    else await mutate("dressup.removeFromCloset", { itemId: item.id });
  }

  // The game's pages for these items look for one in the doghouse.
  async function useAt(item) {
    try {
      await takeOut(item);
      location.assign(item.navigate);
    } catch (e) {
      warnOnce("inventory-use", "couldn't use the item:", e.message);
      await load();
    }
  }

  async function useOn(item, dog) {
    const ok =
      !item.transformation ||
      (await confirmDialog({
        title: "Transform your dog?",
        text: `${dog.name} will transform into a different breed, this can't be undone.`,
        confirm: "Transform",
      }));
    if (!ok) return;
    try {
      await takeOut(item);
      if (item.useable === "rename-dog") {
        location.assign(`/rename-dog/${dog.index}`);
        return;
      }
      await mutate(fits(item, "closet") ? "doghouse.wearCosmetic" : "doghouse.giveItem", { dogIndex: dog.index, itemId: item.id });
    } catch (e) {
      warnOnce("inventory-use", "couldn't use the item:", e.message);
    }
    await load();
  }

  const button = (variant, text, onclick) =>
    el("button", { type: "button", className: `${g("Button_button")} ${g(variant)}`, textContent: text, onclick });

  const grouped = (variant, text, onclick) => {
    const node = button(variant, text, onclick);
    node.classList.add(g("ButtonGroup_buttonContainer"));
    return node;
  };
  const row = (buttons) => el("div", { className: `${g("ButtonGroup_rowContainer")} ${g("ButtonGroup_row")}` }, buttons);

  function amountRow(key, label, max, value, onChange) {
    const range = el("input", { type: "range", min: 0, max, value, ariaLabel: label });
    // Content script CSS can't point at extension files the same way in Chrome and Firefox.
    range.style.setProperty("--dognerd-knob", `url("${KNOB}")`);
    const number = el("input", { className: g("QuantitySelector_input"), type: "text", inputMode: "numeric", value, ariaLabel: label });
    const set = (n) => {
      const v = Math.min(max, Math.max(0, n || 0));
      range.value = number.value = String(v);
      // Chrome has no progress part to style, its track draws the fill from this.
      range.style.setProperty("--dognerd-fill", `${(v / max) * 100}%`);
      onChange(v);
    };
    range.oninput = () => set(parseInt(range.value, 10));
    number.onchange = () => set(parseInt(number.value, 10));
    range.style.setProperty("--dognerd-fill", `${(value / max) * 100}%`);
    const node = el("div", { className: "dognerd-inventory-amount" }, [
      el("span", {}, [icon(key), `${label} (${max})`]),
      range,
      number,
    ]);
    return { node, value: () => parseInt(range.value, 10) };
  }

  function openDialog(id) {
    let busy = false;
    const draft = {};
    const body = el("div", { className: g("doghouse_itemDialogBody") });
    const render = () => {
      const item = merged().find((i) => i.id === id);
      const held = areas.filter(({ key }) => shown.has(key) && item?.[key] > 0);
      if (!held.length) return close();
      const was = selected.get(id);
      const start = (key) => Math.min(item[key], draft[key] ?? (was ? (was[key] ?? 0) : item[key]));
      const amounts = held.map(({ key, label }) => [key, amountRow(key, label, item[key], start(key), (v) => (draft[key] = v))]);
      const stat = Object.entries(item.food ?? item.book ?? {})[0];
      const verb = verbFor(item);
      const dogButton = (dog) => {
        const node = button("Button_primary", dog.name, async () => {
          busy = true;
          render();
          await useOn(item, dog);
          busy = false;
          render();
        });
        node.classList.toggle("dognerd-inventory-done", !!item.consumedByDog?.[dog.uuid]);
        node.disabled = busy || item.doghouse + item.storage + item.closet === 0;
        return node;
      };
      const dogGroup = (text, list) =>
        list.length
          ? [el("p", { className: "dognerd-inventory-feed-label", textContent: text }), el("div", { className: "dognerd-inventory-feeds" }, list.map(dogButton))]
          : [];
      const feeds = stat
        ? [
            ...dogGroup(`${item.food ? "Feed" : "Read"} (+${stat[1]} ${stat[0][0].toUpperCase()}${stat[0].slice(1)})`, dogs.filter((d) => !item.consumedByDog[d.uuid])),
            ...dogGroup(item.food ? "Already eaten" : "Already read", dogs.filter((d) => item.consumedByDog[d.uuid])),
          ]
        : verb
          ? dogGroup(verb, dogs)
          : [];
      const use = () => {
        const node = button("Button_primary", "Use", async () => {
          busy = true;
          render();
          await useAt(item);
          busy = false;
          render();
        });
        node.disabled = busy || item.doghouse + item.storage + item.closet === 0;
        return el("div", { className: "dognerd-inventory-feeds" }, [node]);
      };
      const select = grouped("Button_primary", "Select", () => {
        const pick = Object.fromEntries(amounts.map(([key, row]) => [key, row.value()]).filter(([, n]) => n > 0));
        if (Object.keys(pick).length) selected.set(id, pick);
        else selected.delete(id);
        close();
        schedule();
      });
      body.replaceChildren(
        el("img", { className: g("doghouse_itemPreviewImage"), src: spriteUrl(`/${item.image}`), alt: "" }),
        el("h2", { className: g("doghouse_itemTitle"), textContent: item.name }),
        ...feeds,
        ...(item.navigate ? [use()] : []),
        el("div", { className: "dognerd-inventory-amounts" }, amounts.map(([, row]) => row.node)),
        el("div", { className: g("ButtonGroup_groupContainer") }, [row([select, grouped("Button_neutral", "Cancel", () => close())])]),
      );
    };
    const close = dialog(body, DIALOG);
    render();
  }

  function showTray(tray) {
    const items = picked();
    const movable = areas.map(({ key }) => items.some((i) => Object.keys(sources(i, key)).length));
    const all = visible.length > 0 && visible.every((i) => chosen(i.id) === total(i));
    const sig = JSON.stringify([moving, progress, movable, items.length, all]);
    tray.hidden = items.length === 0;
    if (tray.dataset.sig === sig) return;
    tray.dataset.sig = sig;
    const moves = areas.map(({ key, move: label }, i) => {
      const node = button("Button_primary", label, () => moveSelected(key));
      node.disabled = moving || !movable[i];
      return node;
    });
    const select = button("Button_neutral", all ? "Select None" : "Select All", () => {
      if (all) selected.clear();
      else {
        for (const i of visible) {
          const held = areas.filter(({ key }) => shown.has(key) && i[key] > 0);
          selected.set(i.id, Object.fromEntries(held.map(({ key }) => [key, i[key]])));
        }
      }
      schedule();
    });
    const cancel = button("Button_neutral", "Cancel", () => {
      selected.clear();
      schedule();
    });
    select.disabled = cancel.disabled = moving;
    tray.replaceChildren(
      el("p", { className: "dognerd-inventory-count", textContent: progress ? `Moving... ${progress[0]}/${progress[1]}` : `${items.length} selected` }),
      el("div", { className: g("doghouse_bulkActionsContainer") }, [...moves, select, cancel]),
    );
  }

  function saveAreas() {
    browser.storage.local
      .set({ [AREAS_KEY]: [...shown] })
      .catch((e) => warnOnce("inventory-areas", "couldn't save the shown areas:", e.message));
  }

  function showAreas(row) {
    const all = merged();
    const counts = Object.fromEntries(areas.map(({ key }) => [key, all.reduce((sum, i) => sum + i[key], 0)]));
    const sig = JSON.stringify([[...shown], counts]);
    if (row.dataset.sig === sig) return;
    row.dataset.sig = sig;
    row.replaceChildren(
      ...areas.map(({ key, label }) => {
        const on = shown.has(key);
        const toggle = el("button", {
          type: "button",
          className: `${g("Button_button")} ${g("Button_neutral")} dognerd-area-${key}`,
          ariaLabel: `${label} (${counts[key]})`,
          onclick: () => {
            if (!shown.delete(key)) shown.add(key);
            saveAreas();
            schedule();
          },
        }, [icon(key), el("span", { className: "dognerd-area-label", textContent: label }), String(counts[key])]);
        toggle.setAttribute("aria-pressed", String(on));
        return toggle;
      }),
    );
  }

  function byType(items, types) {
    const groups = [];
    for (const item of items) {
      if (groups.at(-1)?.group !== item.group) groups.push({ group: item.group, items: [] });
      groups.at(-1).items.push(item);
    }
    return groups.map(({ group, items }) => ({ label: `${types[group]?.[1] ?? "Other"} (${items.length})`, items }));
  }

  function showGrid(grid, items) {
    const nodes = items.map(card);
    const sig = JSON.stringify(items.map((i) => i.id));
    if (grid.dataset.sig === sig) return;
    grid.dataset.sig = sig;
    grid.replaceChildren(...nodes);
  }

  function copyGroups(bar) {
    const typed = [...visible].sort((a, b) => a.group - b.group);
    return byType(typed, options(bar).types).map(({ label, items }) => ({
      label,
      items: items.map((i) => ({ name: i.name, image: i.image, qty: total(i) })),
    }));
  }

  function copied(button, label, ok) {
    button.textContent = ok ? "Copied!" : "Couldn't Copy";
    setTimeout(() => (button.textContent = label), 1500);
  }

  async function copyAsText(button, bar) {
    const dog = activeDog(dogs)?.name;
    const lines = [dog ? `♡ ${dog}'s inventory ♡` : "♡ inventory ♡"];
    for (const { label, items } of copyGroups(bar)) {
      lines.push("", label, ...items.map((i) => `~ ${i.name}${i.qty > 1 ? ` x${i.qty}` : ""}`));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      copied(button, "Copy as Text", true);
    } catch (e) {
      warnOnce("inventory-copy", "couldn't copy the inventory:", e.message);
      copied(button, "Copy as Text", false);
    }
  }

  async function copyAsImage(button, bar) {
    button.disabled = true;
    try {
      // Passing the pending blob keeps the click's permission to write the clipboard while it draws.
      const png = DogNerdTradeImage.renderGroups(copyGroups(bar), activeDog(dogs)?.name);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      copied(button, "Copy as Image", true);
    } catch (e) {
      warnOnce("inventory-image", "couldn't copy the inventory image:", e.message);
      copied(button, "Copy as Image", false);
    }
    button.disabled = false;
  }

  function showCopy(actions, bar) {
    if (!actions) return;
    let copy = [...actions.querySelectorAll(`:scope > .${COPY}`)];
    if (copy.length !== 2) {
      copy.forEach((n) => n.remove());
      const text = button("Button_neutral", "Copy as Text", () => copyAsText(text, bar));
      const image = button("Button_neutral", "Copy as Image", () => copyAsImage(image, bar));
      copy = [text, image];
      for (const n of copy) n.classList.add(COPY);
      actions.append(...copy);
    }
    for (const n of copy) n.hidden = visible.length === 0;
  }

  function show() {
    const content = document.querySelector('[class*="Layout_content__"]');
    const bar = content?.querySelector('[class*="ItemSortFilterBar_optionsBar__"]');
    if (!bar || !lists || !(styled || ensureStyles())) return;
    content.classList.add(ACTIVE);
    let section = content.querySelector(`.${SECTION}`);
    if (!section) {
      section = el("div", { className: SECTION }, [
        el("div", { className: "dognerd-inventory-areas", role: "group", ariaLabel: "Areas to show" }),
        el("div", { className: `${g("ItemGrid_grid")} ${g("ItemGrid_medium")}` }),
        el("p", { className: "dognerd-inventory-empty", textContent: "No items found." }),
      ]);
    }
    if (bar.nextElementSibling !== section) bar.after(section);
    const [types, sorts] = bar.querySelectorAll("select");
    if (types && !types.querySelector(`option[value="${TRANSFORMATION.value}"]`)) {
      const option = el("option", { value: TRANSFORMATION.value, textContent: TRANSFORMATION.label });
      types.append(option);
      addedOptions.push(option);
    }
    if (sorts && !sorts.querySelector(`option[value="${TYPE_SORT.value}"]`)) {
      const option = el("option", { value: TYPE_SORT.value, textContent: TYPE_SORT.label });
      sorts.prepend(option);
      addedOptions.push(option);
      sorts.value = TYPE_SORT.value;
    }
    let tray = section.querySelector(`.${TRAY}`);
    if (!tray) section.append((tray = el("div", { className: TRAY, hidden: true })));
    rename(content.querySelector('[class*="Header_header__"]'));
    section.dataset.hidden = areas.filter(({ key }) => !shown.has(key))
      .map(({ key }) => key)
      .join(" ");
    const [row, grid, empty] = section.children;
    visible = visibleItems(bar);
    const ids = new Set(merged().map((i) => i.id));
    for (const id of selected.keys()) if (!ids.has(id)) selected.delete(id);
    for (const id of cards.keys()) if (!ids.has(id)) cards.delete(id);
    showTray(tray);
    document.body.style.paddingBottom = tray.hidden ? "" : `${tray.offsetHeight}px`;
    showAreas(row);
    showCopy(content.querySelector('[class*="storage_actionsBar__"]'), bar);
    showGrid(grid, visible);
    empty.hidden = visible.length > 0;
    document.documentElement.classList.remove(LOADING);
  }

  // React keeps the header's text node, so its text is swapped in place to survive rerenders.
  let renamed = null;
  function rename(header) {
    const text = [...(header?.childNodes ?? [])].find((n) => n.nodeType === Node.TEXT_NODE);
    if (!text || text.data === TITLE) return;
    renamed = { text, was: text.data };
    text.data = TITLE;
  }

  function hide() {
    if (renamed?.text.data === TITLE) renamed.text.data = renamed.was;
    renamed = null;
    selected.clear();
    cards.clear();
    document.body.style.paddingBottom = "";
    document.documentElement.classList.remove(LOADING);
    document.querySelector(`.${DIALOG}`)?.parentElement.remove();
    document.querySelector(`.${SECTION}`)?.remove();
    document.querySelectorAll(`.${COPY}`).forEach((n) => n.remove());
    addedOptions.splice(0).forEach((option) => option.remove());
    document.querySelector(`.${ACTIVE}`)?.classList.remove(ACTIVE);
  }

  function giveUp() {
    gaveUp = true;
    document.documentElement.classList.remove(LOADING);
  }

  let scheduled = false;
  let loaded = false;
  let waiting = null;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const onRoute = ROUTE.test(location.pathname);
      if (!onRoute) {
        loaded = gaveUp = false;
        clearTimeout(waiting);
      }
      if (!enabled || !onRoute) {
        hide();
        return;
      }
      if (!loaded) {
        loaded = true;
        load();
        waiting = setTimeout(() => {
          if (!document.querySelector(`.${SECTION}`)) giveUp();
        }, 10000);
      }
      if (!gaveUp && !document.querySelector(`.${SECTION}`)) document.documentElement.classList.add(LOADING);
      show();
    });
  }

  document.addEventListener("input", (e) => e.target.closest?.(".dognerd-overlay") || schedule(), true);
  document.addEventListener("change", schedule, true);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
