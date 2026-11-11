// The dashboard is a single self-contained page, kept in a .ts file so `tsc`
// ships it in dist/ without a separate copy step.
// Note: the client script avoids template literals so this outer one stays simple.
export const dashboardPage = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sniper Dashboard</title>
<style>
  :root {
    --bg: #f6f7f9;
    --panel: #ffffff;
    --border: #e3e6eb;
    --text: #15181d;
    --muted: #677080;
    --accent: #7c3aed;
    --good: #0f9d58;
    --warn: #b7791f;
    --bad: #d93025;
    --log-bg: #fbfbfc;
    --row-hover: #f1f2f5;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d0f13;
      --panel: #151820;
      --border: #252a35;
      --text: #e6e8ec;
      --muted: #8b93a3;
      --accent: #a78bfa;
      --good: #34d399;
      --warn: #fbbf24;
      --bad: #f87171;
      --log-bg: #10131a;
      --row-hover: #1a1e27;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 20px 16px 32px; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  h1 span { color: var(--accent); }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
    border: 1px solid var(--border); background: var(--panel); color: var(--muted);
  }
  .pill.live { color: var(--good); border-color: color-mix(in srgb, var(--good) 40%, transparent); }
  .pill.dry { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .dot.on { background: var(--good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 25%, transparent); }
  .dot.off { background: var(--bad); }
  .spacer { flex: 1; }
  .muted { color: var(--muted); }

  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; min-width: 0; }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .balance { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .balance small { font-size: 15px; color: var(--muted); font-weight: 600; }
  .addr { display: flex; align-items: center; gap: 6px; margin-top: 10px; min-width: 0; }
  .addr code { font-family: var(--mono); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .target-addr code { font-size: 14px; }
  .btn {
    font: inherit; font-size: 12px; cursor: pointer; padding: 4px 9px; border-radius: 7px;
    border: 1px solid var(--border); background: transparent; color: var(--text); white-space: nowrap;
  }
  .btn:hover { background: var(--row-hover); }
  .btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  a.btn { text-decoration: none; }
  .kv { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-size: 13px; }
  .kv dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
  .kv dt { color: var(--muted); }
  .err { color: var(--bad); font-size: 12px; margin-top: 6px; }

  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
  .stat .n { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat.good .n { color: var(--good); }
  .stat.bad .n { color: var(--bad); }

  .logs { padding: 0; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .seg { display: inline-flex; gap: 4px; }
  input[type=search] {
    font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 7px; min-width: 0; flex: 1 1 160px; max-width: 280px;
    border: 1px solid var(--border); background: var(--bg); color: var(--text);
  }
  label.chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); cursor: pointer; }
  #log { height: 56vh; min-height: 280px; overflow: auto; background: var(--log-bg); font-family: var(--mono); font-size: 12.5px; }
  .row { display: grid; grid-template-columns: 74px 52px 1fr; gap: 10px; padding: 3px 14px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
  .row:hover { background: var(--row-hover); }
  .row .t { color: var(--muted); font-variant-numeric: tabular-nums; }
  .row .lv { font-weight: 700; font-size: 11px; padding-top: 1px; }
  .row.info .lv { color: var(--muted); }
  .row.warn { background: color-mix(in srgb, var(--warn) 7%, transparent); }
  .row.warn .lv { color: var(--warn); }
  .row.error { background: color-mix(in srgb, var(--bad) 8%, transparent); }
  .row.error .lv { color: var(--bad); }
  .row .m { white-space: pre-wrap; word-break: break-word; min-width: 0; }
  .row .tag { color: var(--accent); font-weight: 600; }
  .empty { padding: 40px 14px; text-align: center; color: var(--muted); font-family: system-ui, sans-serif; }

  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 520px) {
    .row { grid-template-columns: 1fr; gap: 0; }
    .row .t, .row .lv { display: inline; }
    .balance { font-size: 26px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><span>&#9673;</span> Sniper</h1>
    <span id="mode" class="pill">&hellip;</span>
    <span class="pill"><span id="streamDot" class="dot"></span><span id="streamText">Connecting</span></span>
    <span class="spacer"></span>
    <span class="muted" id="uptime"></span>
  </header>

  <section class="grid">
    <div class="card">
      <div class="label">My wallet <span class="spacer"></span><button class="btn" id="refresh">Refresh</button></div>
      <div class="balance" id="balance">&ndash; <small>SOL</small></div>
      <div class="err" id="balanceErr" hidden></div>
      <div class="addr">
        <code id="wallet">&hellip;</code>
        <button class="btn" data-copy="wallet">Copy</button>
        <a class="btn" id="walletLink" target="_blank" rel="noopener">Solscan &#8599;</a>
      </div>
    </div>

    <div class="card">
      <div class="label">Tracking wallet</div>
      <div class="muted">Buys from this wallet are copied.</div>
      <div class="addr target-addr">
        <code id="target">&hellip;</code>
        <button class="btn" data-copy="target">Copy</button>
        <a class="btn" id="targetLink" target="_blank" rel="noopener">Solscan &#8599;</a>
      </div>
    </div>

    <div class="card">
      <div class="label">Settings</div>
      <dl class="kv">
        <dt>Buy amount</dt><dd id="buyAmount">&ndash;</dd>
        <dt>Slippage</dt><dd id="slippage">&ndash;</dd>
        <dt>Max price above target</dt><dd id="maxPrice">&ndash;</dd>
        <dt>Priority fee</dt><dd id="priority">&ndash;</dd>
      </dl>
    </div>
  </section>

  <section class="stats">
    <div class="card stat"><div class="label">Target buys</div><div class="n" id="sBuys">0</div></div>
    <div class="card stat"><div class="label">Buys sent</div><div class="n" id="sSent">0</div></div>
    <div class="card stat good"><div class="label">Confirmed</div><div class="n" id="sOk">0</div></div>
    <div class="card stat bad"><div class="label">Failed / skipped</div><div class="n" id="sFail">0</div></div>
  </section>

  <section class="card logs">
    <div class="toolbar">
      <strong>Logs</strong>
      <div class="seg" id="levels">
        <button class="btn active" data-level="all">All</button>
        <button class="btn" data-level="info">Info</button>
        <button class="btn" data-level="warn">Warn</button>
        <button class="btn" data-level="error">Error</button>
      </div>
      <input type="search" id="search" placeholder="Filter, e.g. CopyTrade or a mint">
      <span class="spacer"></span>
      <label class="chk"><input type="checkbox" id="hideSkips"> Hide skips</label>
      <label class="chk"><input type="checkbox" id="follow" checked> Auto-scroll</label>
      <button class="btn" id="clear">Clear view</button>
    </div>
    <div id="log"><div class="empty">Waiting for logs&hellip;</div></div>
  </section>
</div>

<script>
(function () {
  var token = new URLSearchParams(location.search).get("token");
  function api(path) {
    var base = location.pathname.replace(/\\/$/, "") + "/api/" + path;
    return token ? base + (base.indexOf("?") < 0 ? "?" : "&") + "token=" + encodeURIComponent(token) : base;
  }
  function $(id) { return document.getElementById(id); }
  function sol(lamports) { return (lamports / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 }) + " SOL"; }

  // ---- status card ----
  var startedAt = null;
  function loadStatus() {
    fetch(api("status")).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (s) {
      startedAt = s.startedAt;
      $("wallet").textContent = s.wallet;
      $("wallet").title = s.wallet;
      $("walletLink").href = "https://solscan.io/account/" + s.wallet;
      $("target").textContent = s.targetWallet;
      $("target").title = s.targetWallet;
      $("targetLink").href = "https://solscan.io/account/" + s.targetWallet;

      var mode = $("mode");
      mode.className = "pill " + (s.dryRun ? "dry" : "live");
      mode.textContent = s.dryRun ? "DRY RUN" : "LIVE";

      if (s.balanceLamports !== null) {
        var whole = (s.balanceLamports / 1e9).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
        $("balance").innerHTML = "";
        $("balance").append(whole + " ");
        var unit = document.createElement("small"); unit.textContent = "SOL";
        $("balance").append(unit);
      }
      $("balanceErr").hidden = !s.balanceError;
      $("balanceErr").textContent = s.balanceError ? "Balance unavailable: " + s.balanceError : "";

      $("buyAmount").textContent = sol(s.buyAmountLamports);
      $("slippage").textContent = s.slippagePercent + "%";
      $("maxPrice").textContent = s.maxPriceIncreasePercent + "%";
      $("priority").textContent = sol(s.priorityFeeLamports);
    }).catch(function (err) {
      $("balanceErr").hidden = false;
      $("balanceErr").textContent = "Status unavailable: " + err.message;
    });
  }
  loadStatus();
  setInterval(loadStatus, 15000);
  $("refresh").onclick = loadStatus;

  function tickUptime() {
    if (!startedAt) return;
    var s = Math.floor((Date.now() - startedAt) / 1000);
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    $("uptime").textContent = "Up " + (d ? d + "d " : "") + h + "h " + m + "m";
  }
  setInterval(tickUptime, 1000);

  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.onclick = function () {
      var text = $(b.getAttribute("data-copy")).textContent;
      navigator.clipboard.writeText(text).then(function () {
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = "Copy"; }, 1200);
      });
    };
  });

  // ---- logs ----
  var all = [];
  var seen = {};
  var level = "all";
  var query = "";
  var hideSkips = false;
  var MAX_ROWS = 2000;
  var stats = { buys: 0, sent: 0, ok: 0, fail: 0 };
  var logEl = $("log");

  function count(e) {
    var m = e.message;
    if (m.indexOf("[Webhook] target buy") >= 0) stats.buys++;
    else if (/ buy sent:/.test(m)) stats.sent++;
    else if (/ buy confirmed:/.test(m)) stats.ok++;
    else if (/failed on-chain|buy failed|not confirmed after/.test(m)) stats.fail++;
    $("sBuys").textContent = stats.buys;
    $("sSent").textContent = stats.sent;
    $("sOk").textContent = stats.ok;
    $("sFail").textContent = stats.fail;
  }

  function visible(e) {
    if (level !== "all" && e.level !== level) return false;
    if (hideSkips && e.message.indexOf("[Webhook] skip") === 0) return false;
    if (query && e.message.toLowerCase().indexOf(query) < 0) return false;
    return true;
  }

  function rowFor(e) {
    var row = document.createElement("div");
    row.className = "row " + e.level;
    var t = document.createElement("span");
    t.className = "t";
    t.textContent = new Date(e.time).toLocaleTimeString([], { hour12: false });
    t.title = new Date(e.time).toLocaleString();
    var lv = document.createElement("span");
    lv.className = "lv";
    lv.textContent = e.level.toUpperCase();
    var m = document.createElement("span");
    m.className = "m";
    var match = /^\\[[^\\]]+\\]/.exec(e.message);
    if (match) {
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = match[0];
      m.append(tag, e.message.slice(match[0].length));
    } else {
      m.textContent = e.message;
    }
    row.append(t, lv, m);
    return row;
  }

  function atBottom() { return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40; }
  function scrollIfFollowing(wasAtBottom) {
    if ($("follow").checked && wasAtBottom !== false) logEl.scrollTop = logEl.scrollHeight;
  }

  function render() {
    logEl.innerHTML = "";
    var shown = all.filter(visible);
    if (!shown.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = all.length ? "No logs match the filter." : "Waiting for logs\\u2026";
      logEl.append(empty);
      return;
    }
    var frag = document.createDocumentFragment();
    shown.forEach(function (e) { frag.append(rowFor(e)); });
    logEl.append(frag);
    scrollIfFollowing();
  }

  function add(e) {
    if (seen[e.id]) return;
    seen[e.id] = true;
    all.push(e);
    count(e);
    if (all.length > MAX_ROWS) all.splice(0, all.length - MAX_ROWS);
    if (!visible(e)) return;
    var wasAtBottom = atBottom();
    var empty = logEl.querySelector(".empty");
    if (empty) empty.remove();
    logEl.append(rowFor(e));
    while (logEl.childElementCount > MAX_ROWS) logEl.firstElementChild.remove();
    scrollIfFollowing(wasAtBottom);
  }

  $("levels").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-level]");
    if (!b) return;
    level = b.getAttribute("data-level");
    document.querySelectorAll("#levels .btn").forEach(function (x) { x.classList.toggle("active", x === b); });
    render();
  });
  $("search").addEventListener("input", function () { query = this.value.trim().toLowerCase(); render(); });
  $("hideSkips").addEventListener("change", function () { hideSkips = this.checked; render(); });
  $("clear").onclick = function () { all = []; render(); };

  function setStream(on, text) {
    $("streamDot").className = "dot " + (on ? "on" : "off");
    $("streamText").textContent = text;
  }

  var es = new EventSource(api("logs/stream"));
  es.onopen = function () { setStream(true, "Live logs"); };
  es.onerror = function () { setStream(false, "Reconnecting"); };
  es.onmessage = function (msg) {
    try { add(JSON.parse(msg.data)); } catch (err) { /* ignore malformed event */ }
  };
})();
</script>
</body>
</html>
`;
