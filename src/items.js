(() => {
  "use strict";

  const { COLLECTIONS, onData, norm, warnOnce, el, icon, query, activeDog, watchSetting, watchTrade } = DogNerd;

  const BADGES = "dognerd-item-badges";
  const WORN = "dognerd-worn";
  const STATE_KEY = "itemBadges";
  const STALE = 30 * 1000;

  let enabled = true;
  let state = null;
  let trade = {};
  let lookup = null;
  let loadedAt = 0;
  let loading = false;

  const toItem = (i, dogUuid) => ({
    name: i.name,
    image: i.image,
    count: i.count ?? 1,
    food: !!i.food,
    book: !!i.book,
    consumed: !!i.consumedByDog?.[dogUuid],
  });

  function applyState(fresh) {
    if (JSON.stringify(fresh) === JSON.stringify(state)) return;
    state = fresh;
    lookup = null;
    schedule();
  }

  async function load() {
    if (loading) return;
    loading = true;
    loadedAt = Date.now();
    try {
      const stored = (await browser.storage.local.get(STATE_KEY))[STATE_KEY];
      if (stored && !state) applyState(stored);

      // The stored dog's collection is fetched in parallel and only refetched if the active dog changed.
      const [{ dogs, inventory }, storage, { cosmetics }, storedDogState] = await Promise.all([
        query("doghouse.getState"),
        query("storage.getItems"),
        query("dressup.getState", {}),
        stored ? query("collection.getDogState", { dogIndex: stored.dogIndex }).catch(() => null) : null,
      ]);
      const dog = activeDog(dogs);
      // Worn copies only show up, with isEquipped, in the wearing dog's closet and aren't in its counts.
      const [{ food, books }, ...dressed] = await Promise.all([
        storedDogState?.dogUuid === dog.uuid ? storedDogState : query("collection.getDogState", { dogIndex: dog.index }),
        ...dogs.map((d) => query("dressup.getState", { dogIndex: d.index })),
      ]);
      const worn = new Map();
      dogs.forEach((d, n) => {
        for (const i of dressed[n].cosmetics.filter((c) => c.isEquipped)) {
          if (!worn.has(i.id)) worn.set(i.id, { name: i.name, image: i.image, dogs: [] });
          worn.get(i.id).dogs.push(d.name);
        }
      });

      const item = (i) => toItem(i, dog.uuid);
      const seen = (i) => ({ name: i.name, image: i.image });
      const fresh = {
        dog: dog.name,
        dogIndex: dog.index,
        dogUuid: dog.uuid,
        doghouse: inventory.map(item),
        storage: storage.map(item),
        closet: cosmetics.map(item),
        eaten: food.map(seen),
        read: books.map(seen),
        worn: [...worn.values()],
      };
      applyState(fresh);
      await browser.storage.local.set({ [STATE_KEY]: fresh });
    } catch (e) {
      warnOnce("items", "couldn't load the items:", e.message);
    } finally {
      loading = false;
    }
  }

  function buildLookup() {
    const byImage = new Map();
    const byName = new Map();
    const infoOf = (name, image) => {
      const path = image?.replace(/^\//, "");
      const isGamePath = path && !/^[a-z]+:/.test(path);
      let info = isGamePath ? byImage.get(path) : byName.get(norm(name));
      if (!info) {
        info = { food: false, book: false, done: false, doghouse: 0, storage: 0, closet: 0, trade: 0, worn: [] };
        if (isGamePath) byImage.set(path, info);
      }
      if (!byName.has(norm(name))) byName.set(norm(name), info);
      return info;
    };

    for (const where of ["doghouse", "storage", "closet"]) {
      for (const i of state[where]) {
        const info = infoOf(i.name, i.image);
        info[where] += i.count;
        info.food ||= i.food;
        info.book ||= i.book;
        info.done ||= i.consumed;
      }
    }
    for (const i of state.eaten) Object.assign(infoOf(i.name, i.image), { food: true, done: true });
    for (const i of state.read) Object.assign(infoOf(i.name, i.image), { book: true, done: true });
    for (const i of state.worn ?? []) infoOf(i.name, i.image).worn.push(...i.dogs);
    for (const i of Object.values(trade)) {
      const info = infoOf(i.name, i.image);
      info.trade = Math.min(i.qty, info.doghouse);
      info.doghouse -= info.trade;
    }
    for (const slot of COLLECTIONS.food?.slots ?? []) if (slot) infoOf(slot.name, slot.sprite).food = true;
    for (const slot of COLLECTIONS.books?.slots ?? []) if (slot) infoOf(slot.name, slot.sprite).book = true;
    return { byImage, byName };
  }

  function imageKey(img) {
    try {
      const url = new URL(img?.src ?? "", location.origin);
      return url.origin === location.origin ? url.pathname.slice(1) : url.href;
    } catch {
      return null;
    }
  }

  function infoFor(card) {
    lookup ??= buildLookup();
    const img = card.querySelector('[class*="ItemCard_icon__"]');
    const name = card.querySelector('[class*="ItemCard_name__"]')?.textContent ?? img?.alt ?? "";
    return lookup.byImage.get(imageKey(img)) ?? lookup.byName.get(norm(name)) ?? null;
  }

  function badges(info) {
    const dog = state.dog;
    const list = [];
    if (info.food) {
      const label = info.done ? `${dog} has eaten this` : `${dog} hasn't eaten this yet`;
      list.push({ kind: "food", off: !info.done, label });
    }
    if (info.book) {
      const label = info.done ? `${dog} has read this` : `${dog} hasn't read this yet`;
      list.push({ kind: "book", off: !info.done, label });
    }
    if (info.doghouse) list.push({ kind: "doghouse", count: info.doghouse, label: `${info.doghouse} in your doghouse` });
    if (info.storage) list.push({ kind: "storage", count: info.storage, label: `${info.storage} in storage` });
    if (info.closet) list.push({ kind: "closet", count: info.closet, label: `${info.closet} in your closet` });
    if (info.trade) list.push({ kind: "trade", count: info.trade, label: `${info.trade} up for trade` });
    return list;
  }

  function badgeElement({ kind, count, off, label }) {
    const badge = el("span", { className: `dognerd-item-badge dognerd-${kind}${off ? " dognerd-off" : ""}` }, [
      icon(kind),
    ]);
    if (count) badge.append(String(count));
    badge.setAttribute("aria-label", label);
    return badge;
  }

  function markWorn(card, dogs) {
    const label = dogs.length ? `Worn by ${dogs.join(", ")}` : "";
    if ((card.dataset.dognerdWorn ?? "") === label && !!card.querySelector(`.${WORN}-icon`) === !!label) return;
    card.classList.toggle(WORN, !!label);
    card.querySelector(`.${WORN}-icon`)?.remove();
    if (label) {
      card.dataset.dognerdWorn = card.title = label;
      const wrap = card.querySelector('[class*="ItemCard_iconWrap__"]');
      wrap.append(el("img", { className: `${WORN}-icon`, src: new URL("/favicon.ico", location.origin).href, alt: "" }));
    } else {
      delete card.dataset.dognerdWorn;
      card.removeAttribute("title");
    }
  }

  function markCard(card) {
    const wrap = card.querySelector('[class*="ItemCard_iconWrap__"]');
    if (!wrap) return;
    const info = infoFor(card);
    markWorn(card, info?.worn ?? []);
    const list = info ? badges(info) : [];
    const sig = JSON.stringify(list);
    let box = wrap.querySelector(`:scope > .${BADGES}`);
    if (box?.dataset.sig === sig) return;
    if (!list.length) {
      box?.remove();
      return;
    }
    if (!box) wrap.append((box = el("div", { className: BADGES })));
    box.dataset.sig = sig;
    box.replaceChildren(...list.map(badgeElement));
  }

  const inCollection = () => location.pathname.startsWith("/collection");

  let scheduled = false;
  let shownFor = null;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!enabled) {
        shownFor = null;
        document.querySelectorAll(`.${BADGES}`).forEach((n) => n.remove());
        document.querySelectorAll(`.${WORN}`).forEach((card) => markWorn(card, []));
        return;
      }
      if (inCollection()) return;
      const cards = document.querySelectorAll('[class*="ItemCard_card__"]');
      if (!cards.length) return;
      if (shownFor !== location.pathname) {
        shownFor = location.pathname;
        if (Date.now() - loadedAt > STALE) load();
      }
      if (!state) return;
      cards.forEach(markCard);
    });
  }

  // The game refetches these lists whenever they change, any other call on these routers means a reload.
  const LISTS = {
    "doghouse.getState": ["doghouse", (data) => data?.inventory],
    "storage.getItems": ["storage", (data) => data],
    "dressup.getState": ["closet", (data) => data?.cosmetics],
  };

  let refresh = null;
  for (const router of ["doghouse", "storage", "dressup"]) {
    document.addEventListener(`dognerd:${router}`, (e) => {
      try {
        const { procedures, text } = JSON.parse(e.detail);
        const results = JSON.parse(text);
        let fresh = state;
        procedures.forEach((procedure, i) => {
          const data = results?.[i]?.result?.data?.json;
          if (!LISTS[procedure]) {
            if (procedure.startsWith(`${router}.`)) {
              clearTimeout(refresh);
              refresh = setTimeout(load, 500);
            }
            return;
          }
          const [where, list] = LISTS[procedure];
          if (fresh?.dogUuid && Array.isArray(list(data))) {
            fresh = { ...fresh, [where]: list(data).map((i) => toItem(i, fresh.dogUuid)) };
          }
        });
        if (fresh !== state) applyState(fresh);
      } catch (err) {
        warnOnce("items-fetch", "couldn't follow an item request:", err.message);
      }
    });
  }

  watchTrade((fresh) => {
    trade = fresh;
    lookup = null;
    schedule();
  });

  watchSetting("items", (on) => {
    enabled = on;
    schedule();
  });

  // Sent by inventory.js with the game's lists, its moves don't go through the page's fetch.
  document.addEventListener("dognerd:inventory", (e) => {
    if (!state?.dogUuid) return;
    const item = (i) => toItem(i, state.dogUuid);
    applyState({ ...state, doghouse: e.detail.doghouse.map(item), storage: e.detail.storage.map(item), closet: e.detail.closet.map(item) });
  });

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  onData(() => {
    lookup = null;
    schedule();
  });
  schedule();
})();
