import { db } from "./firebase-config.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { state } from "./state.js";
import {
  t, getClinicSettings, setClinicSetting, subscribeAbbreviations,
  addAbbreviation, deleteAbbreviation
} from "./data.js";
import { usernameKey, syntheticEmailFor, createStaffAuthAccount } from "./auth-helpers.js";

/* ============================================================
   SETTINGS — shared by both roles: create secretary/doctor
   accounts and list who already has one.
   ============================================================ */
let settingsWired = false;

export async function initSettings() {
  await loadBranchesForSettings();
  await renderAccountsList();
  const settings = await getClinicSettings();
  document.getElementById("s-anc-toggle").checked = settings.ancEnabled !== false; // default ON
  if (!settingsWired) { wireSettingsPanel(); settingsWired = true; }
}

export async function loadBranchesForSettings() {
  const sel = document.getElementById("s-branch");
  const snap = await get(ref(db, t("branches")));
  sel.innerHTML = "";
  if (snap.exists()) {
    Object.entries(snap.val()).forEach(([id, b]) => {
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = b.name || id;
      sel.appendChild(opt);
    });
  } else {
    sel.innerHTML = `<option value="branch_01">الفرع الرئيسي</option>`;
  }
}

export async function renderAccountsList() {
  const list = document.getElementById("s-accounts-list");
  const snap = await get(ref(db, t("staff")));
  const rows = snap.exists() ? Object.entries(snap.val()).map(([id, u]) => ({ id, ...u })) : [];
  // Older tenants provisioned before the self-heal fix might still be
  // missing the owner from tenants/{id}/staff for a brief moment — cover
  // that case without ever showing the owner twice.
  if (!rows.some(u => u.id === state.me.uid)) {
    rows.unshift({ id: state.me.uid, name: state.me.name, username: state.me.email, role: "owner", branchId: state.me.branchId });
  }
  list.innerHTML = "";
  rows.forEach(u => {
    const li = document.createElement("li");
    const roleLabel = u.role === "doctor" ? "طبيب" : (u.role === "secretary" ? "سكرتارية" : "صاحب/ة العيادة");
    li.innerHTML = `<div class="t-date">${roleLabel} — ${u.branchId || "—"}</div>
      <div class="t-body"><strong>${u.name || "—"}</strong> — <span class="mono">${u.username || "—"}</span></div>`;
    list.appendChild(li);
  });
}

export function wireSettingsPanel() {
  document.getElementById("s-anc-toggle").addEventListener("change", (e) => {
    setClinicSetting("ancEnabled", e.target.checked).catch(err => console.error("setClinicSetting failed", err));
  });

  const abList = document.getElementById("ab-list");
  subscribeAbbreviations((rows) => {
    if (!rows.length) { abList.innerHTML = `<li class="empty-state">لا توجد اختصارات بعد</li>`; return; }
    abList.innerHTML = "";
    rows.forEach(a => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="t-body"><strong>${a.abbr}</strong> — ${a.meaning}
        <button type="button" class="btn btn-ghost btn-sm ab-del" data-id="${a.id}" style="margin-right:8px;">حذف</button></div>`;
      li.querySelector(".ab-del").addEventListener("click", () => deleteAbbreviation(a.id));
      abList.appendChild(li);
    });
  });
  document.getElementById("ab-add-btn").onclick = async () => {
    const abbr = document.getElementById("ab-abbr").value.trim();
    const meaning = document.getElementById("ab-meaning").value.trim();
    if (!abbr || !meaning) return;
    await addAbbreviation(abbr, meaning);
    document.getElementById("ab-abbr").value = "";
    document.getElementById("ab-meaning").value = "";
  };

  document.getElementById("s-create-btn").onclick = async () => {
    const errorBox = document.getElementById("s-error");
    errorBox.textContent = "";

    const name = document.getElementById("s-name").value.trim();
    const username = document.getElementById("s-username").value.trim();
    const password = document.getElementById("s-password").value;
    const role = document.getElementById("s-role").value;
    const branchId = document.getElementById("s-branch").value;

    if (!name || !username || !password) { errorBox.textContent = "من فضلك أكملي كل الحقول."; return; }
    if (password.length < 6) { errorBox.textContent = "كلمة المرور 6 أحرف على الأقل."; return; }

    const key = usernameKey(username);
    if (!key) { errorBox.textContent = "اسم مستخدم غير صالح."; return; }

    try {
      const existing = await get(ref(db, `usernames/${key}`));
      if (existing.exists()) { errorBox.textContent = "اسم المستخدم ده متاخد بالفعل."; return; }

      const syntheticEmail = syntheticEmailFor(key, state.me.tenantId);
      const uid = await createStaffAuthAccount(syntheticEmail, password);
      const updates = {};
      updates[`accounts/${uid}`] = { tenantId: state.me.tenantId, role, branchId, name, username };
      updates[`usernames/${key}`] = syntheticEmail;
      updates[t(`staff/${uid}`)] = { name, username, role, branchId };
      updates[t(`branch_users_index/${branchId}/${uid}`)] = true;
      await update(ref(db), updates);

      ["s-name", "s-username", "s-password"].forEach(id => document.getElementById(id).value = "");
      await renderAccountsList();
    } catch (err) {
      errorBox.textContent = `تعذّر إنشاء الحساب (${err.code || err.message}).`;
      console.error("create account failed", err);
    }
  };
}
