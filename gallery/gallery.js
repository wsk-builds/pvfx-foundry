(() => {
  const FOUNDRY_ORDER = ["impacts", "melee", "explosions", "fire", "ice", "lightning", "arcane", "holy", "shadow", "nature", "water", "wind", "smoke", "status", "projectiles", "ui"];
  const LEGACY_ORDER = ["combat", "elemental", "defense", "support", "status", "arcane", "environment", "movement", "interface"];
  const LABELS = {
    impacts: "冲击", melee: "近战", explosions: "爆炸", fire: "火焰", ice: "冰霜", lightning: "闪电",
    arcane: "奥术", holy: "神圣", shadow: "暗影", nature: "自然", water: "水", wind: "风", smoke: "烟雾",
    status: "状态", projectiles: "弹道", ui: "界面", combat: "战斗", defense: "防御", elemental: "元素",
    environment: "环境", interface: "界面", movement: "移动", support: "辅助"
  };

  const state = {
    library: "foundry",
    tier: "lit",
    timing: "all",
    category: "all",
    scale: 3,
    checker: true,
    query: ""
  };

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const live = new Set();
  let effects = { foundry: [], legacy: [] };
  let selected = null;
  let detailPlayer = null;
  let observer = null;
  let builtFor = "";
  let lastTick = 0;

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const dialog = $("detail");

  function label(category) {
    return LABELS[category] || category;
  }

  function normalizeFoundry(effect) {
    return {
      key: `foundry:${effect.id}`,
      library: "foundry",
      id: effect.id,
      name: effect.name,
      description: effect.description || "",
      category: effect.category,
      tags: effect.tags || [],
      frames: effect.frames,
      frameMs: effect.frame_ms,
      loop: !!effect.loop,
      w: effect.size[0],
      h: effect.size[1],
      columns: 8,
      sheet(tier) {
        return `../${effect.artifacts[tier].grid.sheet}`;
      }
    };
  }

  function normalizeLegacy(effect) {
    return {
      key: `legacy:${effect.id}`,
      library: "legacy",
      id: effect.id,
      name: effect.display_name || effect.id,
      description: effect.description || "",
      category: effect.category,
      tags: effect.tags || [],
      frames: effect.frames,
      frameMs: 50,
      loop: effect.loop === "loop" || effect.loop === true,
      w: 96,
      h: 96,
      columns: 5,
      sheet() {
        return `../legacy/0.10.0/${effect.artifacts.grid.sheet}`;
      }
    };
  }

  function playableCount(effect) {
    return effect.loop ? effect.frames : Math.max(1, effect.frames - 1);
  }

  function matches(effect) {
    if (state.category !== "all" && effect.category !== state.category) return false;
    if (state.timing === "loop" && !effect.loop) return false;
    if (state.timing === "once" && effect.loop) return false;
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const hay = `${effect.name} ${effect.id} ${effect.description} ${effect.tags.join(" ")} ${label(effect.category)}`.toLowerCase();
    return hay.includes(q);
  }

  function makeButton(parent, text, value, pressed, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.dataset.value = String(value);
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
    button.addEventListener("click", onClick);
    parent.appendChild(button);
    return button;
  }

  function fillSeg(id, options, current, onPick) {
    const host = $(id);
    host.replaceChildren();
    for (const option of options) {
      makeButton(host, option.label, option.value, option.value === current, () => onPick(option.value));
    }
  }

  function press(id, value) {
    for (const button of $(id).querySelectorAll("button")) {
      button.setAttribute("aria-pressed", button.dataset.value === String(value) ? "true" : "false");
    }
  }

  function renderControls() {
    fillSeg("library", [
      { value: "foundry", label: "1.0 现行" },
      { value: "legacy", label: "0.10 旧版" }
    ], state.library, (value) => {
      if (value === state.library) return;
      state.library = value;
      state.category = "all";
      closeDetail();
      render();
    });

    const tierHost = $("tier");
    tierHost.hidden = state.library !== "foundry";
    if (state.library === "foundry") {
      fillSeg("tier", [
        { value: "lit", label: "明亮" },
        { value: "strict", label: "纯色" }
      ], state.tier, (value) => {
        if (value === state.tier) return;
        state.tier = value;
        render();
      });
    }

    fillSeg("timing", [
      { value: "all", label: "全部" },
      { value: "loop", label: "循环" },
      { value: "once", label: "单次" }
    ], state.timing, (value) => {
      state.timing = value;
      press("timing", value);
      applyFilter();
    });

    fillSeg("scale", [2, 3, 4].map((value) => ({ value, label: `${value}×` })), state.scale, (value) => {
      state.scale = Number(value);
      press("scale", state.scale);
      for (const player of live) layout(player);
    });

    $("checker").setAttribute("aria-pressed", state.checker ? "true" : "false");

    const order = state.library === "foundry" ? FOUNDRY_ORDER : LEGACY_ORDER;
    const present = new Set(effects[state.library].map((effect) => effect.category));
    const cats = $("cats");
    cats.replaceChildren();
    makeButton(cats, "全部", "all", state.category === "all", () => chooseCategory("all"));
    for (const category of order) {
      if (!present.has(category)) continue;
      makeButton(cats, label(category), category, state.category === category, () => chooseCategory(category));
    }
    cats.hidden = false;
    $("toolbar").hidden = false;
  }

  function chooseCategory(category) {
    state.category = category;
    press("cats", category);
    applyFilter();
  }

  function createPlayer(effect, canvas, stage, force) {
    const player = {
      effect,
      canvas,
      stage,
      ready: false,
      active: false,
      frame: reduceMotion ? Math.floor((playableCount(effect) - 1) / 2) : 0,
      acc: 0,
      hold: 0,
      force,
      scale: 1,
      dirty: true
    };
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      player.ready = true;
      player.dirty = true;
      draw(player);
    };
    image.src = effect.sheet(state.tier);
    player.image = image;
    live.add(player);
    return player;
  }

  function layout(player) {
    const pad = 20;
    const maxW = Math.max(1, player.stage.clientWidth - pad);
    const maxH = Math.max(1, player.stage.clientHeight - pad);
    const fitted = Math.floor(Math.min(maxW / player.effect.w, maxH / player.effect.h));
    const scale = Math.max(1, Math.min(state.scale, fitted || 1));
    const dpr = Math.max(1, Math.round(devicePixelRatio || 1));
    const cssW = player.effect.w * scale;
    const cssH = player.effect.h * scale;
    if (!player.stage.clientWidth || !player.stage.clientHeight) return;
    if (player.canvas.width === cssW * dpr && player.canvas.height === cssH * dpr) return;
    player.canvas.style.width = `${cssW}px`;
    player.canvas.style.height = `${cssH}px`;
    player.canvas.width = cssW * dpr;
    player.canvas.height = cssH * dpr;
    player.scale = scale * dpr;
    player.dirty = true;
    draw(player);
  }

  function draw(player) {
    if (!player.ready) return;
    const ctx = player.canvas.getContext("2d");
    const { w, h, columns } = player.effect;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, player.canvas.width, player.canvas.height);
    ctx.drawImage(
      player.image,
      (player.frame % columns) * w,
      Math.floor(player.frame / columns) * h,
      w,
      h,
      0,
      0,
      w * player.scale,
      h * player.scale
    );
    player.dirty = false;
  }

  function step(player, dt) {
    if (!player.ready || !player.active) return;
    if (reduceMotion && !player.force) return;
    const count = playableCount(player.effect);
    if (player.hold > 0) {
      player.hold -= dt;
      if (player.hold > 0) return;
      player.frame = 0;
      player.dirty = true;
    }
    player.acc += dt;
    while (player.acc >= player.effect.frameMs) {
      player.acc -= player.effect.frameMs;
      player.frame += 1;
      player.dirty = true;
      if (player.frame >= count) {
        if (player.effect.loop) player.frame = 0;
        else {
          player.frame = count - 1;
          player.hold = 700;
          player.acc = 0;
        }
        break;
      }
    }
    if (player.dirty) draw(player);
  }

  function dropGridPlayers() {
    for (const player of live) {
      if (player !== detailPlayer) live.delete(player);
    }
  }

  function buildGrid() {
    const signature = `${state.library}|${state.tier}`;
    if (signature === builtFor) return;
    builtFor = signature;
    dropGridPlayers();
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const player = entry.target._player;
        if (!player) continue;
        const onScreen = entry.isIntersecting && !entry.target.parentElement.hidden;
        player.active = onScreen;
        if (onScreen) layout(player);
      }
    }, { rootMargin: "200px" });

    grid.replaceChildren();
    for (const effect of effects[state.library]) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.dataset.key = effect.key;
      const stage = document.createElement("div");
      stage.className = `stage${state.checker ? " checker" : ""}`;
      const canvas = document.createElement("canvas");
      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("h2");
      title.textContent = effect.name;
      const sub = document.createElement("p");
      sub.className = "sub";
      sub.textContent = `${label(effect.category)} · ${effect.w}×${effect.h} · ${effect.loop ? "循环" : "单次"}`;
      meta.append(title, sub);
      stage.append(canvas);
      card.append(stage, meta);
      card.addEventListener("click", () => openDetail(effect));
      grid.append(card);
      const player = createPlayer(effect, canvas, stage, false);
      stage._player = player;
      observer.observe(stage);
      requestAnimationFrame(() => layout(player));
    }
  }

  function applyFilter() {
    let shown = 0;
    for (const card of grid.children) {
      const effect = effects[state.library].find((item) => item.key === card.dataset.key);
      const visible = effect ? matches(effect) : false;
      card.hidden = !visible;
      if (visible) shown += 1;
      if (!visible && card.querySelector(".stage")._player) card.querySelector(".stage")._player.active = false;
    }
    const total = effects[state.library].length;
    $("count").hidden = false;
    $("count").textContent = shown === total ? `${total} 个特效` : `显示 ${shown} / ${total}`;
    $("empty").hidden = shown !== 0;
    $("lede").textContent = state.library === "foundry"
      ? "101 个像素特效，明亮与纯色各一套。点开一张可看大图并重播。单次特效会停在最后一帧，再自动重播。"
      : "旧版 0.10 的 44 个 96×96 特效，每行 5 帧。这一版没有明亮 / 纯色分档。";
  }

  function fact(dl, name, value) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = value;
    dl.append(dt, dd);
  }

  function openDetail(effect) {
    selected = effect;
    const stage = $("detail-stage");
    stage.className = `detail-stage stage${state.checker ? " checker" : ""}`;
    if (detailPlayer) live.delete(detailPlayer);
    detailPlayer = createPlayer(effect, $("detail-canvas"), stage, true);
    detailPlayer.active = true;
    $("detail-kicker").textContent = `${label(effect.category)} · ${effect.loop ? "循环" : "单次"}`;
    $("detail-title").textContent = effect.name;
    $("detail-desc").textContent = effect.description;
    const facts = $("detail-facts");
    facts.replaceChildren();
    fact(facts, "尺寸", `${effect.w}×${effect.h}`);
    fact(facts, "帧数", `${playableCount(effect)} 帧可见，表内共 ${effect.frames} 帧`);
    fact(facts, "帧长", `${effect.frameMs} ms`);
    fact(facts, "风格", effect.library === "foundry" ? (state.tier === "lit" ? "明亮 lit" : "纯色 strict") : "旧版单套");
    if (effect.tags.length) fact(facts, "标签", effect.tags.join("、"));
    $("detail-path").textContent = effect.sheet(state.tier).replace(/^\.\.\//, "");
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => layout(detailPlayer));
    history.replaceState(null, "", `#${encodeURIComponent(effect.key)}`);
  }

  function closeDetail() {
    if (detailPlayer) live.delete(detailPlayer);
    detailPlayer = null;
    selected = null;
    if (dialog.open) dialog.close();
    history.replaceState(null, "", location.pathname + location.search);
  }

  function render() {
    renderControls();
    buildGrid();
    applyFilter();
    if (selected && selected.library === state.library) openDetail(selected);
  }

  function tick(now) {
    const dt = lastTick ? Math.min(80, now - lastTick) : 16;
    lastTick = now;
    for (const player of live) step(player, dt);
    requestAnimationFrame(tick);
  }

  $("checker").addEventListener("click", () => {
    state.checker = !state.checker;
    $("checker").setAttribute("aria-pressed", state.checker ? "true" : "false");
    for (const stage of document.querySelectorAll(".stage")) {
      stage.classList.toggle("checker", state.checker);
    }
  });

  $("query").addEventListener("input", (event) => {
    state.query = event.target.value;
    applyFilter();
  });

  $("replay").addEventListener("click", () => {
    if (!detailPlayer) return;
    detailPlayer.frame = 0;
    detailPlayer.acc = 0;
    detailPlayer.hold = 0;
    detailPlayer.dirty = true;
    draw(detailPlayer);
  });

  $("close").addEventListener("click", closeDetail);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDetail();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetail();
  });
  window.addEventListener("resize", () => {
    for (const player of live) layout(player);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== $("query")) {
      event.preventDefault();
      $("query").focus();
    }
  });

  async function main() {
    try {
      const [foundry, legacy] = await Promise.all([
        fetch("../pack.json").then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        }),
        fetch("../legacy/0.10.0/pack.json").then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        })
      ]);
      effects = {
        foundry: foundry.effects.map(normalizeFoundry),
        legacy: legacy.effects.map(normalizeLegacy)
      };
    } catch (error) {
      $("lede").textContent = "读不到特效目录。请在仓库根目录运行 python -m http.server，然后打开 /gallery/。直接双击 HTML 时浏览器会拦截这些文件。";
      return;
    }

    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    const fromHash = [...effects.foundry, ...effects.legacy].find((effect) => effect.key === hash);
    if (fromHash) state.library = fromHash.library;
    render();
    if (fromHash) openDetail(fromHash);
    requestAnimationFrame(tick);
  }

  main();
})();
