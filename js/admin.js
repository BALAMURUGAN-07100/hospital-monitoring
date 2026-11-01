/**
 * Hospital Patient Monitoring System
 * Administrator Dashboard Script
 */

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const adminHospitalsContainer = document.getElementById("adminHospitalsContainer");
  const adminTotalWaitingEl = document.getElementById("adminTotalWaiting");
  const adminTotalInEl = document.getElementById("adminTotalIn");
  const adminTotalOutEl = document.getElementById("adminTotalOut");
  const adminTotalRemainingEl = document.getElementById("adminTotalRemaining");
  const connectionStatusEl = document.getElementById("connectionStatus");
  const statusDotEl = document.getElementById("statusDot");
  const adminEmailDisplay = document.getElementById("adminEmailDisplay");
  const logoutBtn = document.getElementById("logoutBtn");
  const historyTableBody = document.getElementById("historyTableBody");
  const historyFilter = document.getElementById("historyFilter");
  const clearHistoryFilterBtn = document.getElementById("clearHistoryFilterBtn");

  // Modal elements
  const editModal = document.getElementById("editModal");
  const editHospitalIdInput = document.getElementById("editHospitalId");
  const editHospitalNameInput = document.getElementById("editHospitalName");
  const editHospitalAddressInput = document.getElementById("editHospitalAddress");
  const saveNameBtn = document.getElementById("saveNameBtn");
  const cancelNameBtn = document.getElementById("cancelNameBtn");

  // State
  let adminUser = null;
  let db = null;
  let hospitalsData = {};
  let dailyData = {};
  let eventsList = [];
  let actionInProgress = {}; // map of hospitalId -> boolean to prevent rapid double-clicks

  // 1. Guard page with requireAdminAuth
  requireAdminAuth(async (user) => {
    adminUser = user;

    // Check Firebase Database /admins/<uid> or /admins/<emailKey> for an assigned hospitalId mapping
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
          const hid = typeof val === "string" ? val : (val.hospitalId || val.hospital);
          if (hid) {
            sessionStorage.setItem("admin_assigned_hospital", hid);
          }
        }
      }
    } catch (e) {
      console.warn("Database admin check note:", e.message);
    }

    const assigned = getAssignedHospital();
    if (adminEmailDisplay) {
      const email = user.email || "Authorized Admin";
      if (assigned === "ALL") {
        adminEmailDisplay.innerHTML = `${escapeHtml(email)} <span style="background:#0284c7; color:#fff; font-size:0.75rem; padding:2px 8px; border-radius:10px; margin-left:6px; font-weight:600;">Super Admin (All Hospitals)</span>`;
      } else {
        adminEmailDisplay.innerHTML = `${escapeHtml(email)} <span style="background:#16a34a; color:#fff; font-size:0.75rem; padding:2px 8px; border-radius:10px; margin-left:6px; font-weight:600;">Hospital ${assigned} Admin</span>`;
      }
    }
    initializeDashboard();
  });

  function getAllLiveHospitalIds() {
    const dataKeys = Object.keys(hospitalsData || {});
    const dailyKeys = Object.keys(dailyData || {});
    const combined = Array.from(new Set([...HOSPITAL_IDS, ...dataKeys, ...dailyKeys]));
    if (typeof sortHospitalIds === "function") {
      return sortHospitalIds(combined);
    }
    return combined.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }

  function getAssignedHospital() {
    // 1. Explicit Super Admin whitelist (ONLY Balamurugan gets ALL)
    if (adminUser) {
      const email = (adminUser.email || "").toLowerCase();
      if (email.includes("balamurugan") || (typeof AUTHORIZED_ADMIN_UIDS !== "undefined" && AUTHORIZED_ADMIN_UIDS.includes(adminUser.uid))) {
        return "ALL";
      }
    }

    // 2. Compute directly from current user email (e.g. admin-h02, hospital2, admin2)
    if (adminUser && typeof getAdminAssignedHospital === "function") {
      const computed = getAdminAssignedHospital(adminUser);
      if (computed && computed !== "ALL") {
        return computed;
      }
    }

    // 3. Check session storage (from database mapping)
    const fromSession = sessionStorage.getItem("admin_assigned_hospital");
    if (fromSession && fromSession !== "ALL") {
      return fromSession;
    }

    // 4. Fallback for non-superadmin: default to H01 (never ALL)
    return "H01";
  }

  function getVisibleHospitals() {
    const assigned = getAssignedHospital();
    if (assigned === "ALL") {
      return getAllLiveHospitalIds();
    }
    return [assigned];
  }

  // Logout Handler
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to log out from the Administrator Dashboard?")) {
        logoutAdmin();
      }
    });
  }

  function initializeDashboard() {
    const assigned = getAssignedHospital();

    try {
      db = getFirebaseDb();
    } catch (err) {
      showToast("Firebase init error: " + err.message, "error");
      return;
    }

    // Monitor connection
    const connectedRef = db.ref(".info/connected");
    connectedRef.on("value", (snap) => {
      const isConnected = snap.val() === true;
      if (connectionStatusEl && statusDotEl) {
        if (isConnected) {
          connectionStatusEl.textContent = "Live Connected";
          statusDotEl.className = "status-dot online";
        } else {
          connectionStatusEl.textContent = "Reconnecting...";
          statusDotEl.className = "status-dot connecting";
        }
      }
    });

    // Populate history filter dropdown
    refreshHistoryFilterDropdown();
    if (historyFilter) {
      historyFilter.addEventListener("change", () => renderHistoryTable());
    }

    // Add Hospital Button visibility (Only Super Admin can add new hospitals)
    const openAddHospitalBtn = document.getElementById("openAddHospitalBtn");
    if (openAddHospitalBtn && assigned === "ALL") {
      openAddHospitalBtn.style.display = "inline-flex";
      openAddHospitalBtn.addEventListener("click", openAddHospitalModal);
    }

    if (clearHistoryFilterBtn) {
      if (assigned !== "ALL") {
        clearHistoryFilterBtn.style.display = "none";
      } else {
        clearHistoryFilterBtn.addEventListener("click", () => {
          if (historyFilter) historyFilter.value = "ALL";
          renderHistoryTable();
        });
      }
    }

    // Render initial grid immediately (no stuck loading screen)
    renderAdminHospitals();
    updateSummaryMetrics();

    // 2a. Subscribe to publicHospitals (guaranteed immediate read, never blocked by auth)
    db.ref("publicHospitals").on("value", (snap) => {
      const pubData = snap.val();
      if (pubData) {
        hospitalsData = Object.assign({}, hospitalsData, pubData);
        renderAdminHospitals();
        updateSummaryMetrics();
        refreshHistoryFilterDropdown();
      }
    });

    // 2b. Subscribe to private hospitals path
    db.ref("hospitals").on("value", (snap) => {
      const privData = snap.val();
      if (privData) {
        hospitalsData = Object.assign({}, hospitalsData, privData);
        renderAdminHospitals();
        updateSummaryMetrics();
        refreshHistoryFilterDropdown();
      }
    }, (err) => {
      console.warn("Private hospitals path note:", err.message);
    });

    // 3. Subscribe to today's daily statistics (Asia/Kolkata)
    const todayKey = getTodayDateKeyIST();
    db.ref("daily").on("value", (snap) => {
      const allDaily = snap.val() || {};
      // Filter for todayKey
      dailyData = {};
      HOSPITAL_IDS.forEach(hid => {
        if (allDaily[hid] && allDaily[hid][todayKey]) {
          dailyData[hid] = allDaily[hid][todayKey];
        } else {
          dailyData[hid] = { inTotal: 0, outTotal: 0 };
        }
      });
      renderAdminHospitals();
      updateSummaryMetrics();
    });

    // 4. Subscribe to events
    let previousEventIds = new Set();
    db.ref("events").on("value", (snap) => {
      const allEvents = snap.val() || {};
      const flattened = [];
      Object.keys(allEvents).forEach(hid => {
        const hospitalEvents = allEvents[hid] || {};
        Object.keys(hospitalEvents).forEach(eid => {
          flattened.push({
            id: eid,
            ...hospitalEvents[eid]
          });
          if (previousEventIds.size > 0 && !previousEventIds.has(eid)) {
            const ev = hospitalEvents[eid];
            if (ev && ev.hospitalId && ev.action) {
              triggerPatientJourney(ev.hospitalId, ev.action);
            }
          }
          previousEventIds.add(eid);
        });
      });

      // Sort descending by timestamp
      flattened.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      eventsList = flattened;
      renderHistoryTable();
    });

    // Modal listeners
    if (cancelNameBtn) {
      cancelNameBtn.addEventListener("click", closeEditModal);
    }

    if (saveNameBtn) {
      saveNameBtn.addEventListener("click", handleSaveHospitalName);
    }
  }

  /**
   * Render Hospital Admin Cards (All 10 for Super Admin, or ONLY the assigned one for Hospital Admin)
   */
  function renderAdminHospitals() {
    if (!adminHospitalsContainer) return;

    const visibleList = getVisibleHospitals();

    adminHospitalsContainer.innerHTML = visibleList.map((id) => {
      const numIndex = HOSPITAL_IDS.indexOf(id);
      const defaultName = `Hospital ${String(numIndex >= 0 ? numIndex + 1 : 1).padStart(2, "0")}`;
      const hospital = hospitalsData[id] || {};
      const name = hospital.name || defaultName;
      const waiting = typeof hospital.waitingCount === "number" ? hospital.waitingCount : 0;
      const capacity = HOSPITAL_CAPACITY;
      const remaining = Math.max(0, capacity - waiting);
      const updatedAt = hospital.updatedAt || null;
      const loc = typeof getHospitalLocation === "function" ? getHospitalLocation(id, hospital) : { address: `${name} Medical Center`, lat: 13.06, lng: 80.25 };
      const routeUrl = typeof getGoogleMapsRouteUrl === "function" ? getGoogleMapsRouteUrl(loc.address, loc.lat, loc.lng) : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.address)}`;


      const daily = dailyData[id] || { inTotal: 0, outTotal: 0 };
      const inToday = daily.inTotal || 0;
      const outToday = daily.outTotal || 0;

      const percentage = (waiting / capacity) * 100;
      let levelClass = "low";
      if (waiting >= 40) levelClass = "high";
      else if (waiting >= 25) levelClass = "medium";

      const isLocked = actionInProgress[id] === true;
      const disableIn = isLocked || waiting >= capacity;
      const disableOut = isLocked || waiting <= 0;

      return `
        <article class="hospital-card" id="admin-card-${id}">
          <header class="hospital-header">
            <div>
              <span class="hospital-badge">${id}</span>
              <h2 class="hospital-name" id="hname-${id}">${escapeHtml(name)}</h2>
            </div>
            <button class="edit-name-btn" onclick="window.openEditNameModal('${id}')">Edit Name</button>
          </header>

          <div class="metric-display">
            <div class="metric-number">${waiting}</div>
            <div class="metric-label">Waiting Patients (${remaining} free seats)</div>
          </div>

          <!-- Location & Route Info -->
          <div class="hospital-location-chip" title="${escapeHtml(loc.address)}">
            <span class="location-icon">📍</span>
            <span class="location-text">${escapeHtml(loc.address)}</span>
            <a href="${routeUrl}" target="_blank" rel="noopener noreferrer" style="color:#0284c7; font-weight:800; font-size:0.75rem; text-decoration:underline; margin-left:auto;">Route ↗</a>
          </div>

          <div class="progress-container">
            <div class="progress-track" title="Occupancy: ${percentage.toFixed(0)}%">
              <div class="progress-fill ${levelClass}" style="width: ${percentage}%"></div>
            </div>
          </div>

          <!-- Animated Patient Transit Stage (Home <-> Hospital) -->
          <div class="transit-stage" id="transit-stage-${id}">
            <div class="transit-point home-point" title="Home: Patients depart or return here">
              <span class="transit-icon">🏠</span>
              <span class="transit-label">Home</span>
            </div>
            <div class="transit-track" id="transit-track-${id}">
              <div class="transit-lane"></div>
            </div>
            <div class="transit-point hospital-point" title="Hospital: Queue admission & treatment">
              <span class="transit-icon">🏥</span>
              <span class="transit-label">Hospital</span>
            </div>
          </div>

          <div class="daily-counts-pill">
            <span class="daily-in">Today's IN: <strong>+${inToday}</strong></span>
            <span class="daily-out">Today's OUT: <strong>-${outToday}</strong></span>
          </div>

          <div class="admin-card-controls">
            <button class="btn btn-in" data-id="${id}" data-action="IN" ${disableIn ? "disabled" : ""}
              onclick="window.handlePatientAction('${id}', 'IN')">
              <span class="toy-icon toy-in">🚶‍♂️</span>
              <span>+ Patient IN</span>
            </button>
            <button class="btn btn-out" data-id="${id}" data-action="OUT" ${disableOut ? "disabled" : ""}
              onclick="window.handlePatientAction('${id}', 'OUT')">
              <span class="toy-icon toy-out">🏃‍♂️</span>
              <span>- Patient OUT</span>
            </button>
          </div>

          <footer class="card-meta">
            <span>Capacity: ${capacity}</span>
            <span>Updated: ${formatISTDateTime(updatedAt)}</span>
          </footer>
        </article>
      `;
    }).join("");
  }

  /**
   * Update aggregate summary metrics at top of Admin Dashboard
   */
  function updateSummaryMetrics() {
    const visibleList = getVisibleHospitals();
    const assigned = getAssignedHospital();

    let totalWaiting = 0;
    let totalInToday = 0;
    let totalOutToday = 0;
    const totalCapacity = visibleList.length * HOSPITAL_CAPACITY;

    visibleList.forEach(id => {
      const hospital = hospitalsData[id] || {};
      const waiting = typeof hospital.waitingCount === "number" ? hospital.waitingCount : 0;
      totalWaiting += waiting;

      const daily = dailyData[id] || { inTotal: 0, outTotal: 0 };
      totalInToday += (daily.inTotal || 0);
      totalOutToday += (daily.outTotal || 0);
    });

    const totalRemaining = Math.max(0, totalCapacity - totalWaiting);

    if (adminTotalWaitingEl) adminTotalWaitingEl.textContent = totalWaiting;
    if (adminTotalInEl) adminTotalInEl.textContent = totalInToday;
    if (adminTotalOutEl) adminTotalOutEl.textContent = totalOutToday;
    if (adminTotalRemainingEl) adminTotalRemainingEl.textContent = totalRemaining;

    // Adjust subtexts if viewing a single assigned hospital
    if (assigned !== "ALL") {
      const subtexts = document.querySelectorAll(".summary-grid .stat-subtext");
      if (subtexts && subtexts[0]) subtexts[0].textContent = `For Hospital ${assigned}`;
      if (subtexts && subtexts[1]) subtexts[1].textContent = `Today's admissions for ${assigned}`;
      if (subtexts && subtexts[2]) subtexts[2].textContent = `Today's discharges for ${assigned}`;
      if (subtexts && subtexts[3]) subtexts[3].textContent = `Out of ${totalCapacity} beds (${assigned})`;
    }
  }

  /**
   * Render Event History Table with IST dates and source tags
   */
  function renderHistoryTable() {
    if (!historyTableBody) return;

    const assigned = getAssignedHospital();
    const filterVal = (assigned !== "ALL") ? assigned : (historyFilter ? historyFilter.value : "ALL");

    const filteredEvents = eventsList.filter(e => {
      if (filterVal === "ALL") return true;
      return e.hospitalId === filterVal;
    });

    if (filteredEvents.length === 0) {
      historyTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: #64748b; padding: 2rem;">
            No patient events recorded yet today. Use the IN / OUT buttons above or ESP8266 devices.
          </td>
        </tr>
      `;
      return;
    }

    // Limit to latest 60 records for smooth display
    historyTableBody.innerHTML = filteredEvents.slice(0, 60).map(e => {
      const isIN = e.action === "IN";
      const badgeClass = isIN ? "badge-in" : "badge-out";
      const actionText = isIN ? "+ IN" : "- OUT";
      const sourceTag = e.source || "DEVICE";

      return `
        <tr>
          <td>${formatISTDateTime(e.timestamp)}</td>
          <td><strong>${e.hospitalId}</strong></td>
          <td><span class="badge ${badgeClass}">${actionText}</span></td>
          <td><strong>${e.waitingCount}</strong> / 50</td>
          <td><span class="badge badge-source">${escapeHtml(sourceTag)}</span></td>
          <td style="font-size: 0.75rem; color: #64748b;">${e.actorUid ? e.actorUid.substring(0, 10) + "..." : "—"}</td>
        </tr>
      `;
    }).join("");
  }

  /**
   * Animated Toy Traveler Journey (Home <-> Hospital)
   * Randomly selects: 🚶‍♂️ Walking | 🚴‍♂️ Bike | 🚗 Car | ✈️ Aeroplane
   *
   * @param {string} hospitalId
   * @param {"IN"|"OUT"} action
   */
  function triggerPatientJourney(hospitalId, action) {
    const track = document.getElementById(`transit-track-${hospitalId}`);
    if (!track) return;

    const modes = [
      { emoji: "🚶‍♂️", inAnim: "travelInWalk 1.8s ease-in-out forwards", outAnim: "travelOutWalk 1.8s ease-in-out forwards" },
      { emoji: "🚴‍♂️", inAnim: "travelInBike 1.4s ease-in-out forwards", outAnim: "travelOutBike 1.4s ease-in-out forwards" },
      { emoji: "🚗", inAnim: "travelInCar 1.1s ease-in-out forwards", outAnim: "travelOutCar 1.1s ease-in-out forwards" },
      { emoji: "✈️", inAnim: "travelInPlane 1.3s ease-in-out forwards", outAnim: "travelOutPlane 1.3s ease-in-out forwards" }
    ];

    const chosen = modes[Math.floor(Math.random() * modes.length)];

    const avatar = document.createElement("div");
    avatar.className = "traveler-avatar";
    avatar.textContent = chosen.emoji;
    avatar.style.animation = (action === "IN") ? chosen.inAnim : chosen.outAnim;

    track.appendChild(avatar);

    setTimeout(() => {
      if (avatar.parentNode) avatar.parentNode.removeChild(avatar);
    }, 2000);
  }
  window.triggerPatientJourney = triggerPatientJourney;

  /**
   * Handle Patient IN or OUT button press with Atomic RTDB Transaction
   *
   * @param {string} hospitalId
   * @param {"IN"|"OUT"} action
   */
  window.handlePatientAction = async function (hospitalId, action) {
    if (actionInProgress[hospitalId]) return;

    const assigned = getAssignedHospital();
    if (assigned !== "ALL" && assigned !== hospitalId) {
      showToast(`Permission Denied: You are only authorized to manage Hospital ${assigned}.`, "error");
      return;
    }

    // Trigger instant visual traveler animation
    triggerPatientJourney(hospitalId, action);

    actionInProgress[hospitalId] = true;
    renderAdminHospitals();

    try {
      const hospitalRef = db.ref(`hospitals/${hospitalId}`);
      const waitingCountRef = db.ref(`hospitals/${hospitalId}/waitingCount`);

      // Run authoritative atomic transaction on waitingCount
      const txResult = await waitingCountRef.transaction((currentCount) => {
        const count = typeof currentCount === "number" ? currentCount : 0;

        if (action === "IN") {
          if (count >= HOSPITAL_CAPACITY) {
            return; // Abort transaction! Capacity reached.
          }
          return count + 1;
        } else if (action === "OUT") {
          if (count <= 0) {
            return; // Abort transaction! Already zero.
          }
          return count - 1;
        }
      });

      if (!txResult.committed) {
        const currentVal = txResult.snapshot.val() || 0;
        if (action === "IN" && currentVal >= HOSPITAL_CAPACITY) {
          showToast(`Rejected: ${hospitalId} is already at full capacity (${HOSPITAL_CAPACITY} seats).`, "error");
        } else if (action === "OUT" && currentVal <= 0) {
          showToast(`Rejected: ${hospitalId} waiting queue is already empty (0).`, "error");
        } else {
          showToast(`Transaction aborted due to concurrent conflict. Please retry.`, "error");
        }
        return;
      }

      const newWaitingCount = txResult.snapshot.val();
      const currentName = (hospitalsData[hospitalId] && hospitalsData[hospitalId].name) || `Hospital ${hospitalId}`;
      const nowTs = Date.now();
      const dateKeyIST = getTodayDateKeyIST(nowTs);

      // Synchronize 1: Update private hospital record metadata
      await hospitalRef.update({
        id: hospitalId,
        name: currentName,
        waitingCount: newWaitingCount,
        capacity: HOSPITAL_CAPACITY,
        updatedAt: nowTs
      });

      // Synchronize 2: Update sanitized public path (/publicHospitals/HXX)
      await db.ref(`publicHospitals/${hospitalId}`).update({
        id: hospitalId,
        name: currentName,
        waitingCount: newWaitingCount,
        capacity: HOSPITAL_CAPACITY,
        updatedAt: nowTs
      });

      // Synchronize 3: Increment daily total for Asia/Kolkata date key atomically
      const dailyRef = db.ref(`daily/${hospitalId}/${dateKeyIST}`);
      await dailyRef.transaction((currentDaily) => {
        const d = currentDaily || { inTotal: 0, outTotal: 0 };
        if (action === "IN") {
          d.inTotal = (d.inTotal || 0) + 1;
          d.outTotal = d.outTotal || 0;
        } else {
          d.outTotal = (d.outTotal || 0) + 1;
          d.inTotal = d.inTotal || 0;
        }
        d.lastUpdated = nowTs;
        return d;
      });

      // Synchronize 4: Append to tamper-evident events log
      const eventRef = db.ref(`events/${hospitalId}`).push();
      await eventRef.set({
        hospitalId: hospitalId,
        action: action,
        waitingCount: newWaitingCount,
        timestamp: nowTs,
        source: "ADMIN_WEB",
        actorUid: adminUser.uid
      });

      showToast(`Success: Patient ${action} recorded for ${currentName}. Waiting: ${newWaitingCount}`, "success");

    } catch (err) {
      console.error("Action error:", err);
      showToast("Operation failed: " + err.message, "error");
    } finally {
      actionInProgress[hospitalId] = false;
      renderAdminHospitals();
    }
  };

  /**
   * Edit Hospital Name Modal Controls
   */
  window.openEditNameModal = function (hospitalId) {
    const assigned = getAssignedHospital();
    if (assigned !== "ALL" && assigned !== hospitalId) {
      showToast(`Permission Denied: You cannot rename Hospital ${hospitalId}.`, "error");
      return;
    }

    const currentHospital = hospitalsData[hospitalId] || {};
    const currentName = currentHospital.name || `Hospital ${hospitalId}`;
    const loc = typeof getHospitalLocation === "function" ? getHospitalLocation(hospitalId, currentHospital) : { address: "" };
    
    if (editHospitalIdInput) editHospitalIdInput.value = hospitalId;
    if (editHospitalNameInput) editHospitalNameInput.value = currentName;
    if (editHospitalAddressInput) editHospitalAddressInput.value = currentHospital.address || loc.address || "";
    if (editModal) editModal.classList.remove("hidden");
  };

  function closeEditModal() {
    if (editModal) editModal.classList.add("hidden");
  }

  async function handleSaveHospitalName() {
    const hospitalId = editHospitalIdInput.value.trim();
    const newName = editHospitalNameInput.value.trim();

    const assigned = getAssignedHospital();
    if (assigned !== "ALL" && assigned !== hospitalId) {
      showToast(`Permission Denied: You cannot rename Hospital ${hospitalId}.`, "error");
      return;
    }

    if (!hospitalId || !newName) {
      showToast("Hospital name cannot be blank.", "error");
      return;
    }

    if (newName.length > 80) {
      showToast("Hospital name must be 80 characters or fewer.", "error");
      return;
    }

    try {
      const nowTs = Date.now();

      const newAddress = editHospitalAddressInput ? editHospitalAddressInput.value.trim() : "";
      const updatePayload = {
        name: newName,
        updatedAt: nowTs
      };
      if (newAddress) updatePayload.address = newAddress;

      // Update in private hospitals
      await db.ref(`hospitals/${hospitalId}`).update(updatePayload);

      // Update in publicHospitals
      await db.ref(`publicHospitals/${hospitalId}`).update(updatePayload);

      showToast(`Hospital name for ${hospitalId} updated to "${newName}".`, "success");
      closeEditModal();
    } catch (err) {
      console.error("Name update error:", err);
      showToast("Failed to update name: " + err.message, "error");
    }
  }

  function refreshHistoryFilterDropdown() {
    if (!historyFilter) return;
    const assigned = getAssignedHospital();
    const currentVal = historyFilter.value;
    if (assigned === "ALL") {
      const allIds = getAllLiveHospitalIds();
      historyFilter.innerHTML = '<option value="ALL">All Hospitals</option>' +
        allIds.map(id => `<option value="${id}">${id}</option>`).join("");
      if (allIds.includes(currentVal) || currentVal === "ALL") {
        historyFilter.value = currentVal;
      }
    } else {
      historyFilter.innerHTML = `<option value="${assigned}">Hospital ${assigned} (Assigned)</option>`;
      historyFilter.disabled = true;
    }
  }

  // Add Hospital Modal controls
  const addHospitalModal = document.getElementById("addHospitalModal");
  const cancelAddBtn = document.getElementById("cancelAddBtn");
  const confirmAddBtn = document.getElementById("confirmAddBtn");
  const newHospitalIdInput = document.getElementById("newHospitalId");
  const newHospitalNameInput = document.getElementById("newHospitalName");
  const newHospitalAddressInput = document.getElementById("newHospitalAddress");

  function openAddHospitalModal() {
    const allIds = getAllLiveHospitalIds();
    let nextNum = 1;
    allIds.forEach(id => {
      const m = id.match(/^H(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= nextNum) nextNum = n + 1;
      }
    });
    const suggestedId = `H${String(nextNum).padStart(2, "0")}`;
    if (newHospitalIdInput) newHospitalIdInput.value = suggestedId;
    if (newHospitalNameInput) newHospitalNameInput.value = `Hospital ${String(nextNum).padStart(2, "0")}`;
    if (newHospitalAddressInput) newHospitalAddressInput.value = "";
    if (addHospitalModal) addHospitalModal.classList.remove("hidden");
  }

  function closeAddHospitalModal() {
    if (addHospitalModal) addHospitalModal.classList.add("hidden");
  }

  if (cancelAddBtn) cancelAddBtn.addEventListener("click", closeAddHospitalModal);

  if (confirmAddBtn) {
    confirmAddBtn.addEventListener("click", async () => {
      if (!adminUser || !db) return;
      const rawId = (newHospitalIdInput.value || "").trim().toUpperCase();
      const rawName = (newHospitalNameInput.value || "").trim();

      let id = rawId;
      if (!id.startsWith("H")) {
        id = "H" + id.padStart(2, "0");
      }

      if (!/^H\d+$/.test(id)) {
        showToast("Invalid Hospital ID! Must be H followed by numbers (e.g. H11, H12).", "error");
        return;
      }

      const name = rawName || `Hospital ${id}`;
      confirmAddBtn.disabled = true;
      confirmAddBtn.textContent = "Creating...";

      const address = newHospitalAddressInput ? newHospitalAddressInput.value.trim() : "";
      const newRecord = {
        id: id,
        name: name,
        waitingCount: 0,
        capacity: HOSPITAL_CAPACITY,
        updatedAt: Date.now()
      };
      if (address) {
        newRecord.address = address;
      }

      try {
        await db.ref(`hospitals/${id}`).set(newRecord);
        await db.ref(`publicHospitals/${id}`).set(newRecord);
        showToast(`Hospital ${id} ("${name}") added successfully!`, "success");
        closeAddHospitalModal();
        renderAdminHospitals();
        updateSummaryMetrics();
        refreshHistoryFilterDropdown();
      } catch (err) {
        showToast("Failed to add hospital: " + err.message, "error");
      } finally {
        confirmAddBtn.disabled = false;
        confirmAddBtn.textContent = "Create Hospital";
      }
    });
  }

  /**
   * Toast notification helper
   */
  function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
