(() => {
  "use strict";

  const { el, warnOnce, query, spriteUrl, watchSetting } = DogNerd;

  const ROUTE = /^\/tower\/?$/;
  const MAZE_KEY = "cheeseMaze";
  const MAP = '[class*="tower_tuiMap__"]';
  const MAP_GRID = '[class*="tower_mapGrid__"]';
  const NOTHING = "/img/tower/tower_map_nothing.png";
  const VIEW = { cols: 9, rows: 8, gap: 2 };
  const TILES = {
    nothing: NOTHING,
    room: "/img/tower/tower_map_empty.png",
    cheese: "/img/tower/tower_map_unknown.png",
    player: "/img/tower/tower_map_player.gif",
  };
  const STEPS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const KINDS = { "#": "room", C: "chest", Q: "cheese" };

  // data/cheesemaze.json: rows of "." (wall), "#" (room), "C" (chest), "Q" (cheese), start is [x, y].
  let grid = null;
  // at is the [x, y] the player is standing on.
  let maze = null;
  let latestUi = null;

  const tile = (x, y) => grid.rows[y]?.[x] ?? ".";
  const isRoom = (x, y) => tile(x, y) !== ".";

  // The cheese maze blanks every map tile, events hide the map but keep the tiles.
  const inMaze = (ui) => !!ui?.map && ui.map.images.flat().every((src) => src === NOTHING);

  Promise.all([
    fetch(browser.runtime.getURL("data/cheesemaze.json")).then((res) => res.json()),
    browser.storage.local.get(MAZE_KEY),
  ])
    .then(async ([data, stored]) => {
      grid = data;
      maze ??= stored[MAZE_KEY] ?? null;
      if (ROUTE.test(location.pathname)) onState(await query("tower.getState"), null);
    })
    .catch((e) => warnOnce("maze-load", "couldn't load the cheese maze:", e.message));

  function save() {
    browser.storage.local.set({ [MAZE_KEY]: maze }).catch((e) => warnOnce("maze-save", "couldn't save the maze:", e.message));
  }

  function onState(data, turn) {
    if (!grid) return;
    const previous = latestUi;
    const ui = data?.state === "active" ? (data.ui ?? null) : null;
    latestUi = ui;
    schedule();
    if (!inMaze(ui)) {
      if (maze && data?.state) {
        maze = null;
        save();
      }
      return;
    }

    // Only a maze entered while watching is followed, otherwise the position isn't known.
    let at = maze?.at ?? (previous && !inMaze(previous) ? grid.start : null);
    if (!at) return;
    const dir = turn?.replace(/^move-/, "");
    const step = STEPS[dir];
    const controls = previous?.directionControls;
    if (step && controls?.visible && controls.validDirs[dir] && isRoom(at[0] + step[0], at[1] + step[1])) {
      at = [at[0] + step[0], at[1] + step[1]];
    }
    if (JSON.stringify({ at }) === JSON.stringify(maze)) return;
    maze = { at };
    save();
  }

  function turnsOf(body) {
    try {
      const batch = JSON.parse(body);
      // {"0": {"json": {"turn": "move-up"}}}
      return Object.keys(batch).map((i) => batch[i]?.json?.turn ?? null);
    } catch {
      return [];
    }
  }

  document.addEventListener("dognerd:tower", (e) => {
    try {
      const { procedures, body, text } = JSON.parse(e.detail);
      const results = JSON.parse(text);
      const turns = turnsOf(body);
      procedures.forEach((procedure, i) => {
        const result = results?.[i]?.result;
        if (!result) return;
        if (procedure === "tower.start" || procedure === "tower.forfeit") {
          maze = null;
          save();
        } else if (procedure === "tower.getState") {
          onState(result.data?.json, null);
        } else if (procedure === "tower.takeTurn") {
          onState(result.data?.json, turns[i]);
        }
      });
    } catch (err) {
      warnOnce("maze-fetch", "couldn't follow a tower request:", err.message);
    }
  });

  function setData(node, key, value) {
    if (value) {
      if (node.dataset[key] !== value) node.dataset[key] = value;
    } else if (node.dataset[key]) {
      delete node.dataset[key];
    }
  }

  function zoomedGrid(mapGrid) {
    let view = mapGrid.parentElement.querySelector(":scope > .dognerd-maze-grid");
    if (view) return view;
    const cells = Array.from({ length: VIEW.cols * VIEW.rows }, () => el("div", { className: "dognerd-maze-cell" }));
    view = el("div", { className: "dognerd-maze-grid" }, cells);
    view.style.gridTemplate = `repeat(${VIEW.rows}, 1fr) / repeat(${VIEW.cols}, 1fr)`;
    view.style.gap = `${VIEW.gap}px`;
    view.style.setProperty("--dognerd-maze-gem", `url("${browser.runtime.getURL("img/icons/gem.svg")}")`);
    for (const [kind, src] of Object.entries(TILES)) {
      view.style.setProperty(`--dognerd-maze-${kind}`, `url("${spriteUrl(src)}")`);
    }
    mapGrid.after(view);
    return view;
  }

  function showMaze() {
    const map = document.querySelector(MAP);
    const mapGrid = map?.querySelector(MAP_GRID);
    if (!mapGrid) return;
    const here = inMaze(latestUi) ? (maze?.at ?? null) : null;
    if (!here) {
      mapGrid.parentElement.querySelector(":scope > .dognerd-maze-grid")?.remove();
      return;
    }

    const view = zoomedGrid(mapGrid);
    Object.assign(view.style, {
      top: `${mapGrid.offsetTop}px`,
      left: `${mapGrid.offsetLeft}px`,
      width: `${mapGrid.offsetWidth}px`,
      height: `${mapGrid.offsetHeight}px`,
    });
    view.querySelectorAll(":scope > .dognerd-maze-cell").forEach((cell, i) => {
      const x = here[0] + (i % VIEW.cols) - Math.floor(VIEW.cols / 2);
      const y = here[1] + Math.floor(i / VIEW.cols) - Math.floor(VIEW.rows / 2);
      const kind = x === here[0] && y === here[1] ? "player" : KINDS[tile(x, y)];
      setData(cell, "dognerdMaze", kind);
    });
  }

  let enabled = true;
  watchSetting("maze", (on) => {
    enabled = on;
    schedule();
  });

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!enabled) document.querySelectorAll(".dognerd-maze-grid").forEach((n) => n.remove());
      else if (grid && ROUTE.test(location.pathname)) showMaze();
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  addEventListener("resize", schedule);
})();
