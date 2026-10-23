(() => {
  "use strict";

  const { COLLECTIONS, onData, norm, warnOnce, el, icon, query } = DogNerd;

  const BADGES = "dognerd-item-badges";
  const STATE_KEY = "itemBadges";
  const STALE = 30 * 1000;

  let state = null;
  let lookup = null;
  let loadedAt = 0;
  let loading = false;

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
      const dog = dogs.find((d) => d.isActiveDog) ?? dogs[0];
      const { food, books } =
        storedDogState?.dogUuid === dog.uuid
          ? storedDogState
          : await query("collection.getDogState", { dogIndex: dog.index });

      const item = (i) => ({
        name: i.name,
        image: i.image,
        count: i.count ?? 1,
        food: !!i.food,
        book: !!i.book,
        consumed: !!i.consumedByDog?.[dog.uuid],
      });
      const seen = (i) => ({ name: i.name, image: i.image });
      const fresh = {
        dog: dog.name,
        dogIndex: dog.index,
        doghouse: inventory.map(item),
        storage: storage.map(item),
        closet: cosmetics.map(item),
        eaten: food.map(seen),
        read: books.map(seen),
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
        info = { food: false, book: false, done: false, doghouse: 0, storage: 0, closet: 0 };
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

  function markCard(card) {
    const wrap = card.querySelector('[class*="ItemCard_iconWrap__"]');
    if (!wrap) return;
    const info = infoFor(card);
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

  let refresh = null;
  document.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest?.('[role="dialog"] button')) return;
      clearTimeout(refresh);
      refresh = setTimeout(load, 1500);
    },
    true,
  );

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  onData(() => {
    lookup = null;
    schedule();
  });
  schedule();
})();
