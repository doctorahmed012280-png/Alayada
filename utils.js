/* ============================================================
   UTILS (pure helpers)
   ============================================================ */
const MS_DAY = 24 * 60 * 60 * 1000;

export function calcEDD(lmp) {
  const d = new Date(lmp + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 280 * MS_DAY).toISOString().slice(0, 10);
}
export function calcGestationalAge(lmp, asOf = new Date()) {
  const start = new Date(lmp + "T00:00:00");
  if (isNaN(start.getTime())) return null;
  const diffMs = asOf.getTime() - start.getTime();
  if (diffMs < 0) return { weeks: 0, days: 0, totalDays: 0 };
  const totalDays = Math.floor(diffMs / MS_DAY);
  return { weeks: Math.floor(totalDays / 7), days: totalDays % 7, totalDays };
}
export function gestationProgress(lmp, asOf = new Date()) {
  const ga = calcGestationalAge(lmp, asOf);
  if (!ga) return 0;
  return Math.min(1, ga.totalDays / (40 * 7));
}
export function formatArabicDate(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
}
export function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}
export const QUEUE_STATUS_LABELS = { "waiting": "في الانتظار", "in-clinic": "داخل الكشف", "done": "تم الكشف", "cancelled": "ملغي" };
export function todayKey() { return new Date().toISOString().slice(0, 10); }

