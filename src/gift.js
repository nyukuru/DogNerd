(() => {
  "use strict";

  const { el, warnOnce, query, loadStyles, gameClass: g, watchSetting } = DogNerd;

  const ROUTE = /^\/send-item\/?$/;
  const BAR = "dognerd-gift-bar";
  const EMPTY = "dognerd-gift-empty";
  const HIDDEN = "dognerd-gift-hidden";
  const COUNT = "dognerd-gift-count";
  const HINT = "dognerd-gift-hint";
  const PICKER = "dognerd-gift-picker";
  const OTHER = "other";
  const TYPES = [
    ["all", "All Types"], ["cosmetic", "Cosmetics"], ["food", "Food"], ["book", "Books"], ["fish", "Fish"], ["gem", "Gems"],
    ["bug", "Bugs"], ["bait", "Bait"], ["toy", "Toys"], ["combat", "Combat"], ["crop", "Crops"], ["seed", "Seeds"],
    ["petpet", "Dogpets"], ["decoration", "Decorations"],
  ];
  const group = (item) => {
    const ranks = [...item.categories, ...(item.petpet ? ["petpet"] : [])].map((t) => TYPES.findIndex(([value]) => value === t)).filter((r) => r > 0);
    return ranks.length ? Math.min(...ranks) : TYPES.length;
  };
  const SORTS = {
    type: ["Type", (a, b) => group(a) - group(b)],
    "name-asc": ["Name (A-Z)", (a, b) => a.name.localeCompare(b.name)],
    "name-desc": ["Name (Z-A)", (a, b) => b.name.localeCompare(a.name)],
    "quantity-desc": ["Quantity (High-Low)", (a, b) => b.count - a.count],
    "quantity-asc": ["Quantity (Low-High)", (a, b) => a.count - b.count],
    "price-desc": ["Price (High-Low)", (a, b) => b.price - a.price],
    "price-asc": ["Price (Low-High)", (a, b) => a.price - b.price],
  };

  let enabled = true;
  let styled = false;
  let loaded = false;
  // name -> sendable item
  let items = null;
  // {myFriendCode, buddies: [{friendCode, username}], requests: [{friendCode, dogName}]}
  let buddies = null;
  // {code, item} of the last send, for the game's success message.
  let sent = null;

  watchSetting("gift", (on) => {
    enabled = on;
    schedule();
  });

  function load() {
    query("sendItem.sendableItems")
      .then((list) => {
        items = new Map(list.map((i) => [i.name, i]));
        schedule();
      })
      .catch((e) => warnOnce("gift-items", "couldn't load the sendable items:", e.message));
    query("buddies.getState")
      .then((state) => {
        buddies = state;
        schedule();
      })
      .catch((e) => warnOnce("gift-buddies", "couldn't load the buddy list:", e.message));
    loadStyles("/doghouse")
      .catch((e) => warnOnce("gift-styles", "couldn't load the search bar styles:", e.message))
      .finally(() => {
        styled = true;
        schedule();
      });
  }

  function recipient(code) {
    if (!buddies || code.length < 8) return null;
    if (code === buddies.myFriendCode) return { text: "That's your own friend code." };
    const buddy = buddies.buddies.find((b) => b.friendCode === code);
    if (buddy) return { text: `Sending to ${buddy.username}`, name: buddy.username };
    const request = buddies.requests.find((r) => r.friendCode === code);
    if (request) return { text: `Sending to ${request.dogName ?? "someone"}'s owner (buddy request)` };
    return { text: "Not on your buddy list, so the name can't be checked.", warn: true };
  }

  function bar() {
    const select = (label, options) =>
      el("div", { className: g("Select_group") }, [
        el("select", { className: g("Select_select"), ariaLabel: label }, options.map(([value, text]) => el("option", { value, textContent: text }))),
      ]);
    return el("div", { className: `${g("ItemSortFilterBar_optionsBar")} ${BAR}` }, [
      el("div", { className: g("Input_group") }, [
        el("input", { className: g("Input_input"), ariaLabel: "Search items", placeholder: "Search items..." }),
      ]),
      select("Filter", TYPES),
      select("Sort", Object.entries(SORTS).map(([value, [text]]) => [value, text])),
    ]);
  }

  function showCards(form, options) {
    const grid = form.querySelector('[class*="ItemGrid_grid__"]');
    if (!grid) return;
    const search = options.querySelector("input").value.trim().toLowerCase();
    const [type, sort] = [...options.querySelectorAll("select")].map((s) => s.value);
    const cards = [...grid.children].map((node) => ({ node, item: items.get(node.querySelector('[class*="ItemCard_name__"]')?.textContent) }));
    const shown = (item) => item.name.toLowerCase().includes(search) && (type === "all" || item.categories.includes(type));
    let visible = 0;
    for (const { node, item } of cards) {
      if (!item) continue;
      const wrap = node.querySelector('[class*="ItemCard_iconWrap__"]');
      if (item.count > 1 && !wrap.querySelector(`.${COUNT}`)) {
        wrap.append(el("span", { className: `${g("ItemCard_badge")} ${COUNT}`, textContent: `x${item.count}` }));
      }
      const hide = !shown(item) && !node.matches('[class*="ItemCard_selected__"]');
      node.classList.toggle(HIDDEN, hide);
      if (!hide) visible++;
    }
    const sorted = cards.filter((c) => c.item).sort((a, b) => SORTS[sort][1](a.item, b.item) || a.item.name.localeCompare(b.item.name));
    sorted.forEach(({ node }, n) => (node.style.order = String(n)));
    let empty = form.querySelector(`.${EMPTY}`);
    if (!empty) grid.after((empty = el("p", { className: EMPTY, textContent: "No items found." })));
    empty.hidden = visible > 0;
  }

  // React ignores input events unless the value changed behind its tracker.
  function setCode(input, code) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function picker(input) {
    const list = [...buddies.buddies].sort((a, b) => a.username.localeCompare(b.username));
    const code = input.value.trim();
    const select = el("select", { className: g("Select_select"), id: `${PICKER}-select` }, [
      el("option", { value: "", textContent: "Choose a buddy" }),
      ...list.map((b) => el("option", { value: b.friendCode, textContent: b.username })),
      el("option", { value: OTHER, textContent: "Someone else (friend code)" }),
    ]);
    // ?friendcode= from the buddy list fills the game's input before this exists.
    select.value = !code || list.some((b) => b.friendCode === code) ? code : OTHER;
    select.onchange = () => {
      setCode(input, select.value === OTHER ? "" : select.value);
      schedule();
      if (select.value === OTHER) requestAnimationFrame(() => input.focus());
    };
    return el("div", { className: `${g("Select_group")} ${PICKER}` }, [
      el("label", { className: g("Select_label"), htmlFor: `${PICKER}-select`, textContent: "Send To" }),
      select,
    ]);
  }

  function showPicker(form) {
    const group = form.querySelector(':scope > [class*="Input_group__"]');
    const input = group?.querySelector("input");
    if (!input || !buddies?.buddies.length) return;
    let node = form.querySelector(`.${PICKER}`);
    if (!node) node = picker(input);
    if (group.previousElementSibling !== node) group.before(node);
    group.classList.toggle(HIDDEN, node.querySelector("select").value !== OTHER);
  }

  function showHint(form) {
    const group = form.querySelector(':scope > [class*="Input_group__"]');
    const input = group?.querySelector("input");
    if (!input) return;
    const found = recipient(input.value.trim());
    let hint = group.querySelector(`.${HINT}`);
    if (!found) return hint?.remove();
    if (!hint) group.append((hint = el("small", { className: `${g("Input_hint")} ${HINT}` })));
    hint.textContent = found.text;
    hint.classList.toggle("dognerd-gift-warn", !!found.warn);
  }

  function showSent(container) {
    const message = container.querySelector('[class*="ResultMessage_success__"] > p');
    if (!sent || !message) return;
    const text = `You sent ${sent.item} to ${recipient(sent.code)?.name ?? sent.code}!`;
    if (message.textContent !== text) message.textContent = text;
  }

  function show() {
    const container = document.querySelector('[class*="send-item_container__"]');
    if (!container) return;
    showSent(container);
    const form = container.querySelector('form[class*="send-item_form__"]');
    let options = container.querySelector(`.${BAR}`);
    if (!form) return options?.remove();
    showHint(form);
    if (!styled) return;
    showPicker(form);
    if (!items) return;
    if (!options) options = bar();
    if (form.previousElementSibling !== options) form.before(options);
    showCards(form, options);
  }

  function hide() {
    document.querySelector(`.${BAR}`)?.remove();
    document.querySelectorAll(`.${EMPTY}, .${COUNT}, .${HINT}, .${PICKER}`).forEach((n) => n.remove());
    document.querySelectorAll(`.${HIDDEN}`).forEach((n) => n.classList.remove(HIDDEN));
    document.querySelectorAll('[class*="send-item_form__"] [class*="ItemCard_card__"]').forEach((n) => (n.style.order = ""));
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const onRoute = ROUTE.test(location.pathname);
      if (!onRoute) loaded = false;
      if (!enabled || !onRoute) {
        sent = null;
        hide();
        return;
      }
      if (!loaded) {
        loaded = true;
        load();
      }
      show();
    });
  }

  document.addEventListener(
    "submit",
    (e) => {
      if (!enabled || !e.target.matches?.('[class*="send-item_form__"]')) return;
      const item = e.target.querySelector('[class*="ItemCard_selected__"] [class*="ItemCard_name__"]')?.textContent;
      const code = e.target.querySelector(':scope > [class*="Input_group__"] input')?.value.trim();
      if (item && code) sent = { item, code };
    },
    true,
  );
  document.addEventListener("input", schedule, true);
  document.addEventListener("change", schedule, true);
  document.addEventListener("click", schedule, true);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
