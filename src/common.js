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

  // The game rate limits per request, not per procedure.
  const SHARED = 5000;
  const MAX_BATCH = 10;
  const answers = new Map();
  let generation = 0;
  let pending = [];

  // Firefox exposes the page-context fetch as content.fetch.
  const pageFetch = (...args) => (globalThis.content?.fetch ?? fetch)(...args);
  const queryKey = (procedure, input) => `${procedure} ${JSON.stringify(input ?? null)}`;

  function share(key, text) {
    const entry = { at: Date.now(), generation, text };
    answers.set(key, entry);
    text.catch(() => answers.get(key) === entry && answers.delete(key));
  }

  function query(procedure, input = null) {
    const key = queryKey(procedure, input);
    const hit = answers.get(key);
    if (!hit || hit.generation !== generation || Date.now() - hit.at > SHARED) {
      const text = new Promise((resolve, reject) => {
        if (!pending.length) setTimeout(flush);
        pending.push({ procedure, input, resolve, reject });
      });
      share(key, text);
    }
    return answers.get(key).text.then(JSON.parse);
  }

  function flush() {
    const batch = pending;
    pending = [];
    for (let i = 0; i < batch.length; i += MAX_BATCH) send(batch.slice(i, i + MAX_BATCH));
  }

  async function send(batch) {
    try {
      const procedures = batch.map((q) => q.procedure).join(",");
      const input = encodeURIComponent(JSON.stringify(Object.fromEntries(batch.map((q, i) => [i, { json: q.input }]))));
      const res = await pageFetch(`/api/trpc/${procedures}?batch=1&input=${input}`, { credentials: "include" });
      // Parsed here, the page's own JSON objects can't take extension objects in Firefox.
      const results = await res.text().then(JSON.parse).catch(() => null);
      batch.forEach((q, i) => {
        const data = results?.[i]?.result?.data;
        if (data) q.resolve(JSON.stringify(data.json ?? null));
        else q.reject(new Error(`${res.status} ${q.procedure}`));
      });
    } catch (e) {
      batch.forEach((q) => q.reject(e));
    }
  }

  for (const router of ["tower", "doghouse", "storage", "dressup"]) {
    document.addEventListener(`dognerd:${router}`, (e) => {
      try {
        const { procedures, input, body, text } = JSON.parse(e.detail);
        if (body !== null || !input) return;
        const inputs = JSON.parse(input);
        const results = JSON.parse(text);
        procedures.forEach((procedure, i) => {
          const data = results?.[i]?.result?.data;
          if (data) share(queryKey(procedure, inputs?.[i]?.json), Promise.resolve(JSON.stringify(data.json ?? null)));
        });
      } catch {}
    });
  }

  // From page-hook.js and mutate().
  document.addEventListener("dognerd:mutation", () => generation++);

  async function mutate(procedure, input) {
    let res;
    try {
      res = await pageFetch(`/api/trpc/${procedure}?batch=1`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ 0: { json: input } }),
      });
    } finally {
      document.dispatchEvent(new CustomEvent("dognerd:mutation", { detail: JSON.stringify({ procedures: [procedure], ours: true }) }));
    }
    if (!res.ok) throw new Error(`${res.status} ${procedure}`);
    return JSON.parse(await res.text())[0].result.data.json;
  }

  // A game page only has the stylesheets of the pages visited before it.
  const styleLoads = new Map();
  function loadStyles(path) {
    if (!styleLoads.has(path)) styleLoads.set(path, addStyles(path));
    return styleLoads.get(path);
  }

  async function addStyles(path) {
    const pageFetch = globalThis.content?.fetch ?? fetch;
    const html = await (await pageFetch(path, { credentials: "include" })).text();
    const have = new Set([...document.styleSheets].map((s) => s.href));
    const hrefs = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll('link[rel="stylesheet"]')]
      .map((link) => new URL(link.getAttribute("href"), location.origin).href)
      .filter((href) => !have.has(href));
    await Promise.all(
      [...new Set(hrefs)].map(
        (href) => new Promise((resolve) => document.head.append(el("link", { rel: "stylesheet", href, onload: resolve, onerror: resolve }))),
      ),
    );
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

  function dialog(body, className = "", onClose = () => {}, { wide = true, footer = null } = {}) {
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
    const widened = (name) => (wide ? `${gameClass(name)} ${gameClass(name + "Wide")}` : gameClass(name));
    const content = el("div", { className: `${widened("Dialog_content")} ${className}`, role: "dialog", tabIndex: -1 }, [
      el("div", { className: gameClass("Dialog_modalBody") }, [
        el("div", { className: widened("Dialog_body") }, [body]),
        ...(footer ? [footer] : []),
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

  const SETTINGS_KEY = "settings";
  // Also hardcoded in accessibility.js, which runs before this file.
  const OFF_BY_DEFAULT = ["dyslexiaFont", "stillEffects"];
  const settingOn = (stored, feature) => stored?.[feature] ?? !OFF_BY_DEFAULT.includes(feature);
  const watchSetting = (feature, fn) => watchStored(SETTINGS_KEY, (stored) => fn(settingOn(stored, feature)));

  function watchTrade(fn) {
    let on, list;
    const update = () => {
      if (on !== undefined && list !== undefined) fn(on ? list : {});
    };
    watchSetting("trade", (enabled) => {
      on = enabled;
      update();
    });
    watchStored("upForTrade", (stored) => {
      list = stored ?? {};
      update();
    });
  }

  // data/index.json lists the sections; data/<section>.json holds one collection:
  //   schema   must equal SCHEMA
  //   unseen   "hidden" when the game omits unseen entries from the grid
  //   blocks   [{name, size}], unused but required by older versions' validation
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
    loadStyles,
    quantitySelector,
    dialog,
    confirmDialog,
    activeDog,
    onResponse,
    refetch,
    watchStored,
    SETTINGS_KEY,
    settingOn,
    watchSetting,
    watchTrade,
  };
})();
