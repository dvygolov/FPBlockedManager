(() => {
  "use strict";

  const Config = {
    VERSION: "200526b1",
    APP: "FPBlockedManager",
    API_URL: "https://graph.facebook.com/v23.0/",
    CACHE_KEY: "fpblockedmanager.lastPackage.v1",
  };

  if (window.__FPBlockedManagerPayloadBuild === Config.VERSION && typeof window.showFPBlockedManager === "function") {
    window.showFPBlockedManager();
    return;
  }
  window.__FPBlockedManagerPayloadBuild = Config.VERSION;

  const state = { pages: [], selectedPage: null, package: null, logs: [] };

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
    return document.querySelector("#ywbFPBlockedToken")?.value.trim() || runtimeToken();
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
    log("Fetching pages from me/accounts...");
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
  }

  function selectedPage() {
    const id = document.querySelector("#ywbFPBlockedPage")?.value || "";
    const page = state.pages.find((item) => item.id === id);
    if (page) return page;
    const manualId = document.querySelector("#ywbFPBlockedManualPage")?.value.trim() || "";
    if (!manualId) throw new Error("Select a page or enter page ID.");
    return { id: manualId, name: manualId, access_token: tokenInput() };
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
    select.innerHTML = `<option value="">Select fetched page</option>` + state.pages
      .map((page) => `<option value="${page.id}">${page.name} (${page.id})</option>`)
      .join("");
  }

  function createUi() {
    document.querySelector("#ywbFPBlockedManager")?.remove();
    const root = document.createElement("div");
    root.id = "ywbFPBlockedManager";
    root.innerHTML = `
      <style>
        #ywbFPBlockedManager{position:fixed;inset:24px 24px auto auto;width:min(600px,calc(100vw - 32px));max-height:calc(100vh - 48px);z-index:2147483647;background:#181818;color:#f8f0c8;border:2px solid #ffd000;border-radius:8px;box-shadow:0 24px 80px #0009;font:14px/1.45 Verdana,sans-serif;overflow:hidden}
        #ywbFPBlockedManager *{box-sizing:border-box}.ywb-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#ffd000;color:#111;font-weight:900}.ywb-close{border:0;background:#111;color:#ffd000;width:30px;height:30px;border-radius:6px;font-weight:900;cursor:pointer}
        .ywb-body{padding:14px 16px;display:grid;gap:12px;overflow:auto;max-height:calc(100vh - 112px)}.ywb-field{display:grid;gap:5px}.ywb-field span{color:#b9b09a;font-size:12px}.ywb-field input,.ywb-field select{width:100%;border:1px solid #504714;border-radius:6px;background:#111;color:#f8f0c8;padding:10px}.ywb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .ywb-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.ywb-row button,.ywb-file{border:1px solid #ffd000;background:#282300;color:#ffd000;border-radius:6px;padding:10px 12px;font-weight:800;cursor:pointer}.ywb-row button.primary{background:#ffd000;color:#111}
        #ywbFPBlockedLog{height:180px;overflow:auto;border:1px solid #403810;background:#101010;border-radius:6px;padding:8px;font:12px/1.45 Consolas,monospace}.ywb-log-row.success{color:#9ef59e}.ywb-log-row.error{color:#ff9e9e}.ywb-log-row.warning{color:#ffd86b}
        @media(max-width:720px){#ywbFPBlockedManager{inset:12px;width:calc(100vw - 24px)}.ywb-grid{grid-template-columns:1fr}}
      </style>
      <div class="ywb-head"><div>FPBlockedManager <span style="font-weight:400">${Config.VERSION}</span></div><button class="ywb-close" title="Close">X</button></div>
      <div class="ywb-body">
        <label class="ywb-field"><span>User or page access token</span><input id="ywbFPBlockedToken" placeholder="uses page runtime token if empty"></label>
        <div class="ywb-row"><button class="primary" id="ywbFPBlockedFetch">Fetch pages</button></div>
        <div class="ywb-grid">
          <label class="ywb-field"><span>Fetched page</span><select id="ywbFPBlockedPage"><option value="">Select fetched page</option></select></label>
          <label class="ywb-field"><span>Manual page ID</span><input id="ywbFPBlockedManualPage" placeholder="optional"></label>
        </div>
        <div class="ywb-row">
          <button class="primary" id="ywbFPBlockedExport">Export blocked</button>
          <label class="ywb-file">Load JSON<input id="ywbFPBlockedFile" type="file" accept=".json,application/json" hidden></label>
          <button id="ywbFPBlockedImport">Import blocked</button>
        </div>
        <div class="ywb-grid">
          <label class="ywb-field"><span>User ID</span><input id="ywbFPBlockedUserId" placeholder="1000..."></label>
          <div class="ywb-row" style="align-self:end"><button id="ywbFPBlockedOne">Block</button><button id="ywbFPUnblockedOne">Unblock</button></div>
        </div>
        <div id="ywbFPBlockedPackageInfo">No package loaded.</div>
        <div id="ywbFPBlockedLog"></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector(".ywb-close").onclick = () => root.remove();
    root.querySelector("#ywbFPBlockedFetch").onclick = () => fetchPages().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPBlockedExport").onclick = () => exportBlocked().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPBlockedImport").onclick = () => importBlocked().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPBlockedOne").onclick = () => blockUser(selectedPage(), root.querySelector("#ywbFPBlockedUserId").value).catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPUnblockedOne").onclick = () => unblockUser(selectedPage(), root.querySelector("#ywbFPBlockedUserId").value).catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPBlockedFile").onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        state.package = await readJsonFile(file);
        localStorage.setItem(Config.CACHE_KEY, JSON.stringify(state.package));
        updatePackageInfo();
        log(`Loaded package from ${file.name}.`, "success");
      } catch (error) {
        log(`Cannot load package: ${error.message}`, "error");
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
