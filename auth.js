import { db, auth, googleProvider } from "./firebase-config.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { state } from "./state.js";
import { usernameKey } from "./auth-helpers.js";
import { loadMyAccount, provisionNewTenant, ensureOwnerStaffRecord } from "./data.js";
import { formatArabicDate } from "./utils.js";
import { buildDoctorNav, buildSecretaryNav } from "./nav.js";

/* ============================================================
   APP STATE + LOGIN
   Firebase Auth now owns the session, so a page refresh keeps
   you logged in (onAuthStateChanged below restores `state.me`).
   ============================================================ */

document.getElementById("today-date").textContent = formatArabicDate();

document.getElementById("google-signin-btn").addEventListener("click", async () => {
  const errBox = document.getElementById("google-error-msg");
  errBox.textContent = "";
  try {
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged below picks it up from here
  } catch (err) {
    // Popups get blocked/cancelled a lot on mobile browsers — fall back
    // to a full-page redirect flow instead of just failing.
    const popupIssue = ["auth/cancelled-popup-request", "auth/popup-blocked", "auth/popup-closed-by-user"].includes(err.code);
    if (popupIssue) {
      try { await signInWithRedirect(auth, googleProvider); return; } catch (err2) {
        errBox.textContent = `تعذّر الدخول بجوجل (${err2.code || err2.message}).`;
        console.error("google redirect sign-in error", err2);
        return;
      }
    }
    errBox.textContent = `تعذّر الدخول بجوجل (${err.code || err.message}).`;
    console.error("google sign-in error", err);
  }
});

// Picks up the result after a redirect-based Google sign-in (page reload).
getRedirectResult(auth).catch((err) => {
  console.error("google redirect result error", err);
  document.getElementById("google-error-msg").textContent = `تعذّر الدخول بجوجل (${err.code || err.message}).`;
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorMsg = document.getElementById("error-msg");
  errorMsg.textContent = "";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  try {
    const key = usernameKey(username);
    const idxSnap = await get(ref(db, `usernames/${key}`));
    if (!idxSnap.exists()) { errorMsg.textContent = "اسم المستخدم غير صحيح."; return; }
    await signInWithEmailAndPassword(auth, idxSnap.val(), password);
    // onAuthStateChanged below picks it up from here
  } catch (err) {
    errorMsg.textContent = err.code === "auth/invalid-credential"
      ? "اسم المستخدم أو كلمة المرور غير صحيحة."
      : `تعذّر تسجيل الدخول (${err.code || err.message}).`;
    console.error("login error", err);
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  state.unsubs.forEach(u => u());
  state.unsubs = [];
  if (!user) { state.me = null; document.getElementById("screen-login").style.display = ""; document.getElementById("screen-app").style.display = "none"; return; }

  try {
    let account = await loadMyAccount(user.uid);
    if (!account) {
      // A missing account record means one of two very different things:
      // (1) this is a real first-time Google sign-in → provision a new
      //     clinic for them, or
      // (2) this is a username/password STAFF account whose record got
      //     deleted (e.g. the database was wiped) → NEVER auto-provision
      //     a new clinic for these, or a secretary/doctor login turns
      //     into an orphaned mini "clinic" of its own, silently split
      //     off from the real one.
      const isGoogleSignIn = user.providerData.some(p => p.providerId === "google.com");
      if (!isGoogleSignIn) {
        document.getElementById("error-msg").textContent =
          "الحساب ده مش مربوط بأي عيادة حاليًا. اطلبي من صاحب/ة العيادة يعمل لك حساب جديد من الإعدادات.";
        await signOut(auth);
        return;
      }
      account = await provisionNewTenant(user.uid, { name: user.displayName || "—", email: user.email || "—" });
    }
    state.me = { uid: user.uid, ...account };
    showApp();
  } catch (err) {
    console.error("account load failed", err);
    document.getElementById("google-error-msg").textContent = `تعذّر تحميل الحساب (${err.code || err.message}).`;
    await signOut(auth);
  }
});

export function showApp() {
  document.getElementById("screen-login").style.display = "none";
  document.getElementById("screen-app").style.display = "";
  document.getElementById("user-name").textContent = state.me.name || "—";
  document.getElementById("user-branch").textContent = state.me.branchId || "—";
  ensureOwnerStaffRecord().catch(err => console.error("ensureOwnerStaffRecord failed", err));
  if (state.me.role === "owner") buildDoctorNav(true);
  else if (state.me.role === "doctor") buildDoctorNav(false);
  else if (state.me.role === "secretary") buildSecretaryNav();
}

