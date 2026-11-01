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

  let userLocation = null;

  function initGeolocation() {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          };
          console.log("GPS Location acquired:", userLocation);
          renderDashboard();
          if (leafletMap) updateMapMarkers();
        },
        (err) => {
          console.log("Geolocation notice:", err.message);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  }
  initGeolocation();


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

      const loc = typeof getHospitalLocation === "function" ? getHospitalLocation(id, record) : { address: `${name} Medical Center`, lat: 13.06, lng: 80.25 };
      const routeUrl = typeof getGoogleMapsRouteUrl === "function" ? getGoogleMapsRouteUrl(loc.address, loc.lat, loc.lng) : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.address)}`;
      const distKm = (userLocation && typeof calculateDistanceKm === "function") ? calculateDistanceKm(userLocation.lat, userLocation.lng, loc.lat, loc.lng) : null;

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

          <!-- Location Details & Distance -->
          <div class="hospital-location-chip" title="${escapeHtml(loc.address)}">
            <span class="location-icon">📍</span>
            <span class="location-text">${escapeHtml(loc.address)}</span>
            ${distKm !== null ? `<span class="badge-distance">⚡ ${distKm} km away</span>` : ''}
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

          <!-- 3D Best Route Navigation Actions -->
          <div class="card-route-actions">
            <a href="${routeUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-route" title="Find Best Route to ${escapeHtml(name)} with Google Maps">
              <span>🧭</span>
              <span>Find Best Route (Google Maps)</span>
            </a>
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.initOrOpenMapModal('${id}')" title="View ${id} on interactive map" style="width:100%; font-size:0.8rem; margin-top:0.35rem;">
              🗺️ View on Interactive Map
            </button>
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

  
  let leafletMap = null;
  let mapMarkers = [];
  let userMarker = null;

  function initOrOpenMapModal(targetHid = null) {
    const mapModal = document.getElementById("mapModal");
    if (!mapModal) return;
    mapModal.classList.remove("hidden");

    setTimeout(() => {
      if (!leafletMap && typeof L !== "undefined") {
        leafletMap = L.map("hospitalMap").setView([13.06, 80.25], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(leafletMap);
      } else if (leafletMap) {
        leafletMap.invalidateSize();
      }
      updateMapMarkers(targetHid);
    }, 200);
  }
  window.initOrOpenMapModal = initOrOpenMapModal;

  function updateMapMarkers(targetHid = null) {
    if (!leafletMap || typeof L === "undefined") return;

    mapMarkers.forEach(m => leafletMap.removeLayer(m));
    mapMarkers = [];

    if (userMarker) {
      leafletMap.removeLayer(userMarker);
      userMarker = null;
    }

    if (userLocation) {
      const userIcon = L.divIcon({
        className: 'user-gps-marker',
        html: '<div style="background:#0284c7; width:18px; height:18px; border-radius:50%; border:3px solid white; box-shadow:0 0 10px #0284c7;"></div>',
        iconSize: [20, 20]
      });
      userMarker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
        .addTo(leafletMap)
        .bindPopup("<strong>📍 Your Current Location</strong>");
    }

    const activeIds = getLiveHospitalIds();
    let targetLatLng = null;

    activeIds.forEach((id, idx) => {
      const defaultName = `Hospital ${String(idx + 1).padStart(2, "0")}`;
      const rec = currentHospitalsData[id] || {};
      const name = rec.name || defaultName;
      const waiting = typeof rec.waitingCount === "number" ? Math.max(0, Math.min(rec.waitingCount, 50)) : 0;
      const capacity = typeof rec.capacity === "number" ? rec.capacity : HOSPITAL_CAPACITY;
      const remaining = Math.max(0, capacity - waiting);
      const loc = typeof getHospitalLocation === "function" ? getHospitalLocation(id, rec) : { address: `${name} Center`, lat: 13.06, lng: 80.25 };
      const routeUrl = typeof getGoogleMapsRouteUrl === "function" ? getGoogleMapsRouteUrl(loc.address, loc.lat, loc.lng) : `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
      const dist = (userLocation && typeof calculateDistanceKm === "function") ? calculateDistanceKm(userLocation.lat, userLocation.lng, loc.lat, loc.lng) : null;

      let markerColor = "#16a34a";
      if (waiting >= 40) markerColor = "#dc2626";
      else if (waiting >= 25) markerColor = "#d97706";

      const customIcon = L.divIcon({
        className: 'custom-hospital-marker',
        html: `<div style="background:${markerColor}; color:white; font-weight:900; font-size:11px; padding:3px 7px; border-radius:12px; border:2px solid white; box-shadow:0 3px 8px rgba(0,0,0,0.3); text-align:center;">${id}</div>`,
        iconSize: [36, 24],
        iconAnchor: [18, 12]
      });

      const marker = L.marker([loc.lat, loc.lng], { icon: customIcon }).addTo(leafletMap);
      
      const popupContent = `
        <div style="font-family:system-ui; min-width:210px; padding:4px;">
          <h4 style="margin:0 0 4px 0; color:#0f172a; font-size:14px; font-weight:800;">${escapeHtml(name)} (${id})</h4>
          <p style="margin:0 0 6px 0; font-size:12px; color:#475569;">📍 ${escapeHtml(loc.address)}</p>
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:8px;">
            <span>Waiting: <strong>${waiting}</strong></span>
            <span style="color:${markerColor}; font-weight:800;">${remaining} beds free</span>
          </div>
          ${dist !== null ? `<div style="font-size:11px; color:#0284c7; font-weight:700; margin-bottom:8px;">⚡ ${dist} km away from you</div>` : ''}
          <a href="${routeUrl}" target="_blank" rel="noopener noreferrer" style="display:block; text-align:center; background:#0284c7; color:white; font-size:12px; font-weight:800; padding:6px 10px; border-radius:8px; text-decoration:none; box-shadow:0 2px 4px rgba(2,132,199,0.3);">
            🧭 Start GPS Navigation (Maps)
          </a>
        </div>
      `;

      marker.bindPopup(popupContent);
      mapMarkers.push(marker);

      if (id === targetHid) {
        targetLatLng = [loc.lat, loc.lng];
        marker.openPopup();
      }
    });

    if (targetLatLng) {
      leafletMap.setView(targetLatLng, 14);
    } else if (userLocation) {
      leafletMap.setView([userLocation.lat, userLocation.lng], 12);
    }
  }

  const closeMapBtn = document.getElementById("closeMapBtn");
  const mapModal = document.getElementById("mapModal");
  if (closeMapBtn) {
    closeMapBtn.addEventListener("click", () => {
      if (mapModal) mapModal.classList.add("hidden");
    });
  }
  if (mapModal) {
    mapModal.addEventListener("click", (e) => {
      if (e.target === mapModal) mapModal.classList.add("hidden");
    });
  }

  const openMapNavBtn = document.getElementById("openMapNavBtn");
  if (openMapNavBtn) {
    openMapNavBtn.addEventListener("click", () => initOrOpenMapModal());
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
