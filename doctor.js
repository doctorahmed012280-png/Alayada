import { db } from "./firebase-config.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { state } from "./state.js";
import {
  t, subscribeToTodayQueue, subscribeAbbreviations, loadDoctorAppointments,
  subscribePatientTimeline, subscribeAncRecord, completeVisit, bookAppointment,
  startAncRecord, addAncVisit, getClinicSettings, setQueueStatus
} from "./data.js";
import { wireCustomFieldsWidget, readCustomFields, clearCustomFields, renderCustomFieldsView } from "./widgets.js";
import { formatTime, todayKey, calcGestationalAge, gestationProgress, calcEDD, formatArabicDate, QUEUE_STATUS_LABELS } from "./utils.js";
import { showSection } from "./nav.js";

/* ============================================================
   DOCTOR MODULE
   ============================================================ */
let currentPatientId = null, currentQueueId = null, currentPregnancyId = null, currentLmp = null;
let clinicAncEnabled = true;

export function initDoctor() {
  state.unsubs.push(subscribeToTodayQueue(state.me.branchId, renderDoctorQueue));
  wireExamPanel();
  wireAncPanel();
  wireAbbrevReference();
  loadAndRenderDoctorAppointments();
  getClinicSettings().then(s => { clinicAncEnabled = s.ancEnabled !== false; });
}

export function wireAbbrevReference() {
  const box = document.getElementById("v-abbrev-ref");
  state.unsubs.push(subscribeAbbreviations((rows) => {
    if (!rows.length) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = `<strong>مرجع الاختصارات (دوسي عشان تضيفيها للملاحظة):</strong><br>` +
      rows.map(a => `<span class="mono" style="cursor:pointer;text-decoration:underline dotted;margin-inline-end:10px;" data-abbr="${a.abbr}" title="${a.meaning}">${a.abbr}</span>`).join(" ");
    box.querySelectorAll("[data-abbr]").forEach(el => {
      el.addEventListener("click", () => {
        const note = document.getElementById("v-note");
        note.value += (note.value ? " " : "") + el.dataset.abbr;
        note.focus();
      });
    });
  }));
}

export async function loadAndRenderDoctorAppointments() {
  const all = await loadDoctorAppointments(state.me.uid);
  const today = todayKey();
  renderApptList("doc-appts-today-list", all.filter(a => a.date === today && !a.confirmed), false);
  renderApptList("doc-appts-upcoming-list", all.filter(a => a.date > today).sort((a, b) => a.date.localeCompare(b.date)), true);
}
export function renderApptList(listId, rows, showDate) {
  const list = document.getElementById(listId);
  if (!rows.length) { list.innerHTML = `<li class="empty-state">${showDate ? "لا توجد حجوزات قادمة" : "لا يوجد حجوزات لليوم"}</li>`; return; }
  list.innerHTML = "";
  rows.forEach(a => {
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${a.patientName}</strong>${showDate ? ` <span class="mono" style="color:var(--ink-soft);">— ${a.date}</span>` : ""}</div>`;
    list.appendChild(li);
  });
}

export function renderDoctorQueue(rows) {
  const mine = rows.filter(r => r.doctorId === state.me.uid && r.status !== "cancelled");
  const list = document.getElementById("doc-queue-list");
  if (!mine.length) { list.innerHTML = `<li class="empty-state">لا يوجد مرضى في دورك الآن</li>`; return; }
  list.innerHTML = "";
  mine.forEach(row => {
    const li = document.createElement("li");
    li.className = "queue-item"; li.dataset.status = row.status;
    li.innerHTML = `
      <div><strong>${row.patientName || "—"}</strong>
        <div style="font-size:.8rem;color:var(--ink-soft)">دخول: ${formatTime(row.checkInTime)}</div></div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="badge badge-${row.status}">${QUEUE_STATUS_LABELS[row.status] || row.status}</span>
        ${row.status === "waiting" ? `<button class="btn btn-primary btn-sm" data-act="call">استدعاء</button>` : ""}
        ${row.status === "in-clinic" ? `<button class="btn btn-ghost btn-sm" data-act="open">فتح الملف</button>` : ""}
      </div>`;
    const callBtn = li.querySelector('[data-act="call"]');
    if (callBtn) callBtn.onclick = async () => { await setQueueStatus(state.me.branchId, row.id, "in-clinic"); openPatientChart(row.patientId, row.id); };
    const openBtn = li.querySelector('[data-act="open"]');
    if (openBtn) openBtn.onclick = () => openPatientChart(row.patientId, row.id);
    list.appendChild(li);
  });
}

export async function openPatientChart(patientId, queueId) {
  currentPatientId = patientId; currentQueueId = queueId || null; currentPregnancyId = null; currentLmp = null;
  showSection("doc-view-chart", "ملف المريضة");
  document.getElementById("chart-empty").style.display = "none";
  document.getElementById("chart-content").style.display = "";

  const pSnap = await get(ref(db, t(`patients/${patientId}`)));
  if (!pSnap.exists()) return;
  const patient = pSnap.val();
  document.getElementById("c-name").textContent = patient.name;
  document.getElementById("c-meta").textContent = `${patient.phone || "—"} · ${patient.age ?? "—"} سنة · ${patient.bloodType ?? "—"}`;
  const oh = patient.obstetricHistory || {};
  document.getElementById("c-obstetric").innerHTML = Object.keys(oh).length
    ? `<span class="mono">G${oh.gravida??0} P${oh.para??0} A${oh.abortions??0} L${oh.livingChildren??0}</span>` : "";

  document.getElementById("v-note").value = "";
  document.getElementById("v-next-visit").value = "";
  document.getElementById("anc-panel").style.display = clinicAncEnabled ? "" : "none";
  state.unsubs.push(subscribePatientTimeline(patientId, renderTimeline));

  if (!clinicAncEnabled) { renderAnc(null); return; }
  const ancListSnap = await get(ref(db, t(`ancRecords/${patientId}`)));
  if (ancListSnap.exists()) {
    const entries = Object.entries(ancListSnap.val());
    const [pregId] = entries[entries.length - 1];
    currentPregnancyId = pregId;
    state.unsubs.push(subscribeAncRecord(patientId, pregId, renderAnc));
  } else {
    renderAnc(null);
  }
}

export function renderTimeline(rows) {
  const list = document.getElementById("c-timeline");
  if (!rows.length) { list.innerHTML = `<li class="empty-state">لا توجد زيارات سابقة</li>`; return; }
  list.innerHTML = "";
  rows.forEach(r => {
    const li = document.createElement("li");
    const oldFormat = r.diagnosis || r.symptoms || r.ultrasoundFindings || r.prescription;
    li.innerHTML = `<div class="t-date">${r.date || "—"}${r.nextVisitDate ? ` — الزيارة القادمة: ${r.nextVisitDate}` : ""}</div>
      <div class="t-body">
        ${r.note ? r.note.replace(/\n/g, "<br>") : ""}
        ${oldFormat ? `
          ${r.diagnosis ? `<strong>${r.diagnosis}</strong><br>` : ""}
          ${r.symptoms ? `الأعراض: ${r.symptoms}<br>` : ""}
          ${r.ultrasoundFindings ? `سونار: ${r.ultrasoundFindings}<br>` : ""}
          ${r.prescription ? `روشتة: ${r.prescription}` : ""}` : ""}
      </div>
      ${renderCustomFieldsView(r.customFields)}`;
    list.appendChild(li);
  });
}

export function wireExamPanel() {
  wireCustomFieldsWidget("v-cf-list", "v-cf-add");
  document.getElementById("v-complete-btn").onclick = async () => {
    if (!currentPatientId) return;
    const patientName = document.getElementById("c-name").textContent;
    const nextVisitDate = document.getElementById("v-next-visit").value || null;
    const record = {
      note: document.getElementById("v-note").value.trim(),
      nextVisitDate,
      customFields: readCustomFields("v-cf-list")
    };
    await completeVisit({ branchId: state.me.branchId, patientId: currentPatientId, doctorId: state.me.uid, queueId: currentQueueId, record });
    if (nextVisitDate) {
      await bookAppointment(nextVisitDate, { patientId: currentPatientId, patientName, doctorId: state.me.uid, bookedBy: state.me.uid });
    }
    alert(nextVisitDate ? "تم حفظ الكشف وحجز الزيارة القادمة." : "تم حفظ الكشف وإنهاء الزيارة.");
    currentQueueId = null;
    document.getElementById("v-note").value = "";
    document.getElementById("v-next-visit").value = "";
    clearCustomFields("v-cf-list");
    loadAndRenderDoctorAppointments();
  };
}

export function renderAnc(ancData) {
  const startBox = document.getElementById("anc-start"), trackBox = document.getElementById("anc-tracking");
  const ringWrap = document.getElementById("c-ga-ring-wrap");
  if (!ancData) { startBox.style.display = ""; trackBox.style.display = "none"; ringWrap.innerHTML = ""; return; }
  startBox.style.display = "none"; trackBox.style.display = ""; currentLmp = ancData.lmp;
  const ga = calcGestationalAge(ancData.lmp);
  const pct = Math.round(gestationProgress(ancData.lmp) * 100);
  ringWrap.innerHTML = `<div class="ga-ring" style="--pct:${pct}"><div class="ga-label">
      <span class="ga-weeks">${ga.weeks}<span style="font-size:1rem">w</span>${ga.days}<span style="font-size:1rem">d</span></span>
      <span class="ga-caption">EDD ${ancData.edd || "—"}</span></div></div>`;
  const visits = ancData.visits ? Object.values(ancData.visits).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)) : [];
  const list = document.getElementById("anc-visits");
  if (!visits.length) { list.innerHTML = `<li class="empty-state">لا توجد زيارات متابعة بعد</li>`; return; }
  list.innerHTML = "";
  visits.forEach(v => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="t-date">${v.gestationalWeek ?? "—"}wks · ${v.date || ""}</div>
      <div class="t-body">${v.note || ""}
        ${v.fetalWeightGrams ? ` — وزن الجنين: <span class="num">${v.fetalWeightGrams}g</span>` : ""}
        ${v.lab ? ` — <span style="color:var(--accent)">${v.lab}</span>` : ""}
        ${renderCustomFieldsView(v.customFields)}</div>`;
    list.appendChild(li);
  });
}

export function wireAncPanel() {
  wireCustomFieldsWidget("anc-cf-list", "anc-cf-add");
  const lmpInput = document.getElementById("anc-lmp");
  lmpInput.onchange = () => { document.getElementById("anc-edd").value = calcEDD(lmpInput.value) || ""; };
  document.getElementById("anc-start-btn").onclick = async () => {
    if (!currentPatientId) return;
    const lmp = lmpInput.value;
    if (!lmp) { alert("أدخلي تاريخ آخر دورة."); return; }
    const edd = calcEDD(lmp);
    currentPregnancyId = await startAncRecord(currentPatientId, state.me.branchId, { lmp, edd });
    state.unsubs.push(subscribeAncRecord(currentPatientId, currentPregnancyId, renderAnc));
  };
  document.getElementById("anc-add-btn").onclick = async () => {
    if (!currentPatientId || !currentPregnancyId) return;
    const note = document.getElementById("anc-note").value.trim();
    const fetalWeightGrams = Number(document.getElementById("anc-weight").value) || null;
    const lab = document.getElementById("anc-lab").value.trim();
    const ga = currentLmp ? calcGestationalAge(currentLmp) : null;
    const customFields = readCustomFields("anc-cf-list");
    await addAncVisit(currentPatientId, currentPregnancyId, {
      note, fetalWeightGrams, lab: lab || null, gestationalWeek: ga ? ga.weeks : null, date: formatArabicDate(), customFields
    });
    ["anc-note","anc-weight","anc-lab"].forEach(id => document.getElementById(id).value = "");
    clearCustomFields("anc-cf-list");
  };
}

