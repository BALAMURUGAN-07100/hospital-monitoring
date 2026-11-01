/**
 * Hospital Patient Monitoring System
 * Central Firebase Configuration and Shared Utilities
 */

var firebaseConfig = window.firebaseConfig || {
  apiKey: "AIzaSyBy4iapPn9tFE2u_Wm3r4ZAlWIPq5ebh-8",
  authDomain: "hospital-monitering-10.firebaseapp.com",
  databaseURL: "https://hospital-monitering-10-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hospital-monitering-10",
  storageBucket: "hospital-monitering-10.firebasestorage.app",
  messagingSenderId: "410990725939",
  appId: "1:410990725939:web:67bda7ca054a26abd70c46",
  measurementId: "G-Q4N6RLRS32"
};
window.firebaseConfig = firebaseConfig;

// Authorized administrator UID verified against Firebase Authentication
var AUTHORIZED_ADMIN_UID = "NMN6Ob1C7bS7pmX1lMMIYs1sOIg1";
var AUTHORIZED_ADMIN_UIDS = ["NMN6Ob1C7bS7pmX1lMMIYs1sOIg1", "DzJJpDkeBYP3bTNy9DdH4gAEFbo1"];
window.AUTHORIZED_ADMIN_UIDS = AUTHORIZED_ADMIN_UIDS;

/**
 * Determines the assigned hospital ID for an admin user.
 * Returns:
 * - "ALL": Master Administrator (can manage all 10 hospitals H01 to H10)
 * - "H01" to "H10": Hospital-specific admin (can ONLY manage their assigned hospital)
 * - null: Unauthorized user
 *
 * Supports:
 * - Master UIDs in AUTHORIZED_ADMIN_UIDS -> "ALL"
 * - Emails such as admin-h01@hospital.com, staff-h01@..., h01@... -> "H01"
 *
 * @param {Object} user - Object with { uid, email }
 * @returns {string|null}
 */
function getAdminAssignedHospital(user) {
  if (!user) return null;
  const uid = user.uid || "";
  const email = (user.email || "").toLowerCase().trim();

  // 1. Explicit Super Admin whitelist (ONLY Balamurugan gets ALL)
  if (email.includes("balamurugan") || (typeof AUTHORIZED_ADMIN_UIDS !== "undefined" && AUTHORIZED_ADMIN_UIDS.includes(uid))) {
    return "ALL";
  }

  // 2. Comprehensive check for hospital number in email:
  // Matches: admin-h02, admin-h2, admin2, hospital2, hospital02, hospital-02, hos2, hosp2,
  //          h02@, h2@, admin@hospital2.com, user-h02, staff2, doctor2, dr2, 2admin, etc.
  const hospitalPatterns = [
    /(?:admin|hospital|hos|hosp|staff|unit|branch|user|doctor|dr)[._-]?h?0*([1-9]\d*)/i,
    /@(?:.*[._-])?hospital0*([1-9]\d*)/i,
    /\bh0*([1-9]\d*)\b/i,
    /0*([1-9]\d*)[._-]?(?:admin|hospital|hos|staff)/i,
    /^h?0*([1-9]\d*)@/i,
    /[._-]0*([1-9]\d*)@/i
  ];

  for (const pat of hospitalPatterns) {
    const match = email.match(pat);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      return `H${String(num).padStart(2, "0")}`;
    }
  }

  // 3. Fallback check for any standard hospital id in email (H01 to H99)
  if (typeof HOSPITAL_IDS !== "undefined") {
    for (const hid of HOSPITAL_IDS) {
      if (email.includes(hid.toLowerCase())) {
        return hid;
      }
    }
  }

  // 4. Any raw digit before @ (e.g. nurse2@...)
  const fallbackNum = email.match(/0*([1-9]\d*)@/);
  if (fallbackNum && fallbackNum[1]) {
    const num = parseInt(fallbackNum[1], 10);
    return `H${String(num).padStart(2, "0")}`;
  }

  // 5. Check if session storage already has an explicit database assignment
  try {
    const cached = sessionStorage.getItem("admin_assigned_hospital");
    if (cached && cached !== "ALL") return cached;
  } catch (e) {}

  // 6. Unknown accounts DO NOT get "ALL" - they return null to prevent accidental super admin access!
  return null;
}
window.getAdminAssignedHospital = getAdminAssignedHospital;

function sortHospitalIds(ids) {
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}
window.sortHospitalIds = sortHospitalIds;

function isAuthorizedAdmin(user) {
  return getAdminAssignedHospital(user) !== null;
}
window.isAuthorizedAdmin = isAuthorizedAdmin;

function isAuthorizedAdminUid(uid) {
  return AUTHORIZED_ADMIN_UIDS.includes(uid);
}
window.isAuthorizedAdminUid = isAuthorizedAdminUid;

// Standard hospital identifiers (10 hospitals, H01 to H10)
var HOSPITAL_IDS = [
  "H01", "H02", "H03", "H04", "H05",
  "H06", "H07", "H08", "H09", "H10"
];

var HOSPITAL_CAPACITY = 50;

/**
 * Returns the current date key in Indian Standard Time (Asia/Kolkata, UTC+05:30)
 * Format: YYYY-MM-DD
 *
 * @param {Date|number} [date=new Date()]
 * @returns {string} e.g. "2026-10-28"
 */
function getTodayDateKeyIST(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  // 'en-CA' outputs standard ISO 8601 YYYY-MM-DD
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(d);
}

/**
 * Formats a Unix millisecond timestamp into a human-readable Asia/Kolkata string
 *
 * @param {number|null} timestamp
 * @returns {string}
 */
function formatISTDateTime(timestamp) {
  if (!timestamp) return "Never";
  const d = new Date(timestamp);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

/**
 * Initialize Firebase application safely
 */
function initFirebaseApp() {
  if (typeof firebase === "undefined") {
    throw new Error("Firebase SDK failed to load. Please check your internet connection.");
  }
  if (!firebase.apps || !firebase.apps.length) {
    return firebase.initializeApp(firebaseConfig);
  }
  // If app is already loaded but with wrong key, re-initialize
  if (firebase.apps[0] && firebase.apps[0].options && firebase.apps[0].options.apiKey !== firebaseConfig.apiKey) {
    try {
      firebase.apps[0].delete();
    } catch (e) {}
    return firebase.initializeApp(firebaseConfig);
  }
  return firebase.app();
}

/**
 * Get Realtime Database instance
 */
function getFirebaseDb() {
  initFirebaseApp();
  return firebase.database();
}

/**
 * Get Firebase Auth instance
 */
function getFirebaseAuth() {
  initFirebaseApp();
  return firebase.auth();
}

// Default Hospital Locations (Addresses and Coordinates)
var DEFAULT_HOSPITAL_LOCATIONS = {
  H01: {
    address: "Rajiv Gandhi Government General Hospital, EVR Periyar Salai, Park Town, Chennai",
    lat: 13.0805,
    lng: 80.2783
  },
  H02: {
    address: "Apollo Hospital, 21 Greams Lane, Thousand Lights, Chennai",
    lat: 13.0604,
    lng: 80.2505
  },
  H03: {
    address: "MIOT International Hospital, 4/112 Mount Poonamallee Road, Manapakkam, Chennai",
    lat: 13.0232,
    lng: 80.1818
  },
  H04: {
    address: "Fortis Malar Hospital, 52 1st Main Road, Gandhi Nagar, Adyar, Chennai",
    lat: 13.0067,
    lng: 80.2570
  },
  H05: {
    address: "SIMS Hospital, 1 Jawaharlal Nehru Salai, Vadapalani, Chennai",
    lat: 13.0524,
    lng: 80.2119
  },
  H06: {
    address: "Stanley Medical College & Hospital, Old Jail Road, Royapuram, Chennai",
    lat: 13.1066,
    lng: 80.2872
  },
  H07: {
    address: "Government Kilpauk Medical College Hospital, Poonamallee High Road, Kilpauk, Chennai",
    lat: 13.0792,
    lng: 80.2442
  },
  H08: {
    address: "Kauvery Hospital, 199 Luz Church Road, Mylapore, Chennai",
    lat: 13.0368,
    lng: 80.2676
  },
  H09: {
    address: "Gleneagles Global Health City, 439 Cheran Nagar, Perumbakkam, Chennai",
    lat: 12.9056,
    lng: 80.2037
  },
  H10: {
    address: "Chettinad Super Speciality Hospital, Rajiv Gandhi Salai (OMR), Kelambakkam, Chennai",
    lat: 12.7885,
    lng: 80.2223
  }
};
window.DEFAULT_HOSPITAL_LOCATIONS = DEFAULT_HOSPITAL_LOCATIONS;

/**
 * Calculates Haversine distance between two GPS coordinates in kilometers
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}
window.calculateDistanceKm = calculateDistanceKm;

/**
 * Helper to get hospital location metadata
 */
function getHospitalLocation(hid, dbRecord) {
  const rec = dbRecord || {};
  const def = DEFAULT_HOSPITAL_LOCATIONS[hid] || {
    address: `${rec.name || hid} Medical Center`,
    lat: 13.0827,
    lng: 80.2707
  };
  return {
    address: rec.address || def.address,
    lat: typeof rec.lat === "number" ? rec.lat : def.lat,
    lng: typeof rec.lng === "number" ? rec.lng : def.lng
  };
}
window.getHospitalLocation = getHospitalLocation;

/**
 * Generate Google Maps Navigation URL from user to destination
 */
function getGoogleMapsRouteUrl(destinationAddress, lat, lng) {
  if (lat && lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationAddress)}`;
}
window.getGoogleMapsRouteUrl = getGoogleMapsRouteUrl;

