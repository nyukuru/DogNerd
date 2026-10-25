(() => {
  "use strict";

  const { el, warnOnce, query, spriteUrl } = DogNerd;

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
  const SVG = "http://www.w3.org/2000/svg";
  // The room tile's dark outline and corner radius, as fractions of the tile width.
  const OUTLINE = 4 / 72;
  const CORNER = 8 / 72;

  // data/cheesemaze.json: rows of "." (wall), "#" (room), "C" (chest), "Q" (cheese), start is [x, y].
  let grid = null;
  // cells holds every [x, y] the player could be standing on, opened lists "x,y" of emptied chests.
  let maze = null;
  let latestUi = null;

  const tile = (x, y) => grid.rows[y]?.[x] ?? ".";
  const isRoom = (x, y) => tile(x, y) !== ".";
  const fits = ([x, y], dirs) => Object.entries(STEPS).every(([d, [dx, dy]]) => isRoom(x + dx, y + dy) === !!dirs[d]);
  const allRooms = () => grid.rows.flatMap((row, y) => [...row].flatMap((t, x) => (t === "." ? [] : [[x, y]])));
  const tilesOf = (kind) => allRooms().filter(([x, y]) => tile(x, y) === kind);

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

  function locate(cells, ui) {
    const controls = ui.directionControls;
    if (!controls?.visible) return cells;
    const atStart = ([x, y]) => x === grid.start[0] && y === grid.start[1];
    const fitting = cells.filter((c) => fits(c, controls.validDirs));
    if (fitting.length > 1 && fitting.some(atStart)) return [grid.start];
    if (fitting.length) return fitting;
    if (fits(grid.start, controls.validDirs)) return [grid.start];
    const anywhere = allRooms().filter((c) => fits(c, controls.validDirs));
    return anywhere.length ? anywhere : cells;
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

    let cells = maze?.cells ?? [grid.start];
    let opened = maze?.opened ?? [];
    const dir = turn?.replace(/^move-/, "");
    const step = STEPS[dir];
    const controls = previous?.directionControls;
    if (step && controls?.visible && controls.validDirs[dir]) {
      cells = cells.map(([x, y]) => [x + step[0], y + step[1]]).filter(([x, y]) => isRoom(x, y));
      if (!cells.length) cells = allRooms();
    }
    if (ui.treasureButtons?.visible) {
      const chests = cells.filter(([x, y]) => tile(x, y) === "C");
      cells = chests.length ? chests : tilesOf("C");
    }
    if (turn === "open-treasue-chest" && cells.length === 1 && tile(...cells[0]) === "C") {
      opened = [...new Set([...opened, cells[0].join()])];
    }
    cells = locate(cells, ui);
    if (JSON.stringify({ cells, opened }) === JSON.stringify(maze)) return;
    maze = { cells, opened };
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

  function routes(from, targets) {
    const came = new Map([[from.join(), null]]);
    const queue = [from];
    for (const [x, y] of queue) {
      for (const [dx, dy] of Object.values(STEPS)) {
        const next = [x + dx, y + dy];
        if (!isRoom(...next) || came.has(next.join())) continue;
        came.set(next.join(), [x, y]);
        queue.push(next);
      }
    }
    return targets
      .filter((t) => came.has(t.join()))
      .map((t) => {
        const path = [];
        for (let at = t; at; at = came.get(at.join())) path.unshift(at);
        return path;
      });
  }

  function showNote(map, text) {
    let note = map?.querySelector(":scope > .dognerd-maze-note");
    if (!map || !text) {
      note?.remove();
      return;
    }
    if (!note) map.append((note = el("div", { className: "dognerd-maze-note" })));
    if (note.textContent !== text) note.textContent = text;
  }

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
    const lines = document.createElementNS(SVG, "svg");
    lines.classList.add("dognerd-maze-lines");
    view.append(lines);
    mapGrid.after(view);
    return view;
  }

  function svg(tag, attrs) {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function drawLines(view, here, paths) {
    const lines = view.querySelector(":scope > .dognerd-maze-lines");
    const width = view.offsetWidth;
    const height = view.offsetHeight;
    const cellWidth = (width - (VIEW.cols - 1) * VIEW.gap) / VIEW.cols;
    const cellHeight = (height - (VIEW.rows - 1) * VIEW.gap) / VIEW.rows;
    const outline = cellWidth * OUTLINE;
    const point = ([x, y]) => {
      const col = x - here[0] + Math.floor(VIEW.cols / 2);
      const row = y - here[1] + Math.floor(VIEW.rows / 2);
      return `${Math.round(col * (cellWidth + VIEW.gap) + cellWidth / 2)},${Math.round(row * (cellHeight + VIEW.gap) + cellHeight / 2)}`;
    };
    const sig = JSON.stringify([width, height, here, paths]);
    if (lines.dataset.sig === sig) return;
    lines.dataset.sig = sig;
    lines.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const clip = svg("clipPath", { id: "dognerd-maze-clip" });
    for (let row = 0; row < VIEW.rows; row++) {
      for (let col = 0; col < VIEW.cols; col++) {
        clip.append(
          svg("rect", {
            x: col * (cellWidth + VIEW.gap) + outline,
            y: row * (cellHeight + VIEW.gap) + outline,
            width: cellWidth - 2 * outline,
            height: cellHeight - 2 * outline,
            rx: cellWidth * CORNER,
          }),
        );
      }
    }
    const drawn = svg("g", { "clip-path": "url(#dognerd-maze-clip)" });
    drawn.append(
      ...paths.map(({ kind, path }) =>
        svg("polyline", { class: `dognerd-maze-line-${kind}`, points: path.map(point).join(" ") }),
      ),
    );
    lines.replaceChildren(svg("defs", {}), drawn);
    lines.firstChild.append(clip);
  }

  function showMaze() {
    const map = document.querySelector(MAP);
    const mapGrid = map?.querySelector(MAP_GRID);
    if (!mapGrid) return;
    const cells = inMaze(latestUi) ? (maze?.cells ?? []) : [];
    const here = cells.length === 1 ? cells[0] : null;
    showNote(map, cells.length > 1 ? `Cheese maze: move around to find yourself (${cells.length} spots)` : null);
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
    const opened = new Set(maze.opened ?? []);
    view.querySelectorAll(":scope > .dognerd-maze-cell").forEach((cell, i) => {
      const x = here[0] + (i % VIEW.cols) - Math.floor(VIEW.cols / 2);
      const y = here[1] + Math.floor(i / VIEW.cols) - Math.floor(VIEW.rows / 2);
      let kind = x === here[0] && y === here[1] ? "player" : KINDS[tile(x, y)];
      if (kind === "chest" && opened.has(`${x},${y}`)) kind = "opened";
      setData(cell, "dognerdMaze", kind);
    });

    const chests = tilesOf("C").filter((c) => !opened.has(c.join()));
    const paths = [
      ...routes(here, chests).map((path) => ({ kind: "chest", path })),
      ...routes(here, tilesOf("Q")).map((path) => ({ kind: "cheese", path })),
    ];
    drawLines(view, here, paths);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (grid && ROUTE.test(location.pathname)) showMaze();
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  addEventListener("resize", schedule);
})();
