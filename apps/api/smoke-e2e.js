/**
 * End-to-end smoke test for hotel POS (v1.4.23 packs).
 * Run: node smoke-e2e.js  (from apps/api with API on :4000)
 */
const BASE = process.env.API_URL || "http://localhost:4000/api";

async function req(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function login(username, password) {
  const r = await req("POST", "/auth/login", null, { username, password });
  assert(r.ok && r.data?.token, `login ${username}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

const results = [];
function pass(name) {
  results.push({ name, ok: true });
  console.log(`  OK  ${name}`);
}
function fail(name, err) {
  results.push({ name, ok: false, err: String(err?.message || err) });
  console.log(`  FAIL ${name}: ${err?.message || err}`);
}

(async () => {
  console.log("\n=== SMOKE E2E ===\n");

  // --- Health ---
  try {
    const h = await req("GET", "/health");
    assert(h.ok && h.data?.ok, "health not ok");
    assert(h.data.version, "no version");
    pass(`health v${h.data.version}`);
  } catch (e) {
    fail("health", e);
    process.exit(1);
  }

  // --- Logins ---
  let admin, kitchen, waiter, supervisor, cashier;
  try {
    admin = await login("admin", "admin123");
    assert(admin.user.permissions.includes("kitchen.update"), "admin missing kitchen.update");
    pass("login admin");
  } catch (e) {
    fail("login admin", e);
  }
  try {
    kitchen = await login("kitchen", "kitchen123");
    assert(kitchen.user.permissions.includes("kitchen.update"), "kitchen missing update");
    pass("login kitchen");
  } catch (e) {
    fail("login kitchen", e);
  }
  try {
    waiter = await login("waiter", "waiter123");
    assert(waiter.user.permissions.includes("kitchen.view"), "waiter missing kitchen.view");
    assert(waiter.user.permissions.includes("print.kot"), "waiter missing print.kot");
    pass("login waiter (+kitchen.view/kot)");
  } catch (e) {
    fail("login waiter", e);
  }
  try {
    supervisor = await login("supervisor", "super123");
    assert(supervisor.user.permissions.includes("kitchen.update"), "supervisor missing kitchen.update");
    pass("login supervisor (+kitchen.update)");
  } catch (e) {
    fail("login supervisor", e);
  }
  try {
    cashier = await login("cashier", "cashier123");
    pass("login cashier");
  } catch (e) {
    // try maincashier variants
    try {
      cashier = await login("cashier1", "cashier123");
      pass("login cashier1");
    } catch (e2) {
      fail("login cashier", e);
    }
  }

  const at = admin?.token;
  if (!at) {
    console.log("\nAbort: no admin token\n");
    process.exit(1);
  }

  // --- Core reads ---
  try {
    const m = await req("GET", "/menu", at);
    assert(m.ok && Array.isArray(m.data) && m.data.length > 0, "menu empty/fail");
    pass(`menu (${m.data.length} items)`);
  } catch (e) {
    fail("menu", e);
  }

  try {
    const t = await req("GET", "/tables", at);
    assert(t.ok && (Array.isArray(t.data) || t.data?.tables || t.data?.partitions), "tables fail");
    pass("tables board");
  } catch (e) {
    fail("tables", e);
  }

  try {
    const k = await req("GET", "/orders/kitchen", kitchen?.token || at);
    assert(k.ok && Array.isArray(k.data), "kitchen list fail");
    pass(`kitchen list (${k.data.length})`);
  } catch (e) {
    fail("kitchen list", e);
  }

  try {
    const b = await req("GET", "/orders?view=billing&paymentStatus=UNPAID", at);
    const p = await req("GET", "/orders?view=billing&paymentStatus=PARTIAL", at);
    assert(b.ok && Array.isArray(b.data), "billing unpaid fail");
    assert(p.ok && Array.isArray(p.data), "billing partial fail");
    pass(`billing unpaid=${b.data.length} partial=${p.data.length}`);
  } catch (e) {
    fail("billing lists", e);
  }

  try {
    const d = await req("GET", "/dashboard", at);
    assert(d.ok && d.data, "dashboard fail");
    assert(typeof d.data.served === "number", "dashboard missing served");
    assert(typeof d.data.staleCount === "number", "dashboard missing staleCount");
    assert(typeof d.data.revenueToday === "number", "dashboard missing revenueToday");
    pass(
      `dashboard served=${d.data.served} completed=${d.data.completed} collected=${d.data.revenueToday} unpaid=${d.data.unpaidCount}`
    );
  } catch (e) {
    fail("dashboard", e);
  }

  try {
    const c = await req("GET", "/credit-customers", at);
    assert(c.ok && Array.isArray(c.data), "credit list fail");
    pass(`credit customers (${c.data.length})`);
  } catch (e) {
    fail("credit list", e);
  }

  try {
    const f = await req("GET", "/finance/day-pnl", at);
    assert(f.ok, `finance day-pnl ${f.status}`);
    pass("finance day-pnl");
  } catch (e) {
    fail("finance day-pnl", e);
  }

  try {
    const s = await req("GET", "/system/hotel", at);
    assert(s.ok, "hotel status fail");
    pass(`hotel accepting=${s.data?.acceptingOrders ?? s.data?.open ?? "?"}`);
  } catch (e) {
    fail("hotel status", e);
  }

  // --- E2E order: create → kitchen → pay ---
  let orderId = null;
  let orderNo = null;
  let menuItem = null;
  let cashierId = null;
  try {
    const cashiers = await req("GET", "/payments/cashiers", at);
    assert(cashiers.ok && cashiers.data?.length, "no cashiers");
    cashierId = cashiers.data[0].id;

    const menu = await req("GET", "/menu", at);
    menuItem = (menu.data || []).find((i) => i.active !== false && i.sellingPrice > 0) || menu.data?.[0];
    assert(menuItem?.id, "no menu item");

    const tables = await req("GET", "/tables", at);
    const board = tables.data;
    let tableId = null;
    const tableRows = board?.tables || (Array.isArray(board) ? board : []);
    if (tableRows.length) {
      const free = tableRows.find((t) => !t.busy && !t.openOrder && !t.openOrderId);
      tableId = free?.id || tableRows.find((t) => !t.openOrder)?.id || null;
    }

    const createBody = {
      items: [{ menuItemId: menuItem.id, quantity: menuItem.minQty || 1 }],
      assignedCashierId: cashierId,
      ...(tableId ? { tableId } : { tableNo: `SMOKE-${Date.now() % 10000}` }),
    };
    const created = await req("POST", "/orders", waiter?.token || at, createBody);
    assert(created.ok, `create order ${created.status} ${JSON.stringify(created.data)}`);
    orderId = created.data.id;
    orderNo = created.data.orderNo;
    assert(created.data.status === "PENDING" || created.data.status, "no status");
    pass(`create order #${orderNo} id=${orderId.slice(-6)}`);
  } catch (e) {
    fail("create order", e);
  }

  if (orderId) {
    const kt = kitchen?.token || at;
    try {
      let r = await req("PATCH", `/orders/${orderId}/status`, kt, { status: "PREPARING" });
      assert(r.ok, `PREPARING ${r.status} ${JSON.stringify(r.data)}`);
      assert(r.data.status === "PREPARING", `got ${r.data.status}`);
      pass("kitchen PENDING→PREPARING");

      r = await req("PATCH", `/orders/${orderId}/status`, kt, { status: "READY" });
      assert(r.ok, `READY ${r.status} ${JSON.stringify(r.data)}`);
      assert(r.data.status === "READY", `got ${r.data.status}`);
      pass("kitchen PREPARING→READY");

      r = await req("PATCH", `/orders/${orderId}/status`, kt, { status: "SERVED" });
      assert(r.ok, `SERVED ${r.status} ${JSON.stringify(r.data)}`);
      assert(r.data.status === "SERVED", `got ${r.data.status}`);
      pass("kitchen READY→SERVED (table still open until pay)");
    } catch (e) {
      fail("kitchen status machine", e);
    }

    // Invalid jump should 400
    try {
      const bad = await req("PATCH", `/orders/${orderId}/status`, kt, { status: "PENDING" });
      assert(!bad.ok && bad.status === 400, `expected 400 got ${bad.status}`);
      pass("kitchen rejects illegal transition");
    } catch (e) {
      fail("kitchen illegal transition", e);
    }

    // Pay (full)
    try {
      const payUser = cashier?.token || at;
      const o = await req("GET", `/orders/${orderId}`, at);
      const amount = Math.max(
        1,
        Number(o.data.total) - Number(o.data.discountAmount || 0) + Number(o.data.taxAmount || 0)
      );
      const paid = await req("POST", `/orders/${orderId}/pay`, payUser, {
        amount,
        method: "CASH",
      });
      assert(paid.ok, `pay ${paid.status} ${JSON.stringify(paid.data)}`);
      assert(paid.data.paymentStatus === "PAID", `pay status ${paid.data.paymentStatus}`);
      assert(paid.data.status === "COMPLETED", `after pay expected COMPLETED got ${paid.data.status}`);
      pass(`pay → PAID + COMPLETED (#${orderNo})`);
    } catch (e) {
      fail("pay order", e);
    }
  }

  // --- Partial pay + billing visibility + reverse ---
  try {
    assert(cashierId && menuItem, "need cashier+menu");
    const created = await req("POST", "/orders", at, {
      items: [{ menuItemId: menuItem.id, quantity: menuItem.minQty || 1 }],
      assignedCashierId: cashierId,
      tableNo: `PART-${Date.now() % 10000}`,
    });
    assert(created.ok, `partial create ${created.status} ${JSON.stringify(created.data)}`);
    const oid = created.data.id;
    const total = Number(created.data.total);
    const half = Math.max(1, Math.round((total / 2) * 100) / 100);
    const part = await req("POST", `/orders/${oid}/pay`, cashier?.token || at, {
      amount: half,
      method: "CASH",
    });
    assert(part.ok, `partial pay ${part.status} ${JSON.stringify(part.data)}`);
    assert(part.data.paymentStatus === "PARTIAL", `expected PARTIAL got ${part.data.paymentStatus}`);
    const list = await req("GET", "/orders?view=billing&paymentStatus=PARTIAL", at);
    assert(list.ok && list.data.some((o) => o.id === oid), "PARTIAL bill missing from billing");
    pass(`partial pay + billing list (#${created.data.orderNo})`);

    // kitchen still works on PARTIAL unpaid food
    if (part.data.status === "PENDING" || part.data.status === "PREPARING") {
      const toReady = part.data.status === "PENDING"
        ? (await req("PATCH", `/orders/${oid}/status`, kitchen?.token || at, { status: "PREPARING" }),
           await req("PATCH", `/orders/${oid}/status`, kitchen?.token || at, { status: "READY" }))
        : await req("PATCH", `/orders/${oid}/status`, kitchen?.token || at, { status: "READY" });
      // ignore kitchen result for partial path if already moved
      void toReady;
    }

    const rev = await req("POST", `/orders/${oid}/reverse`, at, { reason: "smoke test reverse partial" });
    assert(rev.ok, `reverse ${rev.status} ${JSON.stringify(rev.data)}`);
    pass("reverse PARTIAL payment");
  } catch (e) {
    fail("partial pay / reverse", e);
  }

  // --- Credit release gate (must be READY/SERVED) ---
  try {
    const credits = await req("GET", "/credit-customers", at);
    assert(credits.ok && credits.data?.length, "need a credit customer");
    const creditId = credits.data[0].id;
    const tables = await req("GET", "/tables", at);
    const free = (tables.data?.tables || []).find((t) => !t.order);
    assert(free?.id, "no free table for credit");
    const created = await req("POST", "/orders", at, {
      items: [{ menuItemId: menuItem.id, quantity: menuItem.minQty || 1 }],
      assignedCashierId: cashierId,
      creditCustomerId: creditId,
      tableId: free.id,
    });
    assert(created.ok, `credit create ${created.status} ${JSON.stringify(created.data)}`);
    const oid = created.data.id;
    const early = await req("POST", `/orders/${oid}/release-credit`, at);
    assert(!early.ok && early.status === 400, `expected release block on PENDING, got ${early.status}`);
    pass("credit release blocked while PENDING");

    await req("PATCH", `/orders/${oid}/status`, kitchen?.token || at, { status: "PREPARING" });
    await req("PATCH", `/orders/${oid}/status`, kitchen?.token || at, { status: "READY" });
    const rel = await req("POST", `/orders/${oid}/release-credit`, at);
    assert(rel.ok, `release ${rel.status} ${JSON.stringify(rel.data)}`);
    assert(rel.data.status === "COMPLETED", `expected COMPLETED got ${rel.data.status}`);
    assert(rel.data.paymentStatus !== "PAID", "credit release should keep unpaid");
    pass("credit release after READY → COMPLETED (still unpaid)");

    // cash pay on credit must fail
    const badPay = await req("POST", `/orders/${oid}/pay`, cashier?.token || at, { amount: 10, method: "CASH" });
    assert(!badPay.ok, "cash pay on credit should fail");
    pass("cash pay blocked on credit bill");
  } catch (e) {
    fail("credit release gate", e);
  }

  // --- Pay-before-kitchen then SERVED→COMPLETED ---
  try {
    const created = await req("POST", "/orders", at, {
      items: [{ menuItemId: menuItem.id, quantity: menuItem.minQty || 1 }],
      assignedCashierId: cashierId,
      tableNo: `EARLY-${Date.now() % 10000}`,
    });
    assert(created.ok, `early-pay create ${JSON.stringify(created.data)}`);
    const oid = created.data.id;
    const amount = Math.max(1, Number(created.data.total));
    const paid = await req("POST", `/orders/${oid}/pay`, cashier?.token || at, { amount, method: "CASH" });
    assert(paid.ok && paid.data.paymentStatus === "PAID", `early pay ${JSON.stringify(paid.data)}`);
    assert(paid.data.status === "PENDING", `early pay should keep PENDING got ${paid.data.status}`);
    const p1 = await req("PATCH", `/orders/${oid}/status`, kitchen?.token || at, { status: "PREPARING" });
    assert(p1.ok, `prep after pay ${JSON.stringify(p1.data)}`);
    const p2 = await req("PATCH", `/orders/${oid}/status`, kitchen?.token || at, { status: "READY" });
    assert(p2.ok, `ready after pay ${JSON.stringify(p2.data)}`);
    const p3 = await req("PATCH", `/orders/${oid}/status`, kitchen?.token || at, { status: "SERVED" });
    assert(p3.ok, `served after pay ${JSON.stringify(p3.data)}`);
    assert(p3.data.status === "COMPLETED", `PAID+SERVED should COMPLETED got ${p3.data.status}`);
    pass("pay-before-kitchen → SERVED auto COMPLETED");
  } catch (e) {
    fail("pay-before-kitchen", e);
  }

  // --- Credit wire: list + get if any ---
  try {
    const list = await req("GET", "/credit-customers", at);
    if (list.data?.length) {
      const id = list.data[0].id;
      const g = await req("GET", `/credit-customers/${id}`, at);
      assert(g.ok, `credit get ${g.status}`);
      assert(typeof g.data.outstanding === "number", "no outstanding");
      pass(`credit detail outstanding=${g.data.outstanding}`);
    } else {
      pass("credit list empty (ok)");
    }
  } catch (e) {
    fail("credit detail", e);
  }

  // --- Role dashboards ---
  for (const [label, tok] of [
    ["admin dash", admin?.token],
    ["kitchen dash", kitchen?.token],
    ["cashier dash", cashier?.token],
    ["supervisor dash", supervisor?.token],
  ]) {
    if (!tok) continue;
    try {
      const d = await req("GET", "/dashboard", tok);
      assert(d.ok, `${label} ${d.status} ${JSON.stringify(d.data)}`);
      pass(label);
    } catch (e) {
      fail(label, e);
    }
  }

  // --- Supervisor kitchen list (full board) ---
  try {
    if (supervisor?.token) {
      const k = await req("GET", "/orders/kitchen", supervisor.token);
      assert(k.ok, `sup kitchen ${k.status}`);
      pass("supervisor kitchen board");
    }
  } catch (e) {
    fail("supervisor kitchen board", e);
  }

  // --- Summary ---
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  if (failed.length) {
    for (const f of failed) console.log(`  • ${f.name}: ${f.err}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
