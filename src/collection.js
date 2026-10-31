(() => {
  "use strict";

  const { COLLECTIONS, onData, hasClass, norm, warnOnce, gameClass, el, spriteUrl, watchSetting } = DogNerd;

  const ROUTE = /^\/collection\/(?:.+\/)?([a-z]+)\/?$/;
  const SILHOUETTE = "dognerd-silhouette";
  const GUESS = "dognerd-guess";
  const OBTAIN = "dognerd-obtain";
  const PLACEHOLDER = "dognerd-placeholder";
  const QUESTION_MARK = "/img/wiggle-icon-question-mark.gif";

  const TAB_ROUTE = /^\/collection\/?$/;
  const TAB_SECTION = /-trigger-([a-z]+)$/;

  function currentSection() {
    let section = location.pathname.match(ROUTE)?.[1];
    if (!section && TAB_ROUTE.test(location.pathname)) {
      section = document.querySelector('[role="tab"][aria-selected="true"]')?.id.match(TAB_SECTION)?.[1];
    }
    return section && COLLECTIONS[section] ? section : null;
  }

  function cards() {
    return [...document.querySelectorAll('[class*="ItemGrid_grid__"] > [class*="ItemCard_card__"]')];
  }

  const cardEntries = new WeakMap();
  function entryFor(card) {
    const section = currentSection();
    if (!section) return undefined;
    if (COLLECTIONS[section].unseen === "hidden") return cardEntries.get(card);
    return COLLECTIONS[section].slots[cards().indexOf(card)];
  }

  function makeClickable(card, clickable) {
    if (clickable) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      // The game's hover cursor applies to [onclick].
      card.setAttribute("onclick", "");
    } else {
      for (const attr of ["tabindex", "role", "onclick"]) card.removeAttribute(attr);
    }
  }

  function silhouette(card, img, entry) {
    const url = spriteUrl(entry.sprite);
    if (img.src === url || img.dataset.dognerdFailed !== undefined) return;
    if (!img.dataset.dognerdOriginal) img.dataset.dognerdOriginal = img.getAttribute("src") ?? "";
    img.dataset.dognerd = entry.name;
    img.src = url;
    card.classList.add(SILHOUETTE);
    card.classList.toggle(GUESS, !!entry.guess);
    makeClickable(card, true);
  }

  function restore(card, img, revertSrc) {
    card.classList.remove(SILHOUETTE, GUESS);
    makeClickable(card, false);
    if (img.dataset.dognerdOriginal === undefined) return;
    if (revertSrc) img.src = img.dataset.dognerdOriginal;
    delete img.dataset.dognerdOriginal;
    delete img.dataset.dognerd;
  }

  function placeholder(entry) {
    const img = el("img", { className: gameClass("ItemCard_icon"), alt: "???", src: spriteUrl(entry.sprite ?? QUESTION_MARK) });
    img.dataset.dognerdOriginal = QUESTION_MARK;
    img.dataset.dognerd = entry.name;
    const className = `${gameClass("ItemCard_card")} ${gameClass("ItemCard_unknown")} ${PLACEHOLDER} ${SILHOUETTE}`;
    const card = el("div", { className }, [
      el("div", { className: gameClass("ItemCard_iconWrap") }, [img]),
      el("p", { className: gameClass("ItemCard_name"), textContent: "???" }),
    ]);
    card.dataset.dognerdSlot = entry.name;
    makeClickable(card, true);
    return card;
  }

  const precedes = (a, b) => {
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
    return false;
  };

  function syncPlaceholders(section) {
    const { slots, unseen } = COLLECTIONS[section];
    const grid = document.querySelector('[class*="ItemGrid_grid__"]');
    const placeholders = () => [...document.querySelectorAll(`.${PLACEHOLDER}`)];
    if (unseen !== "hidden" || !grid) {
      placeholders().forEach((n) => n.remove());
      return;
    }
    const gameCards = [...grid.children].filter((c) => hasClass(c, "ItemCard_card") && !c.classList.contains(PLACEHOLDER));

    const taken = new Set();
    const claimSlot = (card) => {
      const src = card.querySelector("img")?.getAttribute("src");
      const name = norm(card.querySelector('[class*="ItemCard_name__"]')?.textContent ?? "");
      const find = (test) => slots.findIndex((s, i) => !taken.has(i) && test(s));
      let i = find((s) => s.sprite === src);
      if (i < 0) i = find((s) => norm(s.name) === name);
      if (i >= 0) taken.add(i);
      return i;
    };

    // Sort keys: [slot], or when grouped [-group, 0 for game cards / 1 for placeholders, slot].
    const grouped = slots.some((s) => s.group !== undefined);
    const groupOf = (card) =>
      Number(/-?\d+/.exec(card.querySelector('[class*="ItemCard_nameSubtitle__"]')?.textContent ?? "")?.[0] ?? 0);
    const gameKeys = [];
    for (const card of gameCards) {
      const i = claimSlot(card);
      if (i >= 0) cardEntries.set(card, slots[i]);
      else if (!grouped) {
        const name = card.querySelector('[class*="ItemCard_name__"]')?.textContent ?? "";
        warnOnce(`unknown:${section}:${name}`, `${section}: "${name}" is not in the data, can't place the missing entries.`);
        placeholders().forEach((n) => n.remove());
        return;
      }
      gameKeys.push(grouped ? [-groupOf(card), 0, 0] : [i]);
    }
    const missing = slots.flatMap((s, i) => (taken.has(i) ? [] : [{ slot: s, key: grouped ? [-s.group, 1, i] : [i] }]));

    const wanted = [];
    let next = 0;
    gameCards.forEach((card, r) => {
      while (next < missing.length && precedes(missing[next].key, gameKeys[r])) wanted.push(missing[next++].slot);
      wanted.push(card);
    });
    for (; next < missing.length; next++) wanted.push(missing[next].slot);

    const existing = new Map(placeholders().map((n) => [n.dataset.dognerdSlot, n]));
    const slotKey = (s) => `${s.name}|${s.sprite}`;
    const sequence = wanted.map((w) => {
      if (w instanceof Element) return w;
      const node = existing.get(slotKey(w)) ?? placeholder(w);
      node.dataset.dognerdSlot = slotKey(w);
      cardEntries.set(node, w);
      return node;
    });
    for (const node of existing.values()) if (!sequence.includes(node)) node.remove();

    const current = [...grid.children].filter((c) => hasClass(c, "ItemCard_card"));
    if (current.length === sequence.length && current.every((c, i) => c === sequence[i])) return;
    sequence.forEach((node, i) => {
      if (!node.classList.contains(PLACEHOLDER)) return;
      const nextGameCard = sequence.slice(i + 1).find((n) => !n.classList.contains(PLACEHOLDER));
      grid.insertBefore(node, nextGameCard ?? null);
    });
  }

  function applySilhouettes(section) {
    const { slots: entries, unseen } = COLLECTIONS[section];
    const all = cards();
    if (!all.length || unseen === "hidden") return;
    if (all.length !== entries.length) {
      warnOnce(
        `count:${section}:${all.length}`,
        `${section}: page has ${all.length} slots but data has ${entries.length} entries, sprites may be misplaced.`,
      );
    }

    all.forEach((card, i) => {
      const img = card.querySelector('img[class*="ItemCard_icon__"]');
      if (!img || card.classList.contains(PLACEHOLDER)) return;
      const entry = entries[i];

      if (hasClass(card, "ItemCard_unknown")) {
        if (entry) silhouette(card, img, entry);
        return;
      }
      if (card.classList.contains(SILHOUETTE)) restore(card, img, false);
      const name = card.querySelector('[class*="ItemCard_name__"]')?.textContent ?? "";
      if (entry && norm(name) !== norm(entry.name)) {
        warnOnce(
          `order:${section}:${i}`,
          `${section}: slot ${i} is "${name}" but data expects "${entry.name}". Fix the order of data/${section}.json.`,
        );
      }
    });
  }

  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.dognerdOriginal === undefined) return;
      warnOnce(`img:${img.src}`, `failed to load sprite for "${img.dataset.dognerd}": ${img.src}`);
      const card = img.closest(`.${SILHOUETTE}`);
      if (card) restore(card, img, true);
      img.dataset.dognerdFailed = "";
    },
    true,
  );

  function obtainSection(entry) {
    return el("div", { className: OBTAIN }, [
      el("h3", { textContent: "Where to find" }),
      ...entry.obtain.flatMap(({ where, details }) => {
        const isPlainText = !where && (details.length === 1 || details.every(([label]) => !label));
        if (isPlainText) return details.map(([, value]) => el("p", { textContent: value }));
        return el("section", {}, [
          ...(where ? [el("h4", { textContent: where })] : []),
          el(
            "dl",
            {},
            details.flatMap(([label, value]) => [el("dt", { textContent: label }), el("dd", { textContent: value })]),
          ),
        ]);
      }),
    ]);
  }

  let clickedEntry = null;

  function decorateGameDialog() {
    const body = document.querySelector(`[role="dialog"]:not(.dognerd-dialog) [class*="Dialog_body__"]`);
    if (!body || body.querySelector(`.${OBTAIN}`) || !clickedEntry?.obtain?.length) return;
    const title = body.querySelector("h2")?.textContent ?? "";
    if (norm(title) !== norm(clickedEntry.name)) return;
    body.append(obtainSection(clickedEntry));
  }

  function openUnknownDialog(card, entry) {
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      card.focus();
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };

    const closeButton = el("button", {
      type: "button",
      className: [gameClass("Button_button"), gameClass("Button_neutral"), gameClass("ButtonGroup_buttonContainer")].join(" "),
      textContent: "Close",
      onclick: close,
    });
    const dialog = el(
      "div",
      {
        className: `${gameClass("Dialog_content")} dognerd-dialog`,
        role: "dialog",
        ariaModal: "true",
        ariaLabel: "Uncaught entry",
        tabIndex: -1,
      },
      [
        el("div", { className: gameClass("Dialog_modalBody") }, [
          el("div", { className: gameClass("Dialog_body") }, [
            el("img", { className: gameClass("CollectionGrid_previewImage"), alt: "???", src: spriteUrl(entry.sprite) }),
            el("h2", { textContent: "???" }),
            el("p", { className: gameClass("CollectionGrid_description"), textContent: "???" }),
            ...(entry.obtain?.length ? [obtainSection(entry)] : []),
          ]),
          el("div", { className: gameClass("ButtonGroup_groupContainer") }, [
            el("div", { className: gameClass("ButtonGroup_rowContainer") }, [closeButton]),
          ]),
        ]),
      ],
    );
    const overlay = el(
      "div",
      {
        className: `${gameClass("Dialog_overlay")} dognerd-dialog-overlay`,
        onclick: (e) => e.target === overlay && close(),
      },
      [dialog],
    );
    overlay.dataset.state = dialog.dataset.state = "open";
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    closeButton.focus();
  }

  document.addEventListener(
    "click",
    (e) => {
      const card = e.target.closest?.('[class*="ItemCard_card__"]');
      if (!card || !currentSection()) return;
      const entry = entryFor(card);
      clickedEntry = entry ?? null;
      if (entry && card.classList.contains(SILHOUETTE)) openUnknownDialog(card, entry);
    },
    true,
  );

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest?.(`.${SILHOUETTE}`);
    if (!card) return;
    e.preventDefault();
    card.click();
  });

  function undoAll() {
    document.querySelectorAll(`.${PLACEHOLDER}, .${OBTAIN}`).forEach((n) => n.remove());
    for (const card of document.querySelectorAll(`.${SILHOUETTE}`)) restore(card, card.querySelector("img"), true);
  }

  let enabled = true;
  watchSetting("collection", (on) => {
    enabled = on;
    schedule();
  });

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!enabled) return undoAll();
      const section = currentSection();
      if (!section) return;
      syncPlaceholders(section);
      applySilhouettes(section);
      decorateGameDialog();
    });
  }

  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "src"],
  });
  schedule();

  onData(() => {
    document.querySelectorAll(`.${PLACEHOLDER}`).forEach((n) => n.remove());
    schedule();
  });
})();
