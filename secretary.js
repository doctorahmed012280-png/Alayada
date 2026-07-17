import { db } from "./firebase-config.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { state } from "./state.js";
import {
  t, subscribeToTodayQueue, subscribeBranchInvoices, checkInPatient, setQueueStatus,
  findPatientByPhone, createPatient, createInvoice,
  confirmAppointment, findTodaysUnconfirmedAppointment
} from "./data.js";
import { wireSmartPatientSearch, wireCustomFieldsWidget, readCustomFields, clearCustomFields, renderCustomFieldsView } from "./widgets.js";
import { formatTime, QUEUE_STATUS_LABELS } from "./utils.js";

/* ============================================================
   SECRETARY MODULE
   ============================================================ */
let lastFoundPatient = null;

export async function initSecretary() {
  await loadDoctorsForBranch();
  state.unsubs.push(subscribeToTodayQueue(state.me.branchId, renderQueue));
  state.unsubs.push(subscribeBranchInvoices(state.me.branchId, renderBilling));
  wireQueuePanel();
  wirePatientsPanel();
  wireBillingPanel();
}

export async function loadDoctorsForBranch() {
  const sel = document.getElementById("q-doctor");
  sel.innerHTML = "";
  const idxSnap = await get(ref(db, t(`branch_users_index/${state.me.branchId}`)));
  if (!idxSnap.exists()) { sel.innerHTML = "<option>لا يوجد أطباء بهذا الفرع</option>"; return; }
  for (const uid of Object.keys(idxSnap.val())) {
    const uSnap = await get(ref(db, t(`staff/${uid}`)));
    if (uSnap.exists() && (uSnap.val().role === "doctor" || uSnap.val().role === "owner")) {
      const opt = document.createElement("option");
      opt.value = uid; opt.textContent = uSnap.val().name;
      sel.appendChild(opt);
    }
  }
  if (!sel.children.length) sel.innerHTML = "<option>لا يوجد أطباء بهذا الفرع</option>";
}

export function wireQueuePanel() {
  const phoneInput = document.getElementById("q-phone");
  const foundBox = document.getElementById("q-patient-found");
  let lastFoundAppointment = null;
  wireSmartPatientSearch("q-phone", "q-search-dropdown", async (patient) => {
    lastFoundPatient = patient;
    phoneInput.value = `${patient.name} — ${patient.phone}`;
    foundBox.style.display = "";
    lastFoundAppointment = await findTodaysUnconfirmedAppointment(patient.id);
    foundBox.innerHTML = `<strong>${patient.name}</strong> — ${patient.age ?? "—"} سنة` +
      (lastFoundAppointment ? `<div style="color:var(--primary);margin-top:4px;">✓ عندها حجز لليوم — هيتأكد تلقائيًا عند التسجيل</div>` : "");
  });
  document.getElementById("q-checkin-btn").onclick = async () => {
    if (!lastFoundPatient) { alert("ابحثي عن المريضة بالاسم أو رقم الهاتف واختاريها من القائمة أولاً."); return; }
    const doctorId = document.getElementById("q-doctor").value;
    if (!doctorId) { alert("اختاري الطبيب المعالج."); return; }
    const queueId = await checkInPatient({ branchId: state.me.branchId, patientId: lastFoundPatient.id, patientName: lastFoundPatient.name, doctorId, createdBy: state.me.uid });
    if (lastFoundAppointment) { await confirmAppointment(lastFoundAppointment.date, lastFoundAppointment.id, queueId); }
    phoneInput.value = ""; foundBox.style.display = "none"; lastFoundPatient = null; lastFoundAppointment = null;
  };
}

export function renderQueue(rows) {
  const list = document.getElementById("queue-list");
  if (!rows.length) { list.innerHTML = `<li class="empty-state">لا يوجد مرضى في الدور بعد</li>`; return; }
  list.innerHTML = "";
  rows.forEach(row => {
    const li = document.createElement("li");
    li.className = "queue-item"; li.dataset.status = row.status;
    li.innerHTML = `
      <div><strong>${row.patientName || "—"}</strong>
        <div style="font-size:.8rem;color:var(--ink-soft)">دخول: ${formatTime(row.checkInTime)}</div></div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="badge badge-${row.status}">${QUEUE_STATUS_LABELS[row.status] || row.status}</span>
        ${row.status === "waiting" ? `<button class="btn btn-ghost btn-sm" data-act="cancel">إلغاء</button>` : ""}
      </div>`;
    const cancelBtn = li.querySelector('[data-act="cancel"]');
    if (cancelBtn) cancelBtn.onclick = () => setQueueStatus(state.me.branchId, row.id, "cancelled");
    list.appendChild(li);
  });
}

export function wirePatientsPanel() {
  wireCustomFieldsWidget("p-cf-list", "p-cf-add");
  const resultBox = document.getElementById("p-result");
  wireSmartPatientSearch("p-search", "p-search-dropdown", (patient) => {
    document.getElementById("p-search").value = `${patient.name} — ${patient.phone}`;
    resultBox.className = "";
    resultBox.innerHTML = `<h4 style="margin-top:0">${patient.name}</h4>
      <div class="mono" style="color:var(--ink-soft);margin-bottom:8px;">${patient.phone}</div>
      <div>السن: ${patient.age ?? "—"} — فصيلة الدم: ${patient.bloodType ?? "—"}</div>
      <div>جهة الطوارئ: ${patient.emergencyContact ?? "—"}</div>
      ${renderCustomFieldsView(patient.customFields)}`;
  });
  document.getElementById("p-create-btn").onclick = async () => {
    const name = document.getElementById("p-name").value.trim();
    const phone = document.getElementById("p-phone").value.trim();
    const age = Number(document.getElementById("p-age").value) || null;
    const bloodType = document.getElementById("p-blood").value;
    const emergencyContact = document.getElementById("p-emergency").value.trim();
    const customFields = readCustomFields("p-cf-list");
    if (!name || !phone) { alert("الاسم ورقم الهاتف مطلوبان."); return; }
    if (await findPatientByPhone(phone)) { alert("توجد بالفعل مريضة بهذا الرقم."); return; }
    await createPatient(state.me.branchId, { name, phone, age, bloodType, emergencyContact, customFields });
    alert("تم حفظ بيانات المريضة.");
    ["p-name", "p-phone", "p-age", "p-emergency"].forEach(id => document.getElementById(id).value = "");
    clearCustomFields("p-cf-list");
  };
}

export function wireBillingPanel() {
  wireCustomFieldsWidget("b-cf-list", "b-cf-add");
  const consult = document.getElementById("b-consult"), sono = document.getElementById("b-sono");
  const extraVal = document.getElementById("b-extra-value"), total = document.getElementById("b-total");
  function recalc() { total.value = (Number(consult.value)||0) + (Number(sono.value)||0) + (Number(extraVal.value)||0); }
  [consult, sono, extraVal].forEach(el => el.oninput = recalc);
  recalc();
  let selectedBillingPatient = null;
  wireSmartPatientSearch("b-phone", "b-search-dropdown", (patient) => {
    selectedBillingPatient = patient;
    document.getElementById("b-phone").value = `${patient.name} — ${patient.phone}`;
  });
  document.getElementById("b-create-btn").onclick = async () => {
    if (!selectedBillingPatient) { alert("ابحثي عن المريضة بالاسم أو رقم الهاتف واختاريها من القائمة أولاً."); return; }
    const patient = selectedBillingPatient;
    const items = { consultation: Number(consult.value)||0, ultrasound: Number(sono.value)||0 };
    const extraLabel = document.getElementById("b-extra-label").value.trim();
    if (extraLabel) items[extraLabel] = Number(extraVal.value) || 0;
    const customFields = readCustomFields("b-cf-list");
    await createInvoice(state.me.branchId, { patientId: patient.id, patientName: patient.name, items, total: Number(total.value)||0, paid: true, cashierUid: state.me.uid, customFields });
    alert("تم إصدار الفاتورة.");
    document.getElementById("b-phone").value = "";
    selectedBillingPatient = null;
    document.getElementById("b-extra-label").value = "";
    consult.value = "0"; sono.value = "0"; extraVal.value = "0"; recalc();
    clearCustomFields("b-cf-list");
  };
}

export function renderBilling(rows) {
  const list = document.getElementById("billing-list");
  if (!rows.length) { list.innerHTML = `<li class="empty-state">لا توجد فواتير بعد</li>`; return; }
  list.innerHTML = "";
  rows.slice(0, 30).forEach(row => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="t-date">${formatTime(row.timestamp)}</div>
      <div class="t-body"><strong>${row.patientName}</strong> — <span class="num">${row.total} ج.م</span>
      ${renderCustomFieldsView(row.customFields)}</div>`;
    list.appendChild(li);
  });
}

