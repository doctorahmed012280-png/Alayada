import { initSecretary } from "./secretary.js";
import { initDoctor } from "./doctor.js";
import { initSettings } from "./settings.js";

/* ============================================================
   NAV / VIEW SWITCHING
   Renders the same nav items into both the desktop sidebar list
   and the mobile bottom bar, so both stay in sync automatically.
   ============================================================ */
const ALL_SECTIONS = ["sec-view-queue", "sec-view-patients", "sec-view-billing", "doc-view-queue", "doc-view-chart", "view-settings"];

export function showSection(id, title) {
  ALL_SECTIONS.forEach(s => document.getElementById(s).style.display = s === id ? "" : "none");
  document.getElementById("view-title").textContent = title;
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.target === id));
}

export function buildNav(items) {
  const navList = document.getElementById("nav-list");
  const bottomNav = document.getElementById("bottom-nav");
  navList.innerHTML = items.map(it =>
    `<li><button class="nav-btn" data-target="${it.target}">${it.label}</button></li>`
  ).join("");
  bottomNav.innerHTML = items.map(it =>
    `<button class="nav-btn" data-target="${it.target}"><span class="bn-icon">${it.icon}</span><span>${it.short || it.label}</span></button>`
  ).join("");
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.addEventListener("click", () => showSection(b.dataset.target, items.find(it => it.target === b.dataset.target).label))
  );
  showSection(items[0].target, items[0].label);
}

export function buildSecretaryNav() {
  buildNav([
    { target: "sec-view-queue", label: "الدور اليومي", short: "الدور", icon: "🕒" },
    { target: "sec-view-patients", label: "المرضى", short: "المرضى", icon: "👥" },
    { target: "sec-view-billing", label: "الفواتير", short: "الفواتير", icon: "🧾" }
  ]);
  initSecretary();
}

export function buildDoctorNav(showSettings) {
  const items = [
    { target: "doc-view-queue", label: "دوري اليوم", short: "دوري", icon: "🕒" },
    { target: "doc-view-chart", label: "ملف المريضة", short: "الملف", icon: "🩺" }
  ];
  if (showSettings) items.push({ target: "view-settings", label: "الإعدادات", short: "الإعدادات", icon: "⚙️" });
  buildNav(items);
  initDoctor();
  if (showSettings) initSettings();
}

