import { searchPatients } from "./data.js";

/* ============================================================
   CUSTOM FIELDS WIDGET (reusable everywhere: patients, invoices,
   visits, ANC). Lets the user add ad-hoc "label: value" rows for
   data with no dedicated field, without touching the code.
   ============================================================ */
export function customFieldsAddRow(listId, label = "", value = "") {
  const wrap = document.getElementById(listId);
  const row = document.createElement("div");
  row.className = "field-row custom-field-row";
  row.style.cssText = "align-items:flex-end;gap:8px;";
  row.innerHTML = `
    <div class="field" style="flex:1;margin-bottom:0;"><label>اسم الحقل</label><input class="cf-label" placeholder="مثال: رقم التأمين"></div>
    <div class="field" style="flex:1;margin-bottom:0;"><label>القيمة</label><input class="cf-value"></div>
    <button type="button" class="btn btn-ghost btn-sm cf-remove">حذف</button>`;
  row.querySelector(".cf-label").value = label;
  row.querySelector(".cf-value").value = value;
  row.querySelector(".cf-remove").addEventListener("click", () => row.remove());
  wrap.appendChild(row);
}
export function wireCustomFieldsWidget(listId, addBtnId) {
  document.getElementById(addBtnId).addEventListener("click", () => customFieldsAddRow(listId));
}
export function readCustomFields(listId) {
  const data = {};
  document.querySelectorAll(`#${listId} .custom-field-row`).forEach(row => {
    const label = row.querySelector(".cf-label").value.trim();
    const value = row.querySelector(".cf-value").value.trim();
    if (label) data[label] = value;
  });
  return data;
}
export function clearCustomFields(listId) { document.getElementById(listId).innerHTML = ""; }
export function renderCustomFieldsView(data) {
  if (!data || !Object.keys(data).length) return "";
  return `<div style="margin-top:6px;font-size:.82rem;color:var(--ink-soft);">` +
    Object.entries(data).map(([k, v]) => `<div>· <strong>${k}:</strong> ${v}</div>`).join("") +
    `</div>`;
}
export function customFieldsWidgetHtml(listId, addBtnId) {
  return `<div class="field"><label>بيانات إضافية (اختياري)</label></div>
    <div id="${listId}"></div>
    <button type="button" class="btn btn-ghost btn-sm" id="${addBtnId}" style="margin-bottom:12px;">+ إضافة حقل</button>`;
}

/* ============================================================
   SMART PATIENT SEARCH WIDGET (reusable: check-in, patients tab,
   billing). Type a name (any part of it, Arabic-variant tolerant)
   or any part of a phone number → live dropdown of matches.
   ============================================================ */
export function wireSmartPatientSearch(inputId, dropdownId, onSelect) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  let debounceTimer = null;

  function hideDropdown() { dropdown.style.display = "none"; dropdown.innerHTML = ""; }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 2) { hideDropdown(); return; }
    debounceTimer = setTimeout(async () => {
      const results = await searchPatients(query);
      if (!results.length) {
        dropdown.innerHTML = `<div style="padding:10px 12px;color:var(--ink-soft);font-size:.85rem;">لا توجد نتائج</div>`;
        dropdown.style.display = "";
        return;
      }
      dropdown.innerHTML = results.map((p, i) => `
        <div class="smart-search-item" data-i="${i}" style="padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;">
          <strong>${p.name}</strong> <span class="mono" style="color:var(--ink-soft);font-size:.85rem;">${p.phone || ""}</span>
        </div>`).join("");
      dropdown.style.display = "";
      dropdown.querySelectorAll(".smart-search-item").forEach(el => {
        el.addEventListener("click", () => {
          const patient = results[Number(el.dataset.i)];
          hideDropdown();
          onSelect(patient);
        });
      });
    }, 250);
  });

  document.addEventListener("click", (e) => {
    if (e.target !== input && !dropdown.contains(e.target)) hideDropdown();
  });
}

