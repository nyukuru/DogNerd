(() => {
  "use strict";

  const { COLLECTIONS, onData, hasClass, norm, warnOnce, gameClass, el, spriteUrl } = DogNerd;

  const ROUTE = /^\/collection\/(?:.+\/)?([a-z]+)\/?$/;
  const SILHOUETTE = "dognerd-silhouette";
  const GUESS = "dognerd-guess";
  const OBTAIN = "dognerd-obtain";
  const PLACEHOLDER = "dognerd-placeholder";
  const OUTLINE = "dognerd-outline";
  const QUESTION_MARK = "/img/wiggle-icon-question-mark.gif";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const OUTLINE_WIDTH = 2;
  const SHARED_EDGE_INSET = 1.5;

  function currentSection() {
    const m = location.pathname.match(ROUTE);
    return m && COLLECTIONS[m[1]] ? m[1] : null;
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

  function svg(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    node.append(...children);
    return node;
  }

  // Merges the [from, to] pieces of the line where keep(insideA, insideB) holds.
  function combineIntervals(a, b, keep) {
    const points = [...new Set([...a, ...b].flat())].sort((x, y) => x - y);
    const inside = (set, x) => set.some(([from, to]) => from < x && x < to);
    const out = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const mid = (points[i] + points[i + 1]) / 2;
      if (!keep(inside(a, mid), inside(b, mid))) continue;
      if (out.length && out.at(-1)[1] === points[i]) out.at(-1)[1] = points[i + 1];
      else out.push([points[i], points[i + 1]]);
    }
    return out;
  }

  // Each card's cell extends halfway to its neighbours so adjacent cells touch.
  function gridCells(rects) {
    const rows = [];
    rects.forEach((r, i) => {
      const row = rows.at(-1);
      if (row && Math.abs(rects[row[0]].t - r.t) < 1) row.push(i);
      else rows.push([i]);
    });
    const top = (row) => Math.min(...row.map((i) => rects[i].t));
    const bottom = (row) => Math.max(...row.map((i) => rects[i].b));
    const cells = [];
    rows.forEach((row, ri) => {
      const t = ri ? (bottom(rows[ri - 1]) + top(row)) / 2 : top(row);
      const b = ri < rows.length - 1 ? (bottom(row) + top(rows[ri + 1])) / 2 : bottom(row);
      row.forEach((i, k) => {
        const l = k ? (rects[row[k - 1]].r + rects[i].l) / 2 : rects[i].l;
        const r = k < row.length - 1 ? (rects[i].r + rects[row[k + 1]].l) / 2 : rects[i].r;
        cells[i] = { l, t, r, b };
      });
    });
    return { rows, cells };
  }

  // Boundary edges per block, directed so the block is on their right.
  function blockEdges(rows, cells, blockOf, blockCount) {
    const edges = Array.from({ length: blockCount }, () => []);
    const addEdge = (bi, x1, y1, x2, y2, shared) =>
      edges[bi].push({ x1, y1, x2, y2, inset: shared ? SHARED_EDGE_INSET : 0 });

    for (const row of rows) {
      row.forEach((i, k) => {
        const c = cells[i];
        const bi = blockOf[i];
        const isFirst = k === 0;
        const isLast = k === row.length - 1;
        if (isFirst || blockOf[row[k - 1]] !== bi) addEdge(bi, c.l, c.b, c.l, c.t, !isFirst);
        if (isLast || blockOf[row[k + 1]] !== bi) addEdge(bi, c.r, c.t, c.r, c.b, !isLast);
      });
    }

    const spans = (row, bi) => row.filter((i) => bi === undefined || blockOf[i] === bi).map((i) => [cells[i].l, cells[i].r]);
    for (let ri = 0; ri <= rows.length; ri++) {
      const above = rows[ri - 1] ?? [];
      const below = rows[ri] ?? [];
      const y = below.length ? cells[below[0]].t : cells[above[0]].b;
      for (let bi = 0; bi < blockCount; bi++) {
        const own = [spans(above, bi), spans(below, bi)];
        const across = [spans(below), spans(above)];
        // side 0: bottom edges of the row above (right to left); side 1: top edges of the row below (left to right).
        for (const side of [0, 1]) {
          const ends = combineIntervals(own[side], own[1 - side], (a, b) => a && !b);
          for (const shared of [true, false]) {
            for (const [from, to] of combineIntervals(ends, across[side], (a, b) => a && b === shared)) {
              if (side === 0) addEdge(bi, to, y, from, y, shared);
              else addEdge(bi, from, y, to, y, shared);
            }
          }
        }
      }
    }
    return edges;
  }

  const resizeWatched = new WeakSet();

  function renderOutlines(section) {
    const { blocks, slots } = COLLECTIONS[section];
    const all = cards();
    const grid = all[0]?.parentElement;
    const blockIndex = new Map(blocks.map((b, i) => [b.name, i]));
    const blockOf = slots.map((s) => blockIndex.get(s?.block));
    if (
      !grid ||
      !blocks.some((b) => b.color) ||
      blockOf.includes(undefined) ||
      all.length !== slots.length ||
      all.some((c) => c.parentElement !== grid)
    ) {
      document.querySelectorAll(`.${OUTLINE}`).forEach((n) => n.remove());
      return;
    }
    if (!resizeWatched.has(grid)) {
      resizeWatched.add(grid);
      new ResizeObserver(schedule).observe(grid);
    }

    const origin = grid.getBoundingClientRect();
    const rects = all.map((c) => {
      const r = c.getBoundingClientRect();
      return { l: r.left - origin.left, t: r.top - origin.top, r: r.right - origin.left, b: r.bottom - origin.top };
    });
    const signature = rects.map((r) => [r.l, r.t, r.r, r.b].map(Math.round).join(",")).join(";");
    let overlay = grid.querySelector(`:scope > .${OUTLINE}`);
    if (overlay?.dataset.signature === signature) return;

    const { rows, cells } = gridCells(rects);
    const edges = blockEdges(rows, cells, blockOf, blocks.length);
    const radius = parseFloat(getComputedStyle(grid.closest('[class*="Layout_main__"]') ?? grid).borderTopLeftRadius) || 6;

    overlay?.remove();
    overlay = svg(
      "svg",
      { class: OUTLINE, width: origin.width, height: origin.height, "aria-hidden": "true" },
      blocks.map((block, bi) =>
        svg("path", {
          d: outlineLoops(edges[bi]).map((loop) => roundedLoop(loop, radius)).join(""),
          fill: "none",
          stroke: block.color,
          "stroke-width": OUTLINE_WIDTH,
        }),
      ),
    );
    overlay.dataset.signature = signature;
    grid.append(overlay);
  }

  const direction = (e) => [Math.sign(e.x2 - e.x1), Math.sign(e.y2 - e.y1)];
  const cross = ([ax, ay], [bx, by]) => ax * by - ay * bx;
  const continues = (a, b) => a.inset === b.inset && direction(a).join() === direction(b).join();

  function outlineLoops(edges) {
    const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
    const startingAt = new Map();
    for (const e of edges) {
      const k = key(e.x1, e.y1);
      if (!startingAt.has(k)) startingAt.set(k, []);
      startingAt.get(k).push(e);
    }
    const used = new Set();
    const loops = [];
    for (const first of edges) {
      if (used.has(first)) continue;
      const loop = [];
      for (let e = first; e && !used.has(e); ) {
        used.add(e);
        const last = loop.at(-1);
        if (last && continues(last, e)) {
          last.x2 = e.x2;
          last.y2 = e.y2;
        } else loop.push({ ...e });
        // Where diagonal cells meet at a corner, take the leftmost turn.
        const candidates = (startingAt.get(key(e.x2, e.y2)) ?? []).filter((n) => !used.has(n));
        e = candidates.sort((a, b) => cross(direction(e), direction(a)) - cross(direction(e), direction(b)))[0];
      }
      const [head, tail] = [loop[0], loop.at(-1)];
      if (loop.length > 1 && continues(tail, head)) {
        head.x1 = tail.x1;
        head.y1 = tail.y1;
        loop.pop();
      }
      loops.push(loop);
    }
    return loops;
  }

  // Offsets each edge inward by its inset plus half the stroke, then rounds the corners.
  function roundedLoop(loop, radius) {
    const half = OUTLINE_WIDTH / 2;
    const corners = [];
    loop.forEach((e, i) => {
      const next = loop[(i + 1) % loop.length];
      const [dx, dy] = direction(e);
      const [nx, ny] = direction(next);
      const o1 = e.inset + half;
      const o2 = next.inset + half;
      const turn = cross([dx, dy], [nx, ny]);
      if (turn) {
        const r = turn > 0 ? radius - half : radius + half + 2 * Math.min(e.inset, next.inset);
        corners.push({ x: e.x2 - dy * o1 - ny * o2, y: e.y2 + dx * o1 + nx * o2, r, sweep: turn > 0 ? 1 : 0 });
      } else {
        // Straight continuation with a different inset: an S-shaped step.
        const sweepIn = o2 > o1 ? 1 : 0;
        corners.push({ x: e.x2 - dy * o1, y: e.y2 + dx * o1, r: radius, sweep: sweepIn });
        corners.push({ x: e.x2 - dy * o2, y: e.y2 + dx * o2, r: radius, sweep: 1 - sweepIn });
      }
    });
    const n = corners.length;
    const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const toward = (a, b, d) => {
      const len = dist(a, b) || 1;
      return `${a.x + ((b.x - a.x) * d) / len} ${a.y + ((b.y - a.y) * d) / len}`;
    };
    let d = "";
    corners.forEach((c, i) => {
      const prev = corners[(i + n - 1) % n];
      const next = corners[(i + 1) % n];
      const r = Math.max(0, Math.min(c.r, dist(prev, c) / 2, dist(c, next) / 2));
      d += `${i ? "L" : "M"}${toward(c, prev, r)}A${r} ${r} 0 0 ${c.sweep} ${toward(c, next, r)}`;
    });
    return `${d}Z`;
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const section = currentSection();
      if (!section) return;
      syncPlaceholders(section);
      applySilhouettes(section);
      renderOutlines(section);
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
    document.querySelectorAll(`.${PLACEHOLDER}, .${OUTLINE}`).forEach((n) => n.remove());
    schedule();
  });
})();
