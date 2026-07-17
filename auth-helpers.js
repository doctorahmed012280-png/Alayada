import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

/* ============================================================
   USERNAME-BASED STAFF LOGIN
   Firebase Auth only understands emails, so a username is turned
   into a synthetic email under the hood (never a real inbox). A
   public /usernames/{key} index maps it to that synthetic email
   so the login screen can resolve it BEFORE the person is signed
   in (i.e. before any tenant-scoped rule would apply).
   ============================================================ */
export function usernameKey(username) {
  return username.trim().toLowerCase().replace(/[.#$\[\]\/\s]/g, "_");
}
export function syntheticEmailFor(usernameKeyValue, tenantId) {
  return `${usernameKeyValue}.${tenantId}@staff.alayada.internal`;
}

/* Secondary app instance — used ONLY to create staff (secretary/doctor)
   Firebase Auth accounts without kicking the clinic owner out of their
   own session (createUserWithEmailAndPassword signs the caller in as
   the new user by default, so we do it on an isolated app instance). */
export async function createStaffAuthAccount(email, password) {
  const secondaryApp = initializeApp(firebaseConfig, "staff-creator-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return cred.user.uid;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
}

