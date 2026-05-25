(() => {
  "use strict";

  const Config = {
    VERSION: "250526b2",
    APP: "FPBlockedManager",
    API_URL: "https://graph.facebook.com/v23.0/",
    CACHE_KEY: "fpblockedmanager.lastPackage.v1",
  };
  const APP_ID = "ywbFPBlockedManager";
  const APP_TITLE = "FP Blocked Manager";
  const APP_MARK_SVG = `<svg class="ywb-mark" viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="${APP_ID}-gold" x1="0%" x2="100%" y1="0%" y2="100%"><stop offset="0%" stop-color="#ffe16a"/><stop offset="55%" stop-color="#ffd000"/><stop offset="100%" stop-color="#ffab00"/></linearGradient></defs><rect x="4" y="4" width="88" height="88" rx="22" fill="#151515" stroke="url(#${APP_ID}-gold)" stroke-width="6"/><circle cx="40" cy="36" r="13" fill="#222" stroke="#fff2bd" stroke-width="4"/><path d="M22 72c4-15 14-22 30-22s26 7 30 22" fill="none" stroke="url(#${APP_ID}-gold)" stroke-width="7" stroke-linecap="round"/><path d="M66 27 78 39M78 27 66 39" stroke="url(#${APP_ID}-gold)" stroke-width="7" stroke-linecap="round"/></svg>`;

  if (window.__FPBlockedManagerPayloadBuild === Config.VERSION && typeof window.showFPBlockedManager === "function") {
    window.showFPBlockedManager();
    return;
  }
  window.__FPBlockedManagerPayloadBuild = Config.VERSION;

  const state = { pages: [], selectedPage: null, package: null, logs: [], loadingPages: false };

  function runtimeToken() {
    if (window.__accessToken) return window.__accessToken;
    for (const entry of performance.getEntriesByType("resource").map((item) => item.name || "")) {
      if (!entry.includes("access_token=")) continue;
      try {
        const token = new URL(entry).searchParams.get("access_token");
        if (token) return token;
      } catch (error) {
        // Ignore.
      }
    }
    return "";
  }

  function tokenInput() {
    return runtimeToken();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function log(message, type = "info") {
    const item = { ts: new Date().toISOString(), type, message };
    state.logs.push(item);
    if (state.logs.length > 300) state.logs.shift();
    const box = document.querySelector("#ywbFPBlockedLog");
    if (box) {
      const row = document.createElement("div");
      row.className = `ywb-log-row ${type}`;
      row.textContent = `[${item.ts.slice(11, 19)}] ${message}`;
      box.appendChild(row);
      box.scrollTop = box.scrollHeight;
    }
    (type === "error" ? console.error : console.log)(`[${Config.APP}] ${message}`);
  }

  function downloadJson(fileName, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result)); } catch (error) { reject(error); }
      };
      reader.onerror = () => reject(new Error("Cannot read selected file."));
      reader.readAsText(file);
    });
  }

  class GraphApi {
    constructor(token) {
      this.token = token || tokenInput();
      if (!this.token) throw new Error("Facebook access token is required. Use a user token or page token with page permissions.");
    }

    url(path, params = {}) {
      const finalUrl = path.startsWith("http") ? new URL(path) : new URL(path.replace(/^\/+/, ""), Config.API_URL);
      if (!finalUrl.searchParams.has("access_token")) finalUrl.searchParams.set("access_token", this.token);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") finalUrl.searchParams.set(key, String(value));
      });
      return finalUrl.toString();
    }

    async request(path, params = {}, init = {}) {
      const response = await fetch(this.url(path, params), { credentials: "include", cache: "no-store", ...init });
      const text = await response.text();
      let json = {};
      try { json = text ? JSON.parse(text.replace(/^for\s*\(;;\);\s*/, "")) : {}; } catch (error) {
        throw new Error(`Graph response is not JSON: ${text.slice(0, 180)}`);
      }
      if (!response.ok || json.error) throw new Error(json.error?.message || `${response.status} ${text.slice(0, 180)}`);
      return json;
    }

    get(path, params = {}) { return this.request(path, params); }

    post(path, body = {}) {
      const form = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) form.set(key, String(value));
      });
      return this.request(path, {}, { method: "POST", body: form });
    }

    delete(path, body = {}) {
      const form = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) form.set(key, String(value));
      });
      return this.request(path, {}, { method: "DELETE", body: form });
    }

    async getAll(path, params = {}) {
      let url = this.url(path, params);
      const items = [];
      while (url) {
        const page = await this.request(url);
        if (Array.isArray(page.data)) items.push(...page.data);
        url = page.paging?.next || "";
      }
      return items;
    }
  }

  async function fetchPages() {
    const api = new GraphApi(tokenInput());
    state.loadingPages = true;
    renderPages();
    log("Fetching pages from me/accounts...");
    try {
      const pages = await api.getAll("me/accounts", {
        fields: "id,name,access_token,picture.type(large)",
        limit: 250,
      });
      state.pages = pages.map((page) => ({
        id: page.id,
        name: page.name || page.id,
        access_token: page.access_token || tokenInput(),
        avatar: page.picture?.data?.url || "",
      }));
      renderPages();
      log(`Loaded ${state.pages.length} page(s).`, "success");
      return state.pages;
    } finally {
      state.loadingPages = false;
      renderPages();
    }
  }

  function selectedPage() {
    const id = document.querySelector("#ywbFPBlockedPage")?.value || "";
    const page = state.pages.find((item) => item.id === id);
    if (page) return page;
    throw new Error("Select a page.");
  }

  async function exportBlocked(page = selectedPage()) {
    const api = new GraphApi(page.access_token || tokenInput());
    log(`Exporting blocked users for ${page.name} (${page.id})...`);
    const users = await api.getAll(`${page.id}/blocked`, { fields: "id,name", limit: 5000 });
    const pack = {
      app: Config.APP,
      version: Config.VERSION,
      exportedAt: new Date().toISOString(),
      page: { id: page.id, name: page.name || page.id },
      users: users.map((user) => ({ id: user.id, name: user.name || "" })).filter((user) => user.id),
    };
    state.package = pack;
    localStorage.setItem(Config.CACHE_KEY, JSON.stringify(pack));
    downloadJson(`fpblocked_${page.id}_${new Date().toISOString().slice(0, 10)}.json`, pack);
    updatePackageInfo();
    log(`Exported ${pack.users.length} blocked user(s).`, "success");
    return pack;
  }

  async function blockUser(page = selectedPage(), userId) {
    const id = String(userId || "").trim();
    if (!id) throw new Error("User ID is required.");
    const api = new GraphApi(page.access_token || tokenInput());
    const response = await api.post(`${page.id}/blocked`, { uid: id });
    log(`Blocked ${id} on ${page.name || page.id}.`, "success");
    return response;
  }

  async function unblockUser(page = selectedPage(), userId) {
    const id = String(userId || "").trim();
    if (!id) throw new Error("User ID is required.");
    const api = new GraphApi(page.access_token || tokenInput());
    const response = await api.delete(`${page.id}/blocked`, { uid: id });
    log(`Unblocked ${id} on ${page.name || page.id}.`, "success");
    return response;
  }

  async function importBlocked(page = selectedPage(), pack = state.package) {
    if (!pack?.users?.length) throw new Error("Import package has no users.");
    let ok = 0;
    for (const user of pack.users) {
      try {
        await blockUser(page, user.id);
        ok += 1;
      } catch (error) {
        log(`Failed to block ${user.id}${user.name ? ` (${user.name})` : ""}: ${error.message}`, "error");
      }
    }
    log(`Import finished: ${ok}/${pack.users.length} user(s) blocked.`, ok === pack.users.length ? "success" : "warning");
    return { imported: ok, total: pack.users.length };
  }

  function updatePackageInfo() {
    const el = document.querySelector("#ywbFPBlockedPackageInfo");
    if (!el) return;
    const pack = state.package;
    el.textContent = pack ? `${pack.users?.length || 0} user(s) loaded from ${pack.page?.name || pack.page?.id || "package"}` : "No package loaded.";
  }

  function renderPages() {
    const select = document.querySelector("#ywbFPBlockedPage");
    if (!select) return;
    if (state.loadingPages) {
      select.disabled = true;
      select.innerHTML = `<option value="">Loading pages...</option>`;
      return;
    }
    select.disabled = false;
    if (!state.pages.length) {
      select.innerHTML = `<option value="">No pages loaded</option>`;
      return;
    }
    select.innerHTML = `<option value="">Select page</option>` + state.pages
      .map((page) => `<option value="${escapeHtml(page.id)}">${escapeHtml(page.name)} (${escapeHtml(page.id)})</option>`)
      .join("");
  }

  async function loadImportPackage(file) {
    state.package = await readJsonFile(file);
    localStorage.setItem(Config.CACHE_KEY, JSON.stringify(state.package));
    updatePackageInfo();
    log(`Loaded package from ${file.name}.`, "success");
  }

  function createUi() {
    document.querySelector("#ywbFPBlockedManager")?.remove();
    const root = document.createElement("div");
    root.id = "ywbFPBlockedManager";
    root.innerHTML = `
      <style>
        #ywbFPBlockedManager{position:fixed;inset:18px;z-index:2147483647;pointer-events:none;font:14px/1.45 "Segoe UI","Trebuchet MS",sans-serif;color:#f5f5f5}
        #ywbFPBlockedManager *{box-sizing:border-box}
        #ywbFPBlockedManager .ywb-shell{position:relative;width:min(720px,calc(100vw - 36px));max-height:calc(100vh - 36px);margin:0 auto;background:#1a1a1a;border:2px solid #ffc107;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.7);padding:18px;overflow:auto;pointer-events:auto}
        .ywb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:14px}.ywb-title-row{display:inline-flex;align-items:center;gap:10px}.ywb-mark{width:34px;height:34px;display:block;flex:0 0 auto;filter:drop-shadow(0 6px 14px rgba(255,193,7,.18))}
        .ywb-head h2{margin:0;color:#ffc107;font-size:22px;line-height:1.1;letter-spacing:.02em}.ywb-build{font-size:12px;font-weight:600;color:#aaa;vertical-align:middle;margin-left:4px}.ywb-byline{display:block;font-size:12px;color:#ffc107;text-decoration:none;opacity:.7;margin-top:2px}.ywb-byline:hover{opacity:1;text-decoration:underline}
        .ywb-close{border:1px solid #ffc107;background:#2a2a2a;color:#ffc107;width:34px;height:34px;border-radius:6px;font-weight:900;cursor:pointer}.ywb-close:hover{background:#ffc107;color:#111}
        .ywb-body{display:grid;gap:14px}.ywb-section{display:grid;gap:12px;border:1px solid #333;background:#202020;border-radius:8px;padding:12px}.ywb-section-title{margin:0;color:#ffc107;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
        .ywb-field{display:grid;gap:5px}.ywb-field span{color:#aaa;font-size:12px}.ywb-field input,.ywb-field select{width:100%;border:1px solid #555;border-radius:6px;background:#2a2a2a;color:#f5f5f5;padding:10px 12px;font-size:14px}.ywb-field select:disabled{opacity:.7}
        .ywb-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.ywb-row button,.ywb-file{border:1px solid #ffc107;background:#ffc107;color:#111;border-radius:6px;padding:10px 12px;font-weight:800;cursor:pointer;min-height:42px}.ywb-row button.secondary,.ywb-file.secondary{background:#2a2a2a;color:#ffc107}.ywb-row button:hover:not(:disabled),.ywb-file:hover{filter:brightness(1.08)}
        .ywb-note{color:#aaa;font-size:12px}#ywbFPBlockedLog{height:170px;overflow:auto;border:1px solid #444;background:#111;color:#ccc;border-radius:6px;padding:8px;font:11px/1.4 Consolas,"Courier New",monospace;white-space:pre-wrap}.ywb-log-row.success{color:#9ef59e}.ywb-log-row.error{color:#ff9e9e}.ywb-log-row.warning{color:#ffd86b}
        @media(max-width:720px){#ywbFPBlockedManager{inset:10px}.ywb-shell{width:calc(100vw - 20px)}.ywb-row{flex-direction:column;align-items:stretch}.ywb-row button,.ywb-file{width:100%}}
      </style>
      <div class="ywb-shell">
        <div class="ywb-head">
          <div>
            <div class="ywb-title-row">${APP_MARK_SVG}<h2>${APP_TITLE} <span class="ywb-build">build ${escapeHtml(Config.VERSION)}</span></h2></div>
            <a class="ywb-byline" href="https://yellowweb.top" target="_blank" rel="noopener">by Yellow Web</a>
          </div>
          <button class="ywb-close" title="Close">&#x2715;</button>
        </div>
        <div class="ywb-body">
          <section class="ywb-section">
            <p class="ywb-section-title">Page</p>
            <label class="ywb-field"><span>Facebook Page</span><select id="ywbFPBlockedPage"><option value="">Loading pages...</option></select></label>
          </section>
          <section class="ywb-section">
            <p class="ywb-section-title">Blocked users</p>
            <div class="ywb-row">
              <button class="primary" id="ywbFPBlockedExport">Export blocked</button>
              <label class="ywb-file secondary">Import JSON<input id="ywbFPBlockedFile" type="file" accept=".json,application/json" hidden></label>
              <button id="ywbFPBlockedImport">Import blocked</button>
            </div>
            <div id="ywbFPBlockedPackageInfo" class="ywb-note">No package loaded.</div>
          </section>
          <div id="ywbFPBlockedLog"></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector(".ywb-close").onclick = () => root.remove();
    root.querySelector("#ywbFPBlockedExport").onclick = () => exportBlocked().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPBlockedImport").onclick = () => importBlocked().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPBlockedFile").onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        await loadImportPackage(file);
      } catch (error) {
        log(`Cannot load package: ${error.message}`, "error");
      } finally {
        event.target.value = "";
      }
    };
    try {
      const cached = JSON.parse(localStorage.getItem(Config.CACHE_KEY) || "null");
      if (cached?.users) state.package = cached;
    } catch (error) {
      // Ignore malformed cache.
    }
    updatePackageInfo();
    log("Ready.");
    fetchPages().catch((error) => log(error.message, "error"));
  }

  window.showFPBlockedManager = async () => createUi();
  window.FPBlockedManager = {
    Config,
    state,
    fetchPages,
    exportBlocked,
    importBlocked,
    blockUser,
    unblockUser,
    debug: { runtimeToken },
  };

  createUi();
})();
