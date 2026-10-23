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

  async function query(procedure, input = null) {
    const batch = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
    // Firefox exposes the page-context fetch as content.fetch.
    const pageFetch = globalThis.content?.fetch ?? fetch;
    const res = await pageFetch(`/api/trpc/${procedure}?batch=1&input=${batch}`, { credentials: "include" });
    if (!res.ok) throw new Error(`${res.status} ${procedure}`);
    return (await res.json())[0].result.data.json;
  }

  // data/index.json lists the sections; data/<section>.json holds one collection:
  //   schema   must equal SCHEMA
  //   unseen   "hidden" when the game omits unseen entries from the grid
  //   blocks   [{name, color, size}], outlined groups of slots
  //   slots    [{name, block, sprite, obtain: [{where, details: [[label, text]]}], guess?, group?}]
  //   fishing  (fish only) {areas: {areaId: where}, baitTiers: [[bait, ...weakest first]]}
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
    query,
  };
})();
