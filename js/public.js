/**
 * Hospital Patient Monitoring System
 * Public Dashboard Script (Read-Only)
 */

document.addEventListener("DOMContentLoaded", () => {
  const hospitalsContainer = document.getElementById("hospitalsContainer");
  const totalWaitingEl = document.getElementById("totalWaiting");
  const totalCapacityEl = document.getElementById("totalCapacity");
  const totalRemainingEl = document.getElementById("totalRemaining");
  const totalHospitalsEl = document.getElementById("totalHospitals");
  const connectionStatusEl = document.getElementById("connectionStatus");
  const statusDotEl = document.getElementById("statusDot");
  const lastSyncTimeEl = document.getElementById("lastSyncTime");
  const searchInput = document.getElementById("searchInput");

  let currentHospitalsData = {};
  let filterQuery = "";

  // Set total hospitals count
  if (totalHospitalsEl) {
    totalHospitalsEl.textContent = HOSPITAL_IDS.length;
  }

  // 1. Initialize Firebase Realtime Database
  let db;
  try {
    db = getFirebaseDb();
  } catch (err) {
    console.error("Firebase init error:", err);
    showErrorState("Could not initialize Firebase connection: " + err.message);
    return;
  }

  // 2. Monitor Realtime Connection State
  const connectedRef = db.ref(".info/connected");
  connectedRef.on("value", (snap) => {
    const isConnected = snap.val() === true;
    updateConnectionStatus(isConnected);
  });

  function updateConnectionStatus(isConnected) {
    if (!connectionStatusEl || !statusDotEl) return;
    if (isConnected) {
      connectionStatusEl.textContent = "Live Connected";
      statusDotEl.className = "status-dot online";
    } else {
      connectionStatusEl.textContent = "Reconnecting...";
      statusDotEl.className = "status-dot connecting";
    }
  }

  // 3. Listen to sanitized public data path: /publicHospitals
  const publicHospitalsRef = db.ref("publicHospitals");

  publicHospitalsRef.on("value", (snapshot) => {
    const data = snapshot.val() || {};
    currentHospitalsData = data;
    renderDashboard();
  }, (error) => {
    console.error("Firebase Read Error:", error);
    showErrorState("Unable to load live hospital data: " + error.message);
  });

  // 4. Search Filter
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      filterQuery = e.target.value.trim().toLowerCase();
      renderDashboard();
    });
  }

  function getLiveHospitalIds() {
    const dataKeys = Object.keys(currentHospitalsData || {});
    const combined = dataKeys.length > 0 ? Array.from(new Set([...HOSPITAL_IDS, ...dataKeys])) : HOSPITAL_IDS;
    if (typeof sortHospitalIds === "function") {
      return sortHospitalIds(combined);
    }
    return Array.from(new Set(combined)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }

  const lastWaitingCounts = {};

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
   * Render all dynamically detected hospital cards and summary metrics
   */
  function renderDashboard() {
    const activeIds = getLiveHospitalIds();
    let totalWaiting = 0;
    let totalSeatsRemaining = 0;
    const totalCapacity = activeIds.length * HOSPITAL_CAPACITY;

    if (totalHospitalsEl) {
      totalHospitalsEl.textContent = activeIds.length;
    }

    const cardsHtml = activeIds.map((id, index) => {
      const defaultName = `Hospital ${String(index + 1).padStart(2, "0")}`;
      const record = currentHospitalsData[id] || {};

      const name = record.name || defaultName;
      const waiting = typeof record.waitingCount === "number" ? Math.max(0, Math.min(record.waitingCount, 50)) : 0;
      const capacity = typeof record.capacity === "number" ? record.capacity : HOSPITAL_CAPACITY;
      const remaining = Math.max(0, capacity - waiting);
      const updatedAt = record.updatedAt || null;

      totalWaiting += waiting;
      totalSeatsRemaining += remaining;

      // Trigger traveler animation if count changed
      if (lastWaitingCounts[id] !== undefined && lastWaitingCounts[id] !== waiting) {
        const action = waiting > lastWaitingCounts[id] ? "IN" : "OUT";
        setTimeout(() => triggerPatientJourney(id, action), 80);
      }
      lastWaitingCounts[id] = waiting;

      // Filter check
      if (filterQuery) {
        const matchesId = id.toLowerCase().includes(filterQuery);
        const matchesName = name.toLowerCase().includes(filterQuery);
        if (!matchesId && !matchesName) {
          return "";
        }
      }

      // Occupancy styling
      const percentage = (waiting / capacity) * 100;
      let levelClass = "low";
      let seatStatusClass = "available";
      if (waiting >= 40) {
        levelClass = "high";
        seatStatusClass = "full";
      } else if (waiting >= 25) {
        levelClass = "medium";
        seatStatusClass = "warning";
      }

      return `
        <article class="hospital-card" id="card-${id}">
          <header class="hospital-header">
            <div>
              <span class="hospital-badge">${id}</span>
              <h2 class="hospital-name">${escapeHtml(name)}</h2>
            </div>
          </header>

          <div class="metric-display">
            <div class="metric-number">${waiting}</div>
            <div class="metric-label">Waiting Patients</div>
          </div>

          <div class="progress-container">
            <div class="progress-track" title="Occupancy: ${percentage.toFixed(0)}%">
              <div class="progress-fill ${levelClass}" style="width: ${percentage}%"></div>
            </div>
            <div class="seat-stats">
              <span>Capacity: ${capacity}</span>
              <span class="seat-remaining ${seatStatusClass}">${remaining} seats free</span>
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
            <div class="transit-point hospital-point" title="Hospital: Queue & treatment">
              <span class="transit-icon">🏥</span>
              <span class="transit-label">Hospital</span>
            </div>
          </div>

          <footer class="card-meta">
            <span>Status: Active</span>
            <span>Updated: ${formatISTDateTime(updatedAt)}</span>
          </footer>
        </article>
      `;
    }).join("");

    // Update Summary Header Cards
    if (totalWaitingEl) totalWaitingEl.textContent = totalWaiting;
    if (totalCapacityEl) totalCapacityEl.textContent = totalCapacity;
    if (totalRemainingEl) totalRemainingEl.textContent = totalSeatsRemaining;
    if (lastSyncTimeEl) lastSyncTimeEl.textContent = formatISTDateTime(Date.now());

    // Render Cards
    if (hospitalsContainer) {
      if (!cardsHtml.trim()) {
        hospitalsContainer.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: white; border-radius: 12px; color: #64748b;">
            <p style="font-size: 1.1rem; font-weight: 600;">No hospitals matched "${escapeHtml(filterQuery)}"</p>
            <p style="font-size: 0.85rem; margin-top: 0.5rem;">Try searching by hospital ID (e.g. H01) or a different name.</p>
          </div>
        `;
      } else {
        hospitalsContainer.innerHTML = cardsHtml;
      }
    }
  }

  function showErrorState(msg) {
    if (statusDotEl) statusDotEl.className = "status-dot offline";
    if (connectionStatusEl) connectionStatusEl.textContent = "Connection Error";
    if (hospitalsContainer) {
      hospitalsContainer.innerHTML = `
        <div style="grid-column: 1/-1; padding: 2rem; background: #fee2e2; border: 1px solid #fecaca; border-radius: 12px; color: #991b1b;">
          <h3 style="margin-bottom: 0.5rem; font-weight: 700;">Connection Alert</h3>
          <p>${escapeHtml(msg)}</p>
          <p style="font-size: 0.85rem; margin-top: 0.5rem; color: #7f1d1d;">
            Ensure the Firebase Realtime Database rules have been published to allow public read access to <code>publicHospitals</code>.
          </p>
        </div>
      `;
    }
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
