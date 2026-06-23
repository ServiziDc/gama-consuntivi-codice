// ============================================================
// CONFIGURAZIONE FIREBASE - Gama Service
// ============================================================
// ✅ Credenziali già compilate, non modificare a meno che non ti dica Claude
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  addDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Credenziali del progetto Firebase "gama-service"
const firebaseConfig = {
  apiKey: "AIzaSyCp7WCI9wWBH1hLNXdYA0LTvRmKYjVo53o",
  authDomain: "gama-service.firebaseapp.com",
  projectId: "gama-service",
  storageBucket: "gama-service.firebasestorage.app",
  messagingSenderId: "440236038955",
  appId: "1:440236038955:web:84d854ca445a76d81b836e",
  measurementId: "G-6HCGQ2JPKB"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Esporto tutto ciò che serve all'app
window.firebaseDB = {
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  addDoc,
  getDocs
};

// Flag globale + evento
window.__firebaseReady = true;
window.dispatchEvent(new Event("firebase-ready"));
console.log("✅ Firebase inizializzato (progetto: gama-service)");
