const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const listEl = document.getElementById("items");
const msgEl = document.getElementById("message");
const searchEl = document.getElementById("search");
const dialog = document.getElementById("addDialog");

let allItems = [];
let alerts = { low: [], soon: [], expired: [] };
let shownOnce = false;
const alertDialog = document.getElementById("alertDialog");
const alertBtn = document.getElementById("alertBtn");

function todayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function daysLeft(dateStr) {
  return Math.round((new Date(dateStr) - new Date(todayStr())) / 86400000);
}
function labelOf(item) {
  return item ? item.name + (item.size ? " (" + item.size + ")" : "") : "Unknown item";
}

function buildAlerts(batches) {
  const byId = {};
  allItems.forEach(i => byId[i.id] = i);
  alerts.low = allItems.filter(i =>
    i.low_stock_threshold !== null && i.low_stock_threshold !== undefined && i.low_stock_threshold !== "" &&
    i.total <= Number(i.low_stock_threshold));
  alerts.soon = batches
    .filter(b => b.status === "active" && Number(b.quantity) > 0 && b.expiry_date && daysLeft(b.expiry_date) <= 2)
    .sort((x, y) => (x.expiry_date < y.expiry_date ? -1 : 1));
  alerts.expired = batches.filter(b => b.status === "expired" && Number(b.quantity) > 0);
  alerts.byId = byId;

  const count = alerts.low.length + alerts.soon.length + alerts.expired.length;
  alertBtn.hidden = count === 0;
  alertBtn.textContent = "\u26A0 Alerts (" + count + ")";
  if (count === 0 && alertDialog.open) alertDialog.close();
  if (alertDialog.open) fillAlerts();
  if (count > 0 && !shownOnce) { shownOnce = true; showAlerts(); }
}

function addSection(body, title, rows) {
  if (rows.length === 0) return;
  const sec = document.createElement("div");
  sec.className = "asec";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  sec.appendChild(h3);
  rows.forEach(r => sec.appendChild(r));
  body.appendChild(sec);
}

function makeRow(text, buttonText, onClick) {
  const d = document.createElement("div");
  d.className = "arow";
  d.textContent = text;
  if (buttonText) {
    const b = document.createElement("button");
    b.textContent = buttonText;
    b.onclick = onClick;
    d.appendChild(b);
  }
  return d;
}

function fillAlerts() {
  const body = document.getElementById("alertBody");
  body.innerHTML = "";
  const unitOf = id => (alerts.byId[id] && alerts.byId[id].unit) || "";
  addSection(body, "Running low", alerts.low.map(i =>
    makeRow(labelOf(i) + ": " + i.total + " " + (i.unit || "") + " left")));
  addSection(body, "Expiring soon", alerts.soon.map(b => {
    const d = daysLeft(b.expiry_date);
    const when = d <= 0 ? "today" : d === 1 ? "tomorrow" : "in " + d + " days";
    return makeRow(labelOf(alerts.byId[b.item_id]) + ": " + b.quantity + " " + unitOf(b.item_id) +
      " expires " + b.expiry_date + " (" + when + ")");
  }));
  addSection(body, "Expired, not yet removed", alerts.expired.map(b =>
    makeRow(labelOf(alerts.byId[b.item_id]) + ": " + b.quantity + " " + unitOf(b.item_id) +
      " expired on " + b.expiry_date, "Mark removed", async () => {
        const { error } = await db.from("batches").update({ status: "removed" }).eq("id", b.id);
        if (error) { say("Could not mark it removed: " + error.message, true); return; }
        loadItems();
      })));
}

function showAlerts() {
  fillAlerts();
  if (!alertDialog.open) alertDialog.showModal();
}
alertBtn.onclick = showAlerts;
document.getElementById("alertClose").onclick = () => alertDialog.close();

function say(text, isError = false) {
  msgEl.textContent = text;
  msgEl.className = "message" + (isError ? " error" : "");
}

let QKEY = "shopstock_queue", CKEY = "shopstock_cache";
const getQ = () => JSON.parse(localStorage.getItem(QKEY) || "[]");
const setQ = q => localStorage.setItem(QKEY, JSON.stringify(q));
const statusEl = document.getElementById("status");

function updateStatus() {
  const n = getQ().length;
  const offline = !navigator.onLine;
  statusEl.hidden = !offline && n === 0;
  statusEl.textContent = (offline ? "No internet. " : "") + (n ? n + " update(s) waiting to be saved online." : "Showing your last saved stock.");
}

// Sales and restocks are always put in a waiting list first, then saved online when there is internet
function queueAction(action) {
  const q = getQ();
  q.push(action);
  setQ(q);
}

async function syncQueue() {
  if (!navigator.onLine) return;
  const q = getQ();
  while (q.length) {
    const a = q[0];
    const err = a.type === "sale" ? await processSale(a, () => setQ(q)) : await processRestock(a);
    if (err) { say("Could not save an update online: " + err, true); return; }
    q.shift();
    setQ(q);
  }
}

async function processRestock(a) {
  const { error } = await db.from("batches").insert({
    item_id: a.item_id, quantity: a.qty, expiry_date: a.expiry || null, date_added: a.ts, status: "active"
  });
  return error ? error.message : null;
}

async function processSale(a, save) {
  const { data: batches, error: bErr } = await db.from("batches")
    .select("id, quantity, expiry_date, date_added")
    .eq("item_id", a.item_id).eq("status", "active").gt("quantity", 0);
  if (bErr) return bErr.message;
  // The batch expiring first is used first
  batches.sort((x, y) => {
    if (x.expiry_date && y.expiry_date && x.expiry_date !== y.expiry_date) return x.expiry_date < y.expiry_date ? -1 : 1;
    if (x.expiry_date && !y.expiry_date) return -1;
    if (!x.expiry_date && y.expiry_date) return 1;
    return x.date_added < y.date_added ? -1 : 1;
  });
  let left = a.qty;
  const plan = [];
  for (const b of batches) {
    if (left <= 0) break;
    const take = Math.min(Number(b.quantity), left);
    plan.push({ batch: b, take });
    left -= take;
  }
  if (!a.saleId) {
    const { data: sale, error } = await db.from("sales")
      .insert({ item_id: a.item_id, quantity_sold: a.qty, date_sold: a.ts }).select().single();
    if (error) return error.message;
    a.saleId = sale.id;
    save();
  }
  if (plan.length && !a.detailsDone) {
    const { error } = await db.from("sale_details")
      .insert(plan.map(p => ({ sale_id: a.saleId, batch_id: p.batch.id, quantity: p.take })));
    if (error) return error.message;
    a.detailsDone = true;
    save();
  }
  for (const p of plan) {
    const { error } = await db.from("batches")
      .update({ quantity: Number(p.batch.quantity) - p.take }).eq("id", p.batch.id);
    if (error) return error.message;
  }
  return null;
}

function applyPending(items) {
  for (const a of getQ()) {
    const it = items.find(i => i.id === a.item_id);
    if (it) it.total = Math.max(0, it.total + (a.type === "restock" ? a.qty : -a.qty));
  }
}

// Load items, then add up the active batches to get the remaining stock of each
async function loadItems() {
  say("Loading...");
  await syncQueue();
  let itemsData = null, batches = null;
  if (navigator.onLine) {
    const [itemsRes, batchesRes] = await Promise.all([
      db.from("items").select("*").order("name"),
      db.from("batches").select("id, item_id, quantity, expiry_date, status")
    ]);
    if (!itemsRes.error && !batchesRes.error) { itemsData = itemsRes.data; batches = batchesRes.data; }
  }

  if (!itemsData) {
    // No internet: show the last saved copy, plus anything recorded since
    const c = JSON.parse(localStorage.getItem(CKEY) || "null");
    if (!c) { say("No internet and nothing saved on this phone yet. Open the app once with internet.", true); return; }
    allItems = c.items;
    applyPending(allItems);
    render(); buildAlerts(c.batches); updateStatus();
    return;
  }

  // Batches whose expiry date has passed get marked "expired" so they stop counting as stock
  const today = todayStr();
  const toExpire = batches.filter(b => b.status === "active" && b.expiry_date && b.expiry_date < today);
  if (toExpire.length) {
    const { error } = await db.from("batches").update({ status: "expired" }).in("id", toExpire.map(b => b.id));
    if (error) console.error(error);
    toExpire.forEach(b => b.status = "expired");
  }

  const totals = {};
  for (const b of batches) {
    if (b.status === "active") totals[b.item_id] = (totals[b.item_id] || 0) + Number(b.quantity);
  }
  allItems = itemsData.map(i => ({ ...i, total: totals[i.id] || 0 }));
  localStorage.setItem(CKEY, JSON.stringify({ items: allItems, batches }));
  applyPending(allItems);
  render(); buildAlerts(batches); updateStatus();
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const shown = allItems.filter(i => (i.name + " " + (i.size || "")).toLowerCase().includes(q));
  listEl.innerHTML = "";
  if (allItems.length === 0) say("No items yet. Tap \"+ Add item\" to add your first one.");
  else if (shown.length === 0) say("No item matches your search.");
  else say("");
  for (const i of shown) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div><div class="name"></div><div class="size"></div></div>
      <div class="qty"><span></span><small></small></div>
      <div class="btns"><button class="sell">Sell</button><button class="add">Restock</button></div>`;
    li.querySelector(".name").textContent = i.name;
    li.querySelector(".size").textContent = i.size || "";
    li.querySelector(".qty span").textContent = i.total;
    li.querySelector(".qty small").textContent = i.unit || "";
    li.querySelector(".sell").onclick = () => openSale(i);
    li.querySelector(".add").onclick = () => openRestock(i);
    listEl.appendChild(li);
  }
}

let restockItem = null;
const stockDialog = document.getElementById("stockDialog");

function openRestock(item) {
  restockItem = item;
  document.getElementById("stockTitle").textContent =
    "Restock " + item.name + (item.size ? " (" + item.size + ")" : "") + (item.unit ? ", in " + item.unit : "");
  document.getElementById("stockForm").reset();
  stockDialog.showModal();
}

document.getElementById("stockCancel").onclick = () => stockDialog.close();

document.getElementById("stockForm").addEventListener("submit", (e) => {
  const qty = Number(document.getElementById("sQty").value);
  if (!qty || !restockItem) return;
  queueAction({ type: "restock", item_id: restockItem.id, qty,
    expiry: document.getElementById("sExp").value || null, ts: new Date().toISOString() });
  loadItems();
});

let saleItem = null;
const saleDialog = document.getElementById("saleDialog");

function openSale(item) {
  saleItem = item;
  document.getElementById("saleTitle").textContent =
    "Sell " + item.name + (item.size ? " (" + item.size + ")" : "") + (item.unit ? ", in " + item.unit : "");
  document.getElementById("saleForm").reset();
  saleDialog.showModal();
}

document.getElementById("saleCancel").onclick = () => saleDialog.close();

document.getElementById("saleForm").addEventListener("submit", (e) => {
  const qty = Number(document.getElementById("qSold").value);
  if (!qty || !saleItem) return;
  // Warn (but do not block) if the sale is bigger than the recorded stock
  if (qty > saleItem.total && !confirm("Only " + saleItem.total + " is recorded in stock. Record the sale of " + qty + " anyway?")) {
    e.preventDefault();
    return;
  }
  queueAction({ type: "sale", item_id: saleItem.id, qty, ts: new Date().toISOString() });
  loadItems();
});

searchEl.addEventListener("input", render);
document.getElementById("addBtn").onclick = () => dialog.showModal();
document.getElementById("cancelBtn").onclick = () => dialog.close();

document.getElementById("addForm").addEventListener("submit", async (e) => {
  const name = document.getElementById("fName").value.trim();
  if (!name) return;
  const row = {
    name,
    size: document.getElementById("fSize").value.trim() || null,
    unit: document.getElementById("fUnit").value.trim() || null,
    low_stock_threshold: document.getElementById("fLow").value || null
  };
  const { error } = await db.from("items").insert(row);
  if (error) { say("Could not save the item: " + error.message, true); return; }
  e.target.reset();
  loadItems();
});

window.addEventListener("online", init);
window.addEventListener("offline", updateStatus);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---- Login ----
const appView = document.getElementById("appView");
const authView = document.getElementById("authView");
const authMsg = document.getElementById("authMsg");

function showLogin() {
  appView.hidden = true;
  authView.hidden = false;
}

function startApp(user) {
  // Each person's saved copy and waiting list are kept separately on the phone
  QKEY = "shopstock_queue_" + user.id;
  CKEY = "shopstock_cache_" + user.id;
  localStorage.setItem("shopstock_last_user", user.id);
  shownOnce = false;
  authView.hidden = true;
  appView.hidden = false;
  loadItems();
}

async function init() {
  const { data } = await db.auth.getSession();
  if (data && data.session) { startApp(data.session.user); return; }
  const last = localStorage.getItem("shopstock_last_user");
  if (!navigator.onLine && last) { startApp({ id: last }); return; }  // offline: keep working
  showLogin();
}

document.getElementById("signInBtn").onclick = async () => {
  authMsg.textContent = "Signing in...";
  const { data, error } = await db.auth.signInWithPassword({
    email: document.getElementById("aEmail").value.trim(),
    password: document.getElementById("aPass").value
  });
  if (error) { authMsg.textContent = error.message; return; }
  authMsg.textContent = "";
  startApp(data.user);
};

document.getElementById("signUpBtn").onclick = async () => {
  authMsg.textContent = "Creating account...";
  const { data, error } = await db.auth.signUp({
    email: document.getElementById("aEmail").value.trim(),
    password: document.getElementById("aPass").value
  });
  if (error) { authMsg.textContent = error.message; return; }
  if (data.session) { authMsg.textContent = ""; startApp(data.user); }
  else authMsg.textContent = "Account created. Check your email to confirm it, then sign in.";
};

document.getElementById("signOutBtn").onclick = async () => {
  await db.auth.signOut();
  localStorage.removeItem("shopstock_last_user");
  showLogin();
};

init();
