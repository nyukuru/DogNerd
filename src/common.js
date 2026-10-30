globalThis.browser ??= chrome;

var DogNerd = (() => {
  "use strict";

  const hasClass = (el, prefix) => [...el.classList].some((c) => c.startsWith(prefix + "__"));

  // "Rainbow Trout (Sky)" -> "rainbow trout"
  const norm = (s) =>
    s
      .replace(/\(.*?\)/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const warned = new Set();
  function warnOnce(key, ...msg) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn("[DogNerd]", ...msg);
  }

  function findGameClass(name) {
    const re = new RegExp(`\\.(${name}__[\\w-]+)`);
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        const match = re.exec(rule.selectorText ?? "");
        if (match) return match[1];
      }
    }
    return null;
  }

  // "Dialog_content" -> "Dialog_content__1zkEl"
  const gameClasses = new Map();
  function gameClass(name) {
    if (!gameClasses.has(name)) {
      const found = findGameClass(name);
      if (!found) return name;
      gameClasses.set(name, found);
    }
    return gameClasses.get(name);
  }

  function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  const icons = new Map();
  function loadIcon(name) {
    if (!icons.has(name)) {
      const svg = fetch(browser.runtime.getURL(`img/icons/${name}.svg`))
        .then((res) => res.text())
        .then((text) => new DOMParser().parseFromString(text, "image/svg+xml").documentElement);
      icons.set(name, svg);
    }
    return icons.get(name);
  }

  // Inlined so the icon's currentColor fill takes the surrounding text color.
  function icon(name) {
    const slot = el("span", { className: "dognerd-icon", ariaHidden: "true" });
    loadIcon(name)
      .then((svg) => slot.replaceChildren(document.importNode(svg, true)))
      .catch((e) => warnOnce(`icon:${name}`, `couldn't load the ${name} icon:`, e.message));
    return slot;
  }

  function spriteUrl(sprite) {
    return new URL(sprite, location.origin).href;
  }

  const DAY = 24 * 60 * 60 * 1000;
  const NEW_DAY_UTC_HOUR = 7;

  function untilNewDay(now = Date.now()) {
    const d = new Date(now);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), NEW_DAY_UTC_HOUR);
    return start > now ? start - now : start + DAY - now;
  }

  async function query(procedure, input = null) {
    const batch = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
    // Firefox exposes the page-context fetch as content.fetch.
    const pageFetch = globalThis.content?.fetch ?? fetch;
    const res = await pageFetch(`/api/trpc/${procedure}?batch=1&input=${batch}`, { credentials: "include" });
    if (!res.ok) throw new Error(`${res.status} ${procedure}`);
    // Parsed here, the page's own JSON objects can't take extension objects in Firefox.
    return JSON.parse(await res.text())[0].result.data.json;
  }

  async function mutate(procedure, input) {
    const pageFetch = globalThis.content?.fetch ?? fetch;
    const res = await pageFetch(`/api/trpc/${procedure}?batch=1`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 0: { json: input } }),
    });
    if (!res.ok) throw new Error(`${res.status} ${procedure}`);
    return JSON.parse(await res.text())[0].result.data.json;
  }

  function quantitySelector(max) {
    let value = 1;
    const input = el("input", { className: gameClass("QuantitySelector_input"), type: "text", inputMode: "numeric", value: "1" });
    const minus = el("button", { type: "button", className: gameClass("QuantitySelector_stepButton"), textContent: "−" });
    const plus = el("button", { type: "button", className: gameClass("QuantitySelector_stepButton"), textContent: "+" });
    const set = (n) => {
      value = Math.min(max, Math.max(1, n || 1));
      input.value = String(value);
      minus.disabled = value <= 1;
      plus.disabled = value >= max;
    };
    minus.onclick = () => set(value - 1);
    plus.onclick = () => set(value + 1);
    input.onchange = () => set(parseInt(input.value, 10));
    set(1);
    const node = el("div", { className: gameClass("QuantitySelector_container") }, [
      el("p", { className: gameClass("QuantitySelector_label"), textContent: "Quantity:" }),
      minus,
      input,
      plus,
    ]);
    return { node, value: () => value };
  }

  // The game's dialog around `body`, returns its close().
  function dialog(body, className = "", onClose = () => {}) {
    const close = () => {
      onClose();
      overlay.remove();
      removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => {
      if (e.key !== "Escape" || [...document.querySelectorAll(".dognerd-overlay")].pop() !== overlay) return;
      e.stopPropagation();
      close();
    };
    const content = el("div", { className: `${gameClass("Dialog_content")} ${gameClass("Dialog_contentWide")} ${className}`, role: "dialog", tabIndex: -1 }, [
      el("div", { className: gameClass("Dialog_modalBody") }, [
        el("div", { className: `${gameClass("Dialog_body")} ${gameClass("Dialog_bodyWide")}` }, [body]),
      ]),
    ]);
    const overlay = el("div", { className: `${gameClass("Dialog_overlay")} dognerd-overlay` }, [content]);
    overlay.dataset.state = content.dataset.state = "open";
    // A game dialog underneath turns off pointer events on the body and closes on presses outside it.
    overlay.style.pointerEvents = "auto";
    overlay.onpointerdown = (e) => e.stopPropagation();
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
    addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    content.focus();
    return close;
  }

  function confirmDialog({ title, text, confirm, variant = "Button_danger" }) {
    return new Promise((resolve) => {
      const answer = (yes) => () => {
        resolve(yes);
        close();
      };
      const button = (cls, label, onclick) =>
        el("button", { type: "button", className: `${gameClass("Button_button")} ${gameClass(cls)} ${gameClass("ButtonGroup_buttonContainer")}`, textContent: label, onclick });
      const close = dialog(
        el("div", { className: gameClass("doghouse_itemDialogBody") }, [
          el("h2", { className: gameClass("doghouse_itemTitle"), textContent: title }),
          el("p", { textContent: text }),
          el("div", { className: gameClass("ButtonGroup_groupContainer") }, [
            el("div", { className: `${gameClass("ButtonGroup_rowContainer")} ${gameClass("ButtonGroup_row")}` }, [
              button(variant, confirm, answer(true)),
              button("Button_neutral", "Cancel", answer(false)),
            ]),
          ]),
        ]),
        "dognerd-confirm",
        () => resolve(false),
      );
    });
  }

  const activeDog = (dogs) => dogs?.find((d) => d.isActiveDog) ?? dogs?.[0];

  function onResponse(router, fn) {
    document.addEventListener(`dognerd:${router}`, (e) => {
      try {
        const { procedures, text } = JSON.parse(e.detail);
        const results = JSON.parse(text);
        procedures.forEach((procedure, i) => fn(procedure, results?.[i]?.result?.data?.json));
      } catch (err) {
        warnOnce(`${router}-fetch`, `couldn't follow a ${router} request:`, err.message);
      }
    });
  }

  // True when page-hook.js refetched the game's queries, so no reload is needed.
  const refetch = (router) => !document.dispatchEvent(new CustomEvent("dognerd:refetch", { detail: router, cancelable: true }));

  function watchStored(key, fn) {
    browser.storage.local.get(key).then((r) => fn(r[key]));
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[key]) fn(changes[key].newValue);
    });
  }

  // data/index.json lists the sections; data/<section>.json holds one collection:
  //   schema   must equal SCHEMA
  //   unseen   "hidden" when the game omits unseen entries from the grid
  //   blocks   [{name, color, size}], outlined groups of slots
  //   slots    [{name, block, sprite, obtain: [{where, details: [[label, text]]}], guess?, group?, plant?}]
  //   fishing  (fish only) {areas: {areaId: where}, baitTiers: [[bait, ...weakest first]]}
  //   plant    (harvestables only) the crop's farm tile label, "Oak Tree" for Acorn and its variants
  const BUNDLED = browser.runtime.getURL("data/");
  const REMOTE = "https://raw.githubusercontent.com/nyukuru/DogNerd/main/data/";
  const SCHEMA = 1;
  const REFRESH = 6 * 60 * 60 * 1000;
  const CACHE_KEY = "collections";

  const COLLECTIONS = {};
  const listeners = [];

  const valid = (c) =>
    c?.schema === SCHEMA &&
    Array.isArray(c.blocks) &&
    Array.isArray(c.slots) &&
    c.slots.every((s) => s === null || (typeof s?.name === "string" && Array.isArray(s.obtain ?? [])));

  function applyData(collections) {
    let changed = false;
    for (const [section, c] of Object.entries(collections ?? {})) {
      if (!valid(c) || JSON.stringify(c) === JSON.stringify(COLLECTIONS[section])) continue;
      COLLECTIONS[section] = c;
      changed = true;
    }
    if (changed) listeners.forEach((fn) => fn());
  }

  async function getJSON(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  async function getCollections(base) {
    const index = await getJSON(base + "index.json");
    const collections = {};
    if (index?.schema !== SCHEMA || !Array.isArray(index.collections)) return collections;
    for (const section of index.collections) {
      if (!/^[a-z]+$/.test(section)) continue;
      const c = await getJSON(`${base}${section}.json`).catch(() => null);
      if (valid(c)) collections[section] = c;
    }
    return collections;
  }

  async function loadData() {
    const [bundled, cached] = await Promise.all([
      getCollections(BUNDLED).catch((e) => (warnOnce("bundled", "couldn't load the collection data:", e.message), {})),
      browser.storage.local.get(CACHE_KEY).then((r) => r[CACHE_KEY]),
    ]);
    applyData({ ...bundled, ...cached?.collections });
    if (cached && Date.now() - cached.fetchedAt < REFRESH) return;

    let collections = cached?.collections ?? {};
    try {
      collections = { ...collections, ...(await getCollections(REMOTE)) };
    } finally {
      await browser.storage.local.set({ [CACHE_KEY]: { fetchedAt: Date.now(), collections } });
    }
    applyData(collections);
  }

  loadData().catch((e) => warnOnce("refresh", "couldn't load the latest collection data:", e.message));

  return {
    COLLECTIONS,
    onData: (fn) => listeners.push(fn),
    hasClass,
    norm,
    warnOnce,
    gameClass,
    el,
    icon,
    spriteUrl,
    untilNewDay,
    query,
    mutate,
    quantitySelector,
    dialog,
    confirmDialog,
    activeDog,
    onResponse,
    refetch,
    watchStored,
  };
})();
