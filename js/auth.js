/**
 * Hospital Patient Monitoring System
 * Authentication & Admin Authorization Module
 * Dual-Engine: Firebase SDK + Google Identity Toolkit REST Fallback
 */

/**
 * Perform Admin Login with Email & Password
 * Checks returned UID against AUTHORIZED_ADMIN_UIDS
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>}
 */
async function loginAdmin(email, password) {
  if (!email || !password) {
    throw new Error("Please enter both email and password.");
  }

  const cleanEmail = email.trim();
  sessionStorage.clear();

  // Engine 1: Attempt standard Firebase Client SDK
  try {
    const auth = getFirebaseAuth();
    const userCredential = await auth.signInWithEmailAndPassword(cleanEmail, password);
    const user = userCredential.user;

    let assignedHospital = getAdminAssignedHospital(user);
    if (!assignedHospital) {
      try {
        if (typeof firebase !== "undefined" && firebase.database) {
          const snap = await firebase.database().ref(`admins/${user.uid}`).once("value");
          let val = snap.val();
          if (!val && user.email) {
            const emailKey = user.email.toLowerCase().trim().replace(/\./g, ",");
            const snapEmail = await firebase.database().ref(`admins/${emailKey}`).once("value");
            val = snapEmail.val();
          }
          if (val) {
            assignedHospital = typeof val === "string" ? val : (val.hospitalId || val.hospital);
          }
        }
      } catch (e) {}
    }

    if (!assignedHospital) {
      const detectedUid = user.uid;
      await auth.signOut();
      sessionStorage.clear();
      throw new Error(`Access Denied: Account (${user.email || detectedUid}) is not assigned to any hospital. Please use an email with your hospital number (e.g. admin-h02@... or hospital2@...) or contact the Super Administrator.`);
    }

    sessionStorage.setItem("admin_uid", user.uid);
    sessionStorage.setItem("admin_email", user.email || cleanEmail);
    sessionStorage.setItem("admin_assigned_hospital", assignedHospital);
    return user;
  } catch (sdkError) {
    console.warn("Engine 1 (SDK) notice:", sdkError.message, "-> Activating Engine 2 (Direct Identity REST)...");

    // Engine 2: Direct Google Identity Toolkit REST Call (Guaranteed to work across all browsers)
    const restUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`;
    
    let restResp;
    try {
      restResp = await fetch(restUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          password: password,
          returnSecureToken: true
        })
      });
    } catch (netErr) {
      throw new Error("Network connection blocked. If you are using Opera or Brave, please disable the built-in ad/tracker blocker for localhost.");
    }

    const restData = await restResp.json();

    if (!restResp.ok) {
      const errMsg = (restData.error && restData.error.message) || sdkError.message;
      if (errMsg === "INVALID_LOGIN_CREDENTIALS" || errMsg === "INVALID_PASSWORD") {
        throw new Error("Incorrect email or password. Please verify credentials.");
      } else if (errMsg === "EMAIL_NOT_FOUND") {
        throw new Error("No administrator account found with this email.");
      } else if (errMsg === "TOO_MANY_ATTEMPTS_TRY_LATER") {
        throw new Error("Account temporarily locked due to multiple failed attempts. Please try again later.");
      } else if (errMsg === "API_KEY_INVALID") {
        throw new Error("API key invalid. Please ensure Opera ad/tracker blocking is turned OFF for localhost.");
      }
      throw new Error("Authentication failed: " + errMsg);
    }

    // Direct REST Success!
    const uid = restData.localId;
    const restUser = { uid: uid, email: restData.email || cleanEmail };
    let assignedHospital = getAdminAssignedHospital(restUser);
    if (!assignedHospital) {
      try {
        if (typeof firebase !== "undefined" && firebase.database) {
          const snap = await firebase.database().ref(`admins/${uid}`).once("value");
          let val = snap.val();
          if (!val && restUser.email) {
            const emailKey = restUser.email.toLowerCase().trim().replace(/\./g, ",");
            const snapEmail = await firebase.database().ref(`admins/${emailKey}`).once("value");
            val = snapEmail.val();
          }
          if (val) {
            assignedHospital = typeof val === "string" ? val : (val.hospitalId || val.hospital);
          }
        }
      } catch (e) {}
    }

    if (!assignedHospital) {
      sessionStorage.clear();
      throw new Error(`Access Denied: Account (${restUser.email}) is not assigned to any hospital. Please use an email with your hospital number (e.g. admin-h02@... or hospital2@...) or contact the Super Administrator.`);
    }

    // Save session
    sessionStorage.setItem("admin_uid", uid);
    sessionStorage.setItem("admin_email", restUser.email);
    sessionStorage.setItem("admin_token", restData.idToken);
    sessionStorage.setItem("admin_assigned_hospital", assignedHospital);

    return {
      uid: uid,
      email: restUser.email
    };
  }
}

/**
 * Sign out current administrator
 */
async function logoutAdmin() {
  sessionStorage.clear();
  try {
    const auth = getFirebaseAuth();
    await auth.signOut();
  } catch (e) {}
  window.location.href = "login.html";
}

/**
 * Auth Guard for Admin Dashboard
 * Calls callback only when an authorized administrator UID is confirmed.
 * Redirects to login.html if not authenticated or unauthorized.
 *
 * @param {function(Object):void} onAuthorized
 */
function requireAdminAuth(onAuthorized) {
  let authorizedCalled = false;
  function triggerAuthorized(user) {
    if (authorizedCalled) return;
    authorizedCalled = true;
    if (typeof onAuthorized === "function") {
      onAuthorized(user);
    }
  }

  const storedUid = sessionStorage.getItem("admin_uid");
  const storedEmail = sessionStorage.getItem("admin_email");

  // Fallback timer: if SDK takes too long, fall back to sessionStorage
  const timer = setTimeout(() => {
    if (!authorizedCalled && storedUid && isAuthorizedAdminUid(storedUid)) {
      triggerAuthorized({ uid: storedUid, email: storedEmail });
    } else if (!authorizedCalled && !storedUid) {
      window.location.replace("login.html");
    }
  }, 1000);

  try {
    const auth = getFirebaseAuth();
    
    // Check if auth already has a user synchronously
    if (auth.currentUser && isAuthorizedAdmin(auth.currentUser)) {
      clearTimeout(timer);
      triggerAuthorized(auth.currentUser);
    }

    auth.onAuthStateChanged(async (user) => {
      clearTimeout(timer);
      if (!user) {
        if (storedUid && isAuthorizedAdmin({ uid: storedUid, email: storedEmail })) {
          triggerAuthorized({ uid: storedUid, email: storedEmail });
          return;
        }
        window.location.replace("login.html");
        return;
      }

      let assigned = getAdminAssignedHospital(user);
      if (!assigned) {
        try {
          if (typeof firebase !== "undefined" && firebase.database) {
            const snap = await firebase.database().ref(`admins/${user.uid}`).once("value");
            let val = snap.val();
            if (!val && user.email) {
              const emailKey = user.email.toLowerCase().trim().replace(/\./g, ",");
              const snapEmail = await firebase.database().ref(`admins/${emailKey}`).once("value");
              val = snapEmail.val();
            }
            if (val) {
              assigned = typeof val === "string" ? val : (val.hospitalId || val.hospital);
            }
          }
        } catch (e) {}
      }

      if (!assigned) {
        console.warn("Unauthorized user detected:", user.email || user.uid);
        const badUid = user.uid;
        await auth.signOut();
        sessionStorage.clear();
        window.location.replace("login.html?error=unauthorized&uid=" + encodeURIComponent(badUid));
        return;
      }

      sessionStorage.setItem("admin_uid", user.uid);
      sessionStorage.setItem("admin_email", user.email);
      sessionStorage.setItem("admin_assigned_hospital", assigned);
      triggerAuthorized(user);
    });
  } catch (err) {
    console.error("Auth guard error:", err);
    if (storedUid && isAuthorizedAdmin({ uid: storedUid, email: storedEmail })) {
      triggerAuthorized({ uid: storedUid, email: storedEmail });
    } else {
      window.location.replace("login.html");
    }
  }
}

/**
 * Redirect already authenticated admin away from login.html
 */
function redirectIfAlreadyLoggedIn() {
  const storedUid = sessionStorage.getItem("admin_uid");
  const storedEmail = sessionStorage.getItem("admin_email");
  if (storedUid && isAuthorizedAdmin({ uid: storedUid, email: storedEmail })) {
    window.location.replace("admin.html");
    return;
  }

  try {
    const auth = getFirebaseAuth();
    auth.onAuthStateChanged((user) => {
      if (user && isAuthorizedAdmin(user)) {
        window.location.replace("admin.html");
      }
    });
  } catch (e) {}
}
