import { db } from "./firebase-config.js";
import {
  ref, push, set, update, get, onValue, off, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { state } from "./state.js";
import { todayKey } from "./utils.js";

/* ============================================================
   DATA LAYER
   ============================================================ */
/* All paths below are scoped under tenants/{state.me.tenantId}/... so one
   clinic can never see another clinic's data — enforced both here
   (convenience) and, critically, by the Security Rules on the server. */
export function t(path) { return `tenants/${state.me.tenantId}/${path}`; }

export async function findPatientByPhone(phone) {
  const idxSnap = await get(ref(db, t(`patients_search_index/${phone}`)));
  if (!idxSnap.exists()) return null;
  const patientId = idxSnap.val();
  const pSnap = await get(ref(db, t(`patients/${patientId}`)));
  return pSnap.exists() ? { id: patientId, ...pSnap.val() } : null;
}

/* Normalizes Arabic text for forgiving search: strips diacritics/
   tatweel, unifies common letter variants (أ/إ/آ → ا, ى → ي, ة → ه),
   collapses whitespace. Lets "احمد", "أحمد", "آحمد" all match. */
export function normalizeArabic(str) {
  return (str || "").toString()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/* Smart search: matches by (partial) name OR (partial) phone digits,
   anywhere in the string — not just an exact/prefix match. Reads the
   whole patients list for the tenant once per call; fine for a
   single clinic's patient volume. */
export async function searchPatients(query) {
  const qName = normalizeArabic(query);
  const qDigits = (query || "").replace(/\D/g, "");
  if (!qName && !qDigits) return [];
  const snap = await get(ref(db, t("patients")));
  if (!snap.exists()) return [];
  const results = [];
  snap.forEach((child) => {
    const p = child.val();
    const nameNorm = normalizeArabic(p.name);
    const nameMatch = qName && nameNorm.includes(qName);
    const phoneMatch = qDigits.length >= 3 && (p.phone || "").includes(qDigits);
    if (nameMatch || phoneMatch) results.push({ id: child.key, ...p, _startsWith: nameNorm.startsWith(qName) });
  });
  results.sort((a, b) => (a._startsWith === b._startsWith ? 0 : a._startsWith ? -1 : 1));
  return results.slice(0, 8);
}
export async function createPatient(branchId, data) {
  const newRef = push(ref(db, t("patients")));
  const patientId = newRef.key;
  const updates = {};
  updates[t(`patients/${patientId}`)] = { ...data, createdBranchId: branchId, createdAt: serverTimestamp() };
  updates[t(`patients_search_index/${data.phone}`)] = patientId;
  await update(ref(db), updates);
  return patientId;
}
export async function checkInPatient({ branchId, patientId, patientName, doctorId, createdBy }) {
  const date = todayKey();
  const queueRef = push(ref(db, t(`queue/${branchId}/${date}`)));
  const notifRef = push(ref(db, t(`notifications/${branchId}/${doctorId}`)));
  const updates = {};
  updates[t(`queue/${branchId}/${date}/${queueRef.key}`)] = {
    patientId, patientName, doctorId, status: "waiting",
    checkInTime: serverTimestamp(), calledTime: null, createdBy: createdBy || null
  };
  updates[t(`notifications/${branchId}/${doctorId}/${notifRef.key}`)] = {
    type: "new_queue_entry", patientId, patientName, queueId: queueRef.key,
    timestamp: serverTimestamp(), read: false
  };
  await update(ref(db), updates);
  return queueRef.key;
}
export function subscribeToTodayQueue(branchId, callback) {
  const date = todayKey();
  const qRef = ref(db, t(`queue/${branchId}/${date}`));
  const handler = onValue(qRef, (snap) => {
    const rows = [];
    snap.forEach((child) => { rows.push({ id: child.key, ...child.val() }); });
    rows.sort((a, b) => (a.checkInTime || 0) - (b.checkInTime || 0));
    callback(rows);
  });
  return () => off(qRef, "value", handler);
}
export async function setQueueStatus(branchId, queueId, status) {
  const patch = { status };
  if (status === "in-clinic") patch.calledTime = serverTimestamp();
  await update(ref(db, t(`queue/${branchId}/${todayKey()}/${queueId}`)), patch);
}
export function subscribePatientTimeline(patientId, callback) {
  const rRef = ref(db, t(`medicalRecords/${patientId}`));
  const handler = onValue(rRef, (snap) => {
    const rows = [];
    snap.forEach((child) => { rows.push({ id: child.key, ...child.val() }); });
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    callback(rows);
  });
  return () => off(rRef, "value", handler);
}
export async function completeVisit({ branchId, patientId, doctorId, queueId, record }) {
  const recRef = push(ref(db, t(`medicalRecords/${patientId}`)));
  const updates = {};
  updates[t(`medicalRecords/${patientId}/${recRef.key}`)] = { branchId, doctorId, date: todayKey(), ...record, createdAt: serverTimestamp() };
  if (queueId) updates[t(`queue/${branchId}/${todayKey()}/${queueId}/status`)] = "done";
  await update(ref(db), updates);
  return recRef.key;
}
export function subscribeAncRecord(patientId, pregnancyId, callback) {
  const aRef = ref(db, t(`ancRecords/${patientId}/${pregnancyId}`));
  const handler = onValue(aRef, (snap) => callback(snap.exists() ? snap.val() : null));
  return () => off(aRef, "value", handler);
}
export async function startAncRecord(patientId, branchId, { lmp, edd }) {
  const newRef = push(ref(db, t(`ancRecords/${patientId}`)));
  await set(newRef, { lmp, edd, startBranchId: branchId, visits: {} });
  return newRef.key;
}
export async function addAncVisit(patientId, pregnancyId, visit) {
  const newRef = push(ref(db, t(`ancRecords/${patientId}/${pregnancyId}/visits`)));
  await set(newRef, { ...visit, createdAt: serverTimestamp() });
  return newRef.key;
}
export async function createInvoice(branchId, invoice) {
  const newRef = push(ref(db, t(`billing/${branchId}`)));
  await set(newRef, { ...invoice, timestamp: serverTimestamp() });
  return newRef.key;
}
export function subscribeBranchInvoices(branchId, callback) {
  const bRef = ref(db, t(`billing/${branchId}`));
  const handler = onValue(bRef, (snap) => {
    const rows = [];
    snap.forEach((child) => { rows.push({ id: child.key, ...child.val() }); });
    rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    callback(rows);
  });
  return () => off(bRef, "value", handler);
}

/* ============================================================
   APPOINTMENTS (next-visit booking + arrival confirmation)
   Stored per-date so "today's appointments" is a cheap direct
   read; upcoming/all-dates views fall back to reading the whole
   node and filtering client-side (fine at clinic scale).
   ============================================================ */
export async function bookAppointment(date, { patientId, patientName, doctorId, bookedBy }) {
  const newRef = push(ref(db, t(`appointments/${date}`)));
  await set(newRef, { patientId, patientName, doctorId, bookedBy, confirmed: false, createdAt: serverTimestamp() });
  return newRef.key;
}
export function subscribeAppointmentsForDate(date, callback) {
  const aRef = ref(db, t(`appointments/${date}`));
  const handler = onValue(aRef, (snap) => {
    const rows = [];
    snap.forEach((child) => { rows.push({ id: child.key, ...child.val() }); });
    callback(rows);
  });
  return () => off(aRef, "value", handler);
}
export async function confirmAppointment(date, apptId, queueId) {
  await update(ref(db, t(`appointments/${date}/${apptId}`)), { confirmed: true, confirmedAt: serverTimestamp(), queueId: queueId || null });
}
/* Any appointment booked for `patientId` today, not yet confirmed —
   used at check-in to auto-confirm instead of creating a stray extra
   booking record. */
export async function findTodaysUnconfirmedAppointment(patientId) {
  const snap = await get(ref(db, t(`appointments/${todayKey()}`)));
  if (!snap.exists()) return null;
  let found = null;
  snap.forEach((child) => {
    const v = child.val();
    if (v.patientId === patientId && !v.confirmed) { found = { id: child.key, ...v }; }
  });
  return found;
}
/* Loads every appointment for one doctor across all dates (today's
   arrivals excluded by the caller if needed) — used to build the
   "today, not yet arrived" and "upcoming" lists on the doctor's screen. */
export async function loadDoctorAppointments(doctorId) {
  const snap = await get(ref(db, t("appointments")));
  if (!snap.exists()) return [];
  const result = [];
  snap.forEach((dateSnap) => {
    const date = dateSnap.key;
    dateSnap.forEach((apptSnap) => {
      const v = apptSnap.val();
      if (v.doctorId === doctorId) result.push({ id: apptSnap.key, date, ...v });
    });
  });
  return result;
}

/* ============================================================
   MEDICAL ABBREVIATIONS DICTIONARY (doctor-managed, per clinic)
   A quick-reference list the doctor builds from الإعدادات so their
   own shorthand ("ANC", "ttt"...) stays legible without hardcoding
   any specialty into the app itself.
   ============================================================ */
export async function addAbbreviation(abbr, meaning) {
  const newRef = push(ref(db, t("abbreviations")));
  await set(newRef, { abbr, meaning });
  return newRef.key;
}
export async function deleteAbbreviation(id) {
  await set(ref(db, t(`abbreviations/${id}`)), null);
}
export function subscribeAbbreviations(callback) {
  const aRef = ref(db, t("abbreviations"));
  const handler = onValue(aRef, (snap) => {
    const rows = [];
    snap.forEach((child) => { rows.push({ id: child.key, ...child.val() }); });
    callback(rows);
  });
  return () => off(aRef, "value", handler);
}

/* ============================================================
   CLINIC SETTINGS (per-tenant toggles, e.g. optional ANC module)
   ============================================================ */
export async function getClinicSettings() {
  const snap = await get(ref(db, t("settings")));
  return snap.exists() ? snap.val() : {};
}
export async function setClinicSetting(key, value) {
  await update(ref(db, t("settings")), { [key]: value });
}

/* ============================================================
   MULTI-TENANCY MODEL
   Every clinic ("tenant") gets its own slice of the database at
   /tenants/{tenantId}/... A tiny root-level pointer at
   /accounts/{uid} = { tenantId, role, branchId, name, email }
   is what Security Rules use to figure out which tenant a given
   signed-in Firebase Auth user belongs to. This pointer node is
   the ONLY thing that lives outside a tenant's own subtree.

   - role "owner"     → the person who signed up with Google;
                         can manage staff from الإعدادات.
   - role "secretary"/"doctor" → created BY an owner from
                         الإعدادات with email+password (real
                         Firebase Auth accounts, not custom hashes).
   ============================================================ */
export async function loadMyAccount(uid) {
  const snap = await get(ref(db, `accounts/${uid}`));
  return snap.exists() ? snap.val() : null;
}

export async function provisionNewTenant(uid, { name, email }) {
  const tenantId = uid; // owner's own uid doubles as the tenant id
  const accountRecord = { tenantId, role: "owner", branchId: "branch_01", name, email };
  // Written as two sequential calls (not one multi-location update) so the
  // account record is fully committed before the tenant-scoped writes,
  // which depend on it, are evaluated by the security rules.
  await set(ref(db, `accounts/${uid}`), accountRecord);
  const updates = {};
  updates[`tenants/${tenantId}/branches/branch_01`] = { name: "الفرع الرئيسي", active: true };
  // The owner also acts as the clinic's doctor, so they need a tenant-scoped
  // staff record too — that's the only thing the secretary's account is
  // allowed to read (root-level /accounts/{uid} is private to its own uid),
  // and it's what populates the "الطبيب المعالج" dropdown at check-in.
  updates[`tenants/${tenantId}/staff/${uid}`] = { name, username: email, role: "owner", branchId: "branch_01" };
  updates[`tenants/${tenantId}/branch_users_index/branch_01/${uid}`] = true;
  await update(ref(db), updates);
  return accountRecord;
}

/* Backward-compatibility self-heal: clinics provisioned before the fix
   above are missing their own owner from tenants/{id}/staff, so the
   doctor dropdown looks empty to their secretary. Runs harmlessly (no-op)
   for clinics that already have it. */
export async function ensureOwnerStaffRecord() {
  if (state.me.role !== "owner") return;
  const snap = await get(ref(db, t(`staff/${state.me.uid}`)));
  if (snap.exists()) return;
  const updates = {};
  updates[t(`staff/${state.me.uid}`)] = { name: state.me.name, username: state.me.email, role: "owner", branchId: state.me.branchId };
  updates[t(`branch_users_index/${state.me.branchId}/${state.me.uid}`)] = true;
  await update(ref(db), updates);
}

