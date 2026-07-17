/* ============================================================
   FIREBASE INIT
   ============================================================ */
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, push, set, update, get, onValue, off, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyB6bmPP5DYP_EWtT1Amm_gL1k3Gh88GX8g",
  authDomain: "alayada-72ca8.firebaseapp.com",
  databaseURL: "https://alayada-72ca8-default-rtdb.firebaseio.com",
  projectId: "alayada-72ca8",
  storageBucket: "alayada-72ca8.firebasestorage.app",
  messagingSenderId: "192838885817",
  appId: "1:192838885817:web:2303bf9140342af4e3d668",
  measurementId: "G-JHXV39EBF6"
};
export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

