const SERIES_COLORS = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];
const MAX_SERIES = 8;

const state = {
  topN: 5,
  customSteamIds: [], // used when topN === 0
  players: [], // {steam_id, display_name, prestige_level}
  fullHistory: {}, // steamId -> points[], for the avg-time-to-prestige column
  timeframe: "all",
};

const el = (id) => document.getElementById(id);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function timeAgo(iso) {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Average seconds per prestige level, estimated from our own collected
// history: (time between first and last observed snapshot) / (levels
// gained over that span). Returns null when we haven't observed a level
// change yet (not enough data, not "zero").
function avgSecondsPerPrestige(points) {
  if (!points || points.length < 2) return null;
  const sorted = [...points].sort((a, b) => new Date(a.t) - new Date(b.t));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const levelsGained = last.prestigeLevel - first.prestigeLevel;
  if (levelsGained <= 0) return null;
  const seconds = (new Date(last.t) - new Date(first.t)) / 1000;
  return seconds / levelsGained;
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const days = seconds / 86400;
  if (days >= 1) return `${days.toFixed(1)}d`;
  const hours = seconds / 3600;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const mins = seconds / 60;
  if (mins >= 1) return `${Math.round(mins)}m`;
  return `${Math.round(seconds)}s`;
}

// Cutoff timestamp (ms) for a timeframe key, using real calendar-month/year
// arithmetic rather than fixed-day approximations. null means no cutoff.
function timeframeCutoff(key) {
  if (key === "all") return null;
  const d = new Date();
  switch (key) {
    case "24h": d.setHours(d.getHours() - 24); break;
    case "1w": d.setDate(d.getDate() - 7); break;
    case "1m": d.setMonth(d.getMonth() - 1); break;
    case "3m": d.setMonth(d.getMonth() - 3); break;
    case "6m": d.setMonth(d.getMonth() - 6); break;
    case "9m": d.setMonth(d.getMonth() - 9); break;
    case "1y": d.setFullYear(d.getFullYear() - 1); break;
    default: return null;
  }
  return d.getTime();
}

function filterSeriesByTimeframe(seriesObj, timeframeKey) {
  const cutoff = timeframeCutoff(timeframeKey);
  if (cutoff === null) return seriesObj;
  const filtered = {};
  for (const [sid, s] of Object.entries(seriesObj)) {
    const points = s.points.filter((p) => new Date(p.t).getTime() >= cutoff);
    if (points.length > 0) filtered[sid] = { ...s, points };
  }
  return filtered;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Status ----------
async function refreshStatus() {
  try {
    const s = await fetchJSON("/api/status");
    const line = el("status-line");
    const ok = s.lastFetch && s.lastFetch.ok !== false;
    line.innerHTML = `<span class="dot${ok ? "" : " error"}"></span>` +
      (s.lastFetch && s.lastFetch.at
        ? `Last fetch ${timeAgo(s.lastFetch.at)}${ok ? "" : " (failed)"} · `
        : "") +
      `${s.snapshotCount} snapshot${s.snapshotCount === 1 ? "" : "s"} collected · polling every ${Math.round(s.fetchIntervalSeconds / 60)}m`;
  } catch {
    el("status-line").textContent = "Could not reach server.";
  }
}

// ---------- Latest table ----------
async function refreshLatestTable() {
  let data, live = true;
  try {
    data = await fetchJSON("/api/live");
  } catch {
    // Source API unreachable right now — fall back to the last stored snapshot.
    live = false;
    data = await fetchJSON("/api/latest");
  }

  const heading = el("lb-heading");
  if (heading) {
    heading.textContent = live
      ? "Latest leaderboard (live, fetched just now)"
      : "Latest leaderboard (last stored snapshot — live source unreachable)";
  }

  const body = el("lb-body");
  if (!data.snapshot || data.entries.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="empty-state">No data yet — waiting on the first fetch.</td></tr>`;
    return;
  }
  body.innerHTML = data.entries.map((e) => `
    <tr>
      <td class="num">${e.rank}</td>
      <td class="name">${escapeHtml(e.display_name)}</td>
      <td class="center">${e.prestige_level.toLocaleString()}</td>
      <td class="num">${formatDuration(avgSecondsPerPrestige(state.fullHistory[e.steam_id]))}</td>
      <td>${escapeHtml(timeAgo(e.achieved_at))}</td>
    </tr>
  `).join("");
}

// ---------- Player search ----------
async function loadPlayers() {
  state.players = await fetchJSON("/api/players");
}

// Full history (top 100, matching the table) for the avg-time-to-prestige
// column — a separate call from the chart's history fetch since the chart
// only needs the currently-selected series.
async function loadFullHistory() {
  const series = await fetchJSON("/api/history?top=100");
  const map = {};
  for (const [sid, s] of Object.entries(series)) map[sid] = s.points;
  state.fullHistory = map;
}

function setupPlayerSearch() {
  const input = el("player-search");
  const list = el("suggestion-list");

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.classList.remove("open"); list.innerHTML = ""; return; }
    const matches = state.players
      .filter((p) => p.display_name.toLowerCase().includes(q) && !state.customSteamIds.includes(p.steam_id))
      .slice(0, 8);
    if (matches.length === 0) { list.classList.remove("open"); list.innerHTML = ""; return; }
    list.innerHTML = matches.map((p) =>
      `<div data-steam-id="${p.steam_id}">${escapeHtml(p.display_name)} <span style="opacity:.6">— ${p.prestige_level}</span></div>`
    ).join("");
    list.classList.add("open");
  });

  list.addEventListener("click", (e) => {
    const target = e.target.closest("[data-steam-id]");
    if (!target) return;
    const sid = target.dataset.steamId;
    if (!state.customSteamIds.includes(sid) && state.customSteamIds.length < MAX_SERIES) {
      state.customSteamIds.push(sid);
      el("top-n").value = "0";
      state.topN = 0;
      renderChips();
      loadAndRenderChart();
    }
    input.value = "";
    list.classList.remove("open");
    list.innerHTML = "";
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#player-suggestions")) list.classList.remove("open");
  });
}

function renderChips() {
  const row = el("chip-row");
  if (state.topN !== 0) { row.innerHTML = ""; return; }
  row.innerHTML = state.customSteamIds.map((sid, i) => {
    const p = state.players.find((pp) => pp.steam_id === sid);
    const name = p ? p.display_name : sid;
    const color = cssVar(SERIES_COLORS[i % SERIES_COLORS.length]);
    return `<span class="chip"><span class="swatch" style="background:${color}"></span>${escapeHtml(name)}<button data-remove="${sid}">×</button></span>`;
  }).join("");
  row.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.customSteamIds = state.customSteamIds.filter((sid) => sid !== btn.dataset.remove);
      renderChips();
      loadAndRenderChart();
    });
  });
}

el("top-n").addEventListener("change", (e) => {
  state.topN = parseInt(e.target.value, 10);
  renderChips();
  loadAndRenderChart();
});

el("timeframe").addEventListener("change", (e) => {
  state.timeframe = e.target.value;
  loadAndRenderChart();
});

// ---------- Chart ----------
async function loadAndRenderChart() {
  let url;
  if (state.topN > 0) {
    url = `/api/history?top=${state.topN}`;
  } else if (state.customSteamIds.length > 0) {
    url = `/api/history?${state.customSteamIds.map((sid) => `steamId=${encodeURIComponent(sid)}`).join("&")}`;
  } else {
    renderChart({});
    return;
  }
  const series = await fetchJSON(url);
  const filtered = filterSeriesByTimeframe(series, state.timeframe);
  const hadData = Object.values(series).some((s) => s.points.length > 0);
  const hasData = Object.values(filtered).some((s) => s.points.length > 0);
  const emptyMessage = (hadData && !hasData && state.timeframe !== "all")
    ? "No data in this timeframe — try a wider range."
    : undefined;
  renderChart(filtered, emptyMessage);
}

function renderChart(seriesObj, emptyMessage) {
  const svg = el("chart");
  const empty = el("chart-empty");
  const legend = el("legend");
  const seriesList = Object.values(seriesObj).filter((s) => s.points.length > 0);
  // Rank order — highest current prestige first — regardless of the order
  // the data arrived in or players were added, so the legend/colors always
  // read top-to-bottom the same way the leaderboard does.
  seriesList.sort((a, b) => b.points[b.points.length - 1].prestigeLevel - a.points[a.points.length - 1].prestigeLevel);

  if (seriesList.length === 0 || !seriesList.some((s) => s.points.length > 1)) {
    svg.innerHTML = "";
    legend.innerHTML = "";
    empty.textContent = emptyMessage || "Not enough data yet — check back after the next hourly fetch.";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const W = 1000, H = 340;
  const padL = 46, padR = 16, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  let tMin = Infinity, tMax = -Infinity, vMax = -Infinity, vMin = Infinity;
  for (const s of seriesList) {
    for (const p of s.points) {
      const t = new Date(p.t).getTime();
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      if (p.prestigeLevel > vMax) vMax = p.prestigeLevel;
      if (p.prestigeLevel < vMin) vMin = p.prestigeLevel;
    }
  }
  if (tMin === tMax) tMin -= 3600 * 1000;
  vMax = Math.max(1, Math.ceil(vMax * 1.15));
  // Floor sits ~20 prestige below the lowest plotted value instead of always
  // pinning to 0 — mirrors the headroom already given above the highest
  // value, so small moves near the bottom of the chart aren't flattened out.
  const vFloor = Math.max(0, Math.floor(vMin) - 20);

  const x = (t) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
  const y = (v) => padT + plotH - ((v - vFloor) / (vMax - vFloor)) * plotH;

  let svgParts = [];

  // gridlines (4 horizontal steps)
  const steps = 4;
  const vRange = vMax - vFloor;
  for (let i = 0; i <= steps; i++) {
    const v = Math.round(vFloor + (vRange / steps) * i);
    const gy = y(v);
    svgParts.push(`<line class="gridline" x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" />`);
    svgParts.push(`<text class="axis-label" x="${padL - 8}" y="${gy + 4}" text-anchor="end">${v}</text>`);
  }
  svgParts.push(`<line class="baseline" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" />`);

  // time axis labels — evenly spaced across the range, not just the two ends
  const fmt = (t) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "numeric" });
  const xTicks = 4;
  let lastLabel = null;
  for (let i = 0; i <= xTicks; i++) {
    const t = tMin + ((tMax - tMin) * i) / xTicks;
    const label = fmt(t);
    if (label === lastLabel) continue; // short ranges can otherwise repeat the same rounded label
    lastLabel = label;
    const tx = x(t);
    const anchor = i === 0 ? "start" : i === xTicks ? "end" : "middle";
    svgParts.push(`<text class="axis-label" x="${tx}" y="${H - 6}" text-anchor="${anchor}">${label}</text>`);
  }

  const legendItems = [];
  const endpoints = [];
  seriesList.forEach((s, i) => {
    const colorVar = SERIES_COLORS[i % SERIES_COLORS.length];
    const color = cssVar(colorVar);
    // Beyond 8 series the fixed palette has to repeat a hue (never invent an
    // unvalidated 9th color) — dash the line and hollow the markers for the
    // repeats so they stay visually distinct from their color-twin, not just
    // legend-distinct.
    const isRepeat = i >= SERIES_COLORS.length;
    const pts = [...s.points].sort((a, b) => new Date(a.t) - new Date(b.t));
    const pathD = pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${x(new Date(p.t).getTime()).toFixed(2)} ${y(p.prestigeLevel).toFixed(2)}`).join(" ");
    svgParts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${isRepeat ? ' stroke-dasharray="6 4"' : ""} />`);

    // A small marker at every snapshot, not just the endpoint, so the
    // individual polling times are visible along the line.
    for (const p of pts) {
      const px = x(new Date(p.t).getTime());
      const py = y(p.prestigeLevel);
      svgParts.push(`<circle class="snapshot-dot" cx="${px}" cy="${py}" r="4" fill="${color}" stroke="var(--surface-1)" stroke-width="1.5" />`);
    }

    const last = pts[pts.length - 1];
    const lx = x(new Date(last.t).getTime());
    const ly = y(last.prestigeLevel);
    svgParts.push(isRepeat
      ? `<circle cx="${lx}" cy="${ly}" r="5" fill="var(--surface-1)" stroke="${color}" stroke-width="2.5" />`
      : `<circle cx="${lx}" cy="${ly}" r="5" fill="${color}" stroke="var(--surface-1)" stroke-width="2" />`);
    endpoints.push({ lx, ly, name: s.displayName });

    const swatch = isRepeat
      ? `style="background:transparent;border:2px solid ${color}"`
      : `style="background:${color}"`;
    legendItems.push(`<div class="legend-item"><span class="legend-swatch" ${swatch}></span>${escapeHtml(s.displayName)}</div>`);
  });

  // Direct end-labels for every series. When values tie (or sit close
  // together) the labels would overlap, so instead of dropping the
  // colliding ones, nudge them apart vertically and reconnect each to its
  // actual data point with a thin leader line — every name stays visible.
  const MIN_GAP = 14;
  endpoints.sort((a, b) => a.ly - b.ly);
  endpoints.forEach((p) => { p.labelY = p.ly; });
  for (let i = 1; i < endpoints.length; i++) {
    if (endpoints[i].labelY - endpoints[i - 1].labelY < MIN_GAP) {
      endpoints[i].labelY = endpoints[i - 1].labelY + MIN_GAP;
    }
  }
  for (const p of endpoints) {
    const onRight = p.lx > W - 140;
    const labelAnchor = onRight ? "end" : "start";
    const labelX = onRight ? p.lx - 10 : p.lx + 10;
    if (Math.abs(p.labelY - p.ly) > 0.5) {
      svgParts.push(`<line class="end-leader" x1="${p.lx}" y1="${p.ly}" x2="${labelX}" y2="${p.labelY}" />`);
    }
    svgParts.push(`<text class="end-label emph" x="${labelX}" y="${p.labelY + 4}" text-anchor="${labelAnchor}">${escapeHtml(p.name)}</text>`);
  }

  // Crosshair — hidden until the hover handler below positions and shows it.
  svgParts.push(`<line id="crosshair" class="crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" style="display:none" />`);

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = svgParts.join("\n");
  legend.innerHTML = legendItems.join("");

  // Every distinct snapshot time across all displayed series, so hover can
  // snap to an actual dot instead of an arbitrary mouse position.
  const allTimes = [...new Set(seriesList.flatMap((s) => s.points.map((p) => new Date(p.t).getTime())))].sort((a, b) => a - b);

  setupHover(svg, seriesList, { x, y, tMin, tMax, padL, padR, W, allTimes });
}

function nearestTime(times, target) {
  let best = times[0], bestDist = Infinity;
  for (const t of times) {
    const d = Math.abs(t - target);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best;
}

function setupHover(svg, seriesList, scales) {
  const tooltip = el("tooltip");
  const crosshair = svg.querySelector("#crosshair");
  const wrap = svg.parentElement;

  svg.onmousemove = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const frac = Math.min(1, Math.max(0, (px - scales.padL * (rect.width / scales.W)) / ((scales.W - scales.padL - scales.padR) * (rect.width / scales.W))));
    const targetT = scales.tMin + frac * (scales.tMax - scales.tMin);
    const snappedT = nearestTime(scales.allTimes, targetT);

    if (crosshair) {
      const cx = scales.x(snappedT);
      crosshair.setAttribute("x1", cx);
      crosshair.setAttribute("x2", cx);
      crosshair.style.display = "block";
    }

    const rows = seriesList.map((s) => {
      let nearest = s.points[0];
      let best = Infinity;
      for (const p of s.points) {
        const d = Math.abs(new Date(p.t).getTime() - snappedT);
        if (d < best) { best = d; nearest = p; }
      }
      return { name: s.displayName, val: nearest.prestigeLevel, t: nearest.t };
    });

    const colorFor = (i) => cssVar(SERIES_COLORS[i % SERIES_COLORS.length]);
    tooltip.innerHTML = `<div class="t-time">${new Date(rows[0].t).toLocaleString()}</div>` +
      rows.map((r, i) => `<div class="t-row"><span class="name"><span class="t-dot" style="background:${colorFor(i)}"></span>${escapeHtml(r.name)}</span><span class="val">${r.val}</span></div>`).join("");
    tooltip.style.display = "block";
    tooltip.style.left = `${Math.min(px + 16, wrap.clientWidth - 180)}px`;
    tooltip.style.top = `10px`;
  };
  svg.onmouseleave = () => {
    tooltip.style.display = "none";
    if (crosshair) crosshair.style.display = "none";
  };
}

// ---------- Manual refresh ----------
function setupRefreshButton() {
  const btn = el("refresh-btn");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.classList.add("spinning");
    try {
      await fetch("/api/poll-now", { method: "POST" });
    } catch {
      // fall through — refreshStatus below will surface the failure
    }
    await refreshStatus();
    await refreshLatestTable();
    await loadPlayers();
    await loadFullHistory();
    await loadAndRenderChart();
    btn.disabled = false;
    btn.classList.remove("spinning");
  });
}

// ---------- Init ----------
async function init() {
  setupPlayerSearch();
  setupRefreshButton();
  await refreshStatus();
  await loadPlayers();
  await loadFullHistory();
  await refreshLatestTable();
  await loadAndRenderChart();

  setInterval(refreshStatus, 30 * 1000);
  setInterval(refreshLatestTable, 60 * 1000); // live endpoint — cheap, keep it fresh
  setInterval(async () => {
    await loadPlayers();
    await loadFullHistory();
    await loadAndRenderChart();
  }, 5 * 60 * 1000); // history only changes hourly, no need to poll it often
}

init();
