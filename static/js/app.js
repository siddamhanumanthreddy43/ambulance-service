/**
 * Emergency Ambulance Smart Routing Dashboard - Main Coordinator
 * Integrates Leaflet mapping, hospital selection, map-click destination picking,
 * real-time routing, and vehicle telemetry.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initial State
  const defaultAmbulanceLocation = { lat: 12.9716, lng: 77.5946 }; // Metropolitan Center
  let currentDestination = null;
  let currentHospitalList = [];
  let isMapClickDestinationMode = true;
  let patientPickups = [];
  let isPickupModeActive = false;
  let pendingPickupCoord = null;

  // 2. Initialize Leaflet Dark Mode Map
  if (window.L && L.Icon && L.Icon.Default) {
    L.Icon.Default.imagePath = "css/images/";
  }

  const map = L.map("map", {
    center: [defaultAmbulanceLocation.lat, defaultAmbulanceLocation.lng],
    zoom: 14,
    zoomControl: false,
    attributionControl: true
  });

  // Add Zoom control at bottom right for driver accessibility
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // 100% Free Open-Source Map Tile Providers (Zero API Keys Ever, Zero Watermarks)
  const tileProviders = {
    night: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      subdomains: "abc",
      maxZoom: 19,
      className: "map-tiles-night",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },
    day: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      subdomains: "abc",
      maxZoom: 19,
      className: "map-tiles-standard",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },
    humanitarian: {
      url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      subdomains: "abc",
      maxZoom: 19,
      className: "map-tiles-standard",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Humanitarian OSM'
    }
  };

  let activeThemeMode = "night"; // "night" | "day" | "humanitarian"
  let baseTileLayer = L.tileLayer(tileProviders.night.url, {
    subdomains: tileProviders.night.subdomains,
    maxZoom: tileProviders.night.maxZoom,
    className: tileProviders.night.className,
    attribution: tileProviders.night.attribution
  }).addTo(map);

  // Auto-failover: if primary tile server encounters errors, switch to backup Humanitarian OSM mirror
  let tileFallbackTriggered = false;
  baseTileLayer.on("tileerror", (err) => {
    if (!tileFallbackTriggered) {
      tileFallbackTriggered = true;
      console.warn("Primary OSM server busy, switching to backup Humanitarian OSM mirror...");
      baseTileLayer.setUrl(tileProviders.humanitarian.url);
    }
  });

  // Leaflet Container Layout Fix: Prevent blank gray map due to flexbox height calculation
  function forceMapResize() {
    if (map) {
      map.invalidateSize({ pan: false });
    }
  }
  requestAnimationFrame(forceMapResize);
  setTimeout(forceMapResize, 100);
  setTimeout(forceMapResize, 350);
  setTimeout(forceMapResize, 1000);
  setTimeout(forceMapResize, 2500);

  window.addEventListener("resize", forceMapResize);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) forceMapResize();
  });

  // 3. Initialize Route Renderer & Telemetry Manager
  const routeRenderer = new RouteRenderer(map);
  const hospitalMarkersGroup = L.layerGroup().addTo(map);

  const telemetry = new TelemetryManager(map, (pos, speed, heading) => {
    // 1. Dynamic Turn-by-Turn Spoken Guidance & HUD Countdown
    routeRenderer.onVehicleProgress(pos, speed, heading);

    // 2. Check Proximity to Destination Hospital for Pre-Admitted Patient Handover
    checkHospitalAdmissionArrival(pos);
  });

  // Track hospital arrival handover for pre-registered admitted patients
  let hospitalArrivalNotified = false;
  function checkHospitalAdmissionArrival(pos) {
    if (!currentDestination || registeredAdmissions.length === 0) return;
    const latest = registeredAdmissions[0];
    if (latest.status === "ADMITTED_ON_ARRIVAL") return;

    const dist = routeRenderer.haversineMeters(pos.lat, pos.lng, currentDestination.lat, currentDestination.lng);

    // Arriving at Hospital ER doors (< 120m)
    if (dist <= 120 && !hospitalArrivalNotified) {
      hospitalArrivalNotified = true;

      // Show Arrival & Handover Banner
      const arrivedBanner = document.getElementById("patient-arrived-banner");
      const arrivedName = document.getElementById("patient-arrived-name");
      if (arrivedBanner && arrivedName) {
        arrivedName.textContent = `Arrived at ${currentDestination.name}: Handover ${latest.patient_name} to ${latest.assigned_bay}`;
        arrivedBanner.classList.remove("hidden");
      }

      if (window.emergencyAudio) {
        window.emergencyAudio.speak(
          `Arrived at destination hospital ${currentDestination.name}. Handing over pre-registered patient ${latest.patient_name} to ${latest.assigned_bay}.`,
          true,
          true
        );
      }
    }
  }

  const btnBannerBoard = document.getElementById("btn-banner-board-patient");
  if (btnBannerBoard) {
    btnBannerBoard.textContent = "Complete Hospital Admission";
    btnBannerBoard.addEventListener("click", async () => {
      if (registeredAdmissions.length > 0) {
        const latest = registeredAdmissions[0];
        try {
          const apiBase = window.API_CONFIG ? window.API_CONFIG.baseUrl : "";
          await fetch(`${apiBase}/api/patient/admissions/${latest.registration_id}/admit`, { method: "POST" });
          latest.status = "ADMITTED_ON_ARRIVAL";
          updateHospitalAdmissionHUD();
          const arrivedBanner = document.getElementById("patient-arrived-banner");
          if (arrivedBanner) arrivedBanner.classList.add("hidden");
          if (window.emergencyAudio) {
            window.emergencyAudio.speak(`Patient admission completed. Official ER handover confirmed.`, true, true);
          }
        } catch (e) {
          console.warn("Admission handover error:", e);
        }
      }
    });
  }

  // 4. Load Hospitals from Backend (supports geographic proximity around live location)
  async function loadHospitals(centerLocation = null) {
    try {
      const apiBase = window.API_CONFIG ? window.API_CONFIG.baseUrl : "";
      let res;
      if (centerLocation) {
        res = await fetch(`${apiBase}/api/hospitals/nearby`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ambulance_location: { lat: centerLocation.lat, lng: centerLocation.lng },
            radius_km: 50.0
          })
        });
      } else {
        res = await fetch(`${apiBase}/api/hospitals`);
      }

      if (res && res.ok) {
        currentHospitalList = await res.json();
        populateHospitalSelector(currentHospitalList);
        renderHospitalMapPins(currentHospitalList);

        // Auto-select first trauma center and calculate initial route if not set
        if (currentHospitalList.length > 0 && !currentDestination) {
          selectHospitalDestination(currentHospitalList[0]);
        }
      }
    } catch (err) {
      console.warn("Could not load hospital list:", err);
    }
  }

  function populateHospitalSelector(hospitals) {
    const selectElem = document.getElementById("hospital-select");
    const container = document.getElementById("quick-hospital-cards");
    const countBadge = document.getElementById("hud-hospital-count-badge");

    if (countBadge) {
      countBadge.textContent = `${hospitals.length} Found`;
    }

    if (!selectElem) return;

    selectElem.innerHTML = `<option value="">-- Choose Emergency Medical Center (${hospitals.length} nearby) --</option>`;
    if (container) container.innerHTML = "";

    hospitals.forEach((h, idx) => {
      // Option for dropdown
      const opt = document.createElement("option");
      opt.value = h.id;
      opt.textContent = `${h.name} (${h.distance_km ? `${h.distance_km} km` : h.trauma_level})`;
      selectElem.appendChild(opt);

      // Quick-select cards in driver drawer (up to 6 local hospitals)
      if (container && idx < 6) {
        const card = document.createElement("div");
        card.className = `p-3 rounded-xl border border-slate-800 bg-slate-900/80 hover:bg-slate-800 cursor-pointer transition flex items-center justify-between group`;
        card.innerHTML = `
          <div class="min-w-0 pr-2">
            <p class="text-xs font-bold text-slate-200 group-hover:text-emerald-400 transition truncate">${h.name}</p>
            <p class="text-[10px] text-slate-400 truncate">${h.trauma_level} • ${h.er_beds_available} ER beds</p>
          </div>
          <span class="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-1 rounded-md flex-shrink-0">
            ${h.distance_km ? `${h.distance_km} km` : 'Select'}
          </span>
        `;
        card.addEventListener("click", () => {
          selectHospitalDestination(h);
        });
        container.appendChild(card);
      }
    });

    selectElem.addEventListener("change", (e) => {
      const selectedId = e.target.value;
      if (!selectedId) return;
      const hosp = hospitals.find(h => h.id === selectedId);
      if (hosp) {
        selectHospitalDestination(hosp);
      }
    });
  }

  function renderHospitalMapPins(hospitals) {
    hospitalMarkersGroup.clearLayers();
    hospitals.forEach(h => {
      const pinIcon = L.divIcon({
        className: "hospital-pin-container",
        html: `
          <div class="w-8 h-8 rounded-full bg-slate-900 border-2 border-emerald-500 shadow-md flex items-center justify-center hover:scale-110 transition cursor-pointer">
            <span class="text-emerald-400 font-bold text-xs">H</span>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const m = L.marker([h.lat, h.lng], { icon: pinIcon }).addTo(hospitalMarkersGroup);
      m.bindPopup(`
        <div class="p-1">
          <p class="font-bold text-emerald-400 text-sm">${h.name}</p>
          <p class="text-xs text-slate-300">${h.trauma_level}</p>
          <div class="flex gap-2 mt-2">
            <span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono">ER Beds: ${h.er_beds_available}</span>
            <span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">ICU: ${h.icu_beds_available}</span>
          </div>
          <button id="pin-route-btn-${h.id}" class="mt-3 w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition">
            Route Here Now
          </button>
        </div>
      `);

      m.on("popupopen", () => {
        const btn = document.getElementById(`pin-route-btn-${h.id}`);
        if (btn) {
          btn.onclick = () => {
            selectHospitalDestination(h);
            map.closePopup();
          };
        }
      });
    });
  }

  async function selectHospitalDestination(hospital) {
    currentDestination = {
      lat: hospital.lat,
      lng: hospital.lng,
      name: hospital.name
    };

    // Update active hospital header badge
    const badge = document.getElementById("active-hospital-badge");
    if (badge) badge.textContent = hospital.name;

    // Calculate Route with any active patient pickup stops
    const route = await routeRenderer.calculateAndRender(
      telemetry.currentPosition,
      currentDestination,
      hospital.name,
      patientPickups
    );
    updatePatientPickupsHUD();
  }

  // 5. Map-Click Destination Picking or Patient Pickup
  map.on("click", async (e) => {
    const clickedCoord = { lat: e.latlng.lat, lng: e.latlng.lng };

    // If driver clicked while in "Pickup Patient" mode OR while ambulance is actively simulating en route to hospital
    if (isPickupModeActive || telemetry.simulationRunning) {
      pendingPickupCoord = clickedCoord;
      openPatientPickupModal(clickedCoord);
      return;
    }

    const customName = `Custom Destination (${clickedCoord.lat.toFixed(3)}, ${clickedCoord.lng.toFixed(3)})`;
    
    currentDestination = {
      lat: clickedCoord.lat,
      lng: clickedCoord.lng,
      name: customName
    };

    const badge = document.getElementById("active-hospital-badge");
    if (badge) badge.textContent = `Target Point: ${clickedCoord.lat.toFixed(4)}, ${clickedCoord.lng.toFixed(4)}`;

    // Show temporary target pin & route
    await routeRenderer.calculateAndRender(
      telemetry.currentPosition,
      clickedCoord,
      customName,
      patientPickups
    );
    updatePatientPickupsHUD();
  });

  // 6. EMERGENCY REROUTE BUTTON
  const btnReroute = document.getElementById("btn-emergency-reroute");
  if (btnReroute) {
    btnReroute.addEventListener("click", async () => {
      if (!currentDestination) {
        alert("Please set a destination first.");
        return;
      }
      await routeRenderer.triggerEmergencyReroute(
        telemetry.currentPosition,
        null,
        "Sudden Heavy Traffic / Roadblock Ahead"
      );
    });
  }

  // 7. Route Comparison Toggle Buttons
  const btnFastest = document.getElementById("btn-route-fastest");
  const btnShortest = document.getElementById("btn-route-shortest");

  if (btnFastest) {
    btnFastest.addEventListener("click", () => {
      routeRenderer.setRouteType("fastest_traffic");
    });
  }

  if (btnShortest) {
    btnShortest.addEventListener("click", () => {
      routeRenderer.setRouteType("shortest_distance");
    });
  }

  // 7b. Clear Route & Destination Button
  const btnClearRoute = document.getElementById("btn-clear-route");
  if (btnClearRoute) {
    btnClearRoute.addEventListener("click", () => {
      routeRenderer.clearRoute();
      currentDestination = null;
      const hospBadge = document.getElementById("active-hospital-badge");
      if (hospBadge) hospBadge.textContent = "Standby: No Destination Selected";
      
      const hospSelect = document.getElementById("hospital-select");
      if (hospSelect) hospSelect.value = "";

      registeredAdmissions = [];
      updateHospitalAdmissionHUD();

      if (window.emergencyAudio) {
        window.emergencyAudio.speak("Navigation route cleared. Ambulance standing by.", true);
      }
    });
  }

  // 7c. Toggle HUD Collapse / Minimize
  const btnToggleHud = document.getElementById("btn-toggle-hud-collapse");
  const hudDrawerBody = document.getElementById("hud-drawer-body");
  const hudCollapseIcon = document.getElementById("hud-collapse-icon");
  let isHudCollapsed = false;

  if (btnToggleHud && hudDrawerBody) {
    btnToggleHud.addEventListener("click", () => {
      isHudCollapsed = !isHudCollapsed;
      if (isHudCollapsed) {
        hudDrawerBody.classList.add("hidden");
        if (hudCollapseIcon) hudCollapseIcon.style.transform = "rotate(-90deg)";
        btnToggleHud.title = "Expand HUD Panel";
      } else {
        hudDrawerBody.classList.remove("hidden");
        if (hudCollapseIcon) hudCollapseIcon.style.transform = "rotate(0deg)";
        btnToggleHud.title = "Minimize HUD Panel";
      }
    });
  }

  // 7d. HUD Tab Navigation (Route vs Hospitals)
  const tabBtnNav = document.getElementById("tab-btn-nav");
  const tabBtnHosp = document.getElementById("tab-btn-hospitals");
  const tabPaneNav = document.getElementById("tab-pane-nav");
  const tabPaneHosp = document.getElementById("tab-pane-hospitals");

  if (tabBtnNav && tabBtnHosp && tabPaneNav && tabPaneHosp) {
    tabBtnNav.addEventListener("click", () => {
      tabPaneNav.classList.remove("hidden");
      tabPaneHosp.classList.add("hidden");
      tabBtnNav.className = "flex-1 py-1 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-emerald-600 text-white shadow";
      tabBtnHosp.className = "flex-1 py-1 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-slate-800 text-slate-400 hover:text-white";
    });

    tabBtnHosp.addEventListener("click", () => {
      tabPaneHosp.classList.remove("hidden");
      tabPaneNav.classList.add("hidden");
      tabBtnHosp.className = "flex-1 py-1 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-emerald-600 text-white shadow";
      tabBtnNav.className = "flex-1 py-1 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-slate-800 text-slate-400 hover:text-white";
    });
  }

  // 8. Simulation & GPS Controls
  const btnSim = document.getElementById("btn-toggle-sim");
  if (btnSim) {
    btnSim.addEventListener("click", () => {
      const opPulse = document.getElementById("op-moving-pulse");
      if (telemetry.simulationRunning) {
        telemetry.stopSimulation();
        if (opPulse) opPulse.classList.add("hidden");
        if (window.emergencyAudio) {
          window.emergencyAudio.speak("Simulation paused.");
        }
      } else {
        if (!routeRenderer.routeData) {
          alert("Please calculate a route first.");
          return;
        }
        const activeRoute = routeRenderer.activeRouteType === "fastest_traffic"
          ? routeRenderer.routeData.recommended_route
          : routeRenderer.routeData.alternative_route;
        
        const coords = activeRoute.polyline_geojson.coordinates.map(c => [c[1], c[0]]);
        telemetry.startSimulationAlongRoute(coords);
        if (opPulse) opPulse.classList.remove("hidden");

        if (window.emergencyAudio) {
          window.emergencyAudio.speak(`Emergency drive started to ${currentDestination ? currentDestination.name : 'destination hospital'}. Voice navigation active.`, true, true);
        }
      }
    });
  }

  const btnGps = document.getElementById("btn-toggle-gps");
  if (btnGps) {
    btnGps.addEventListener("click", () => {
      if (telemetry.geolocationWatchId !== null) {
        telemetry.stopDeviceGeolocation();
        btnGps.classList.remove("bg-emerald-600", "text-white");
        btnGps.classList.add("bg-slate-800", "text-slate-300");
      } else {
        telemetry.startDeviceGeolocation();
      }
    });
  }

  // 9. Siren Toggle with Audio Synthesizer
  const btnSiren = document.getElementById("btn-toggle-siren");
  const sirenIndicator = document.getElementById("siren-strobe-indicator");

  if (btnSiren) {
    btnSiren.addEventListener("click", () => {
      const isPlaying = window.emergencyAudio.toggleSiren();
      telemetry.sirenActive = isPlaying;

      if (isPlaying) {
        btnSiren.classList.add("bg-red-600", "text-white", "shadow-red-500/50");
        btnSiren.classList.remove("bg-slate-800", "text-slate-400");
        if (sirenIndicator) sirenIndicator.classList.add("emergency-strobe");
      } else {
        btnSiren.classList.remove("bg-red-600", "text-white", "shadow-red-500/50");
        btnSiren.classList.add("bg-slate-800", "text-slate-400");
        if (sirenIndicator) sirenIndicator.classList.remove("emergency-strobe");
      }

      // Notify WebSocket
      if (telemetry.ws && telemetry.ws.readyState === WebSocket.OPEN) {
        telemetry.ws.send(JSON.stringify({
          type: "emergency_siren_toggle",
          siren_active: isPlaying
        }));
      }
    });
  }

  // 9b. Voice Navigation Guidance Toggle
  const btnVoice = document.getElementById("btn-toggle-voice");
  const voiceIcon = document.getElementById("voice-icon");
  const voiceLabel = document.getElementById("voice-label");

  if (btnVoice) {
    btnVoice.addEventListener("click", () => {
      const isVoiceOn = window.emergencyAudio.toggleVoice();
      if (isVoiceOn) {
        btnVoice.classList.add("bg-emerald-600", "text-white");
        btnVoice.classList.remove("bg-slate-800", "text-slate-400");
        if (voiceIcon) voiceIcon.textContent = "🔊";
        if (voiceLabel) voiceLabel.textContent = "Voice On";
      } else {
        btnVoice.classList.remove("bg-emerald-600", "text-white");
        btnVoice.classList.add("bg-slate-800", "text-slate-400");
        if (voiceIcon) voiceIcon.textContent = "🔇";
        if (voiceLabel) voiceLabel.textContent = "Voice Muted";
      }
    });
  }

  // 9c. Patient Pickup En Route Management
  const patientModal = document.getElementById("patient-modal");
  const patientModalClose = document.getElementById("patient-modal-close");
  const patientModalCancel = document.getElementById("patient-modal-cancel");
  const patientModalConfirm = document.getElementById("patient-modal-confirm");
  const patientModalCoords = document.getElementById("patient-modal-coords");
  const btnTogglePickupMode = document.getElementById("btn-toggle-pickup-mode");
  const pickupModeBtnText = document.getElementById("pickup-mode-btn-text");
  const mapClickHint = document.getElementById("map-click-hint");

  function calculateAndSetAheadOpCoord() {
    let aheadLat, aheadLng;
    if (telemetry.activeWaypoints && telemetry.activeWaypoints.length > 2) {
      const targetIdx = Math.min(telemetry.activeWaypoints.length - 2, (telemetry.simWaypointIndex || 0) + 6);
      aheadLat = telemetry.activeWaypoints[targetIdx][0];
      aheadLng = telemetry.activeWaypoints[targetIdx][1];
    } else {
      const pos = telemetry.currentPosition;
      const headingRad = (telemetry.currentHeading || 45) * Math.PI / 180;
      aheadLat = pos.lat + (500 * Math.cos(headingRad)) / 111000;
      aheadLng = pos.lng + (500 * Math.sin(headingRad)) / (111000 * Math.cos(pos.lat * Math.PI / 180));
    }

    pendingPickupCoord = {
      lat: Number(aheadLat.toFixed(5)),
      lng: Number(aheadLng.toFixed(5))
    };
    return pendingPickupCoord;
  }

  // 9c. Hospital Pre-Admission & Bed Registration (Patient Travelling in Ambulance)
  let registeredAdmissions = [];

  function openHospitalAdmissionModal() {
    if (!patientModal) return;
    const hospName = currentDestination ? currentDestination.name : (currentHospitalList[0] ? currentHospitalList[0].name : "Emergency Medical Center");
    const hospDisplay = document.getElementById("admission-modal-hospital-name");
    const hospSub = document.getElementById("admission-target-hospital-sub");
    if (hospDisplay) hospDisplay.textContent = hospName;
    if (hospSub) hospSub.textContent = `Travelling in Unit AMB-042 to ${hospName}`;

    patientModal.classList.remove("hidden");
  }

  function closeHospitalAdmissionModal() {
    if (patientModal) patientModal.classList.add("hidden");
  }

  if (btnTogglePickupMode) {
    btnTogglePickupMode.addEventListener("click", () => {
      openHospitalAdmissionModal();
    });
  }

  if (patientModalClose) patientModalClose.addEventListener("click", closeHospitalAdmissionModal);
  if (patientModalCancel) patientModalCancel.addEventListener("click", closeHospitalAdmissionModal);

  if (patientModalConfirm) {
    patientModalConfirm.addEventListener("click", async () => {
      const name = document.getElementById("patient-input-name").value || "Emergency Patient";
      const age = parseInt(document.getElementById("patient-input-age").value) || 42;
      const gender = document.getElementById("patient-input-gender").value || "Male";
      const admType = document.getElementById("patient-input-admission-type").value;
      const triage = document.getElementById("patient-input-triage").value;
      const notes = document.getElementById("patient-input-notes").value || "Trauma / Acute medical condition";
      const phone = document.getElementById("patient-input-phone").value || "+91-9848012345";

      const bp = document.getElementById("patient-vital-bp").value || "130/85";
      const pulse = document.getElementById("patient-vital-pulse").value || "94";
      const spo2 = document.getElementById("patient-vital-spo2").value || "96";
      const temp = document.getElementById("patient-vital-temp").value || "98.6";

      const hospId = (currentDestination && currentDestination.id) ? currentDestination.id : "hosp-001";
      const hospName = currentDestination ? currentDestination.name : "Apollo Emergency & Trauma Center";

      const payload = {
        patient_name: name,
        age: age,
        gender: gender,
        contact_phone: phone,
        admission_type: admType,
        triage_level: triage,
        chief_complaint: notes,
        vitals: { bp, pulse, spo2, temp },
        destination_hospital_id: hospId,
        destination_hospital_name: hospName,
        ambulance_id: "AMB-042",
        notes: notes
      };

      try {
        const apiBase = window.API_CONFIG ? window.API_CONFIG.baseUrl : "";
        const res = await fetch(`${apiBase}/api/patient/admit-register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          registeredAdmissions.unshift({
            ...payload,
            registration_id: data.registration_id,
            assigned_bay: data.assigned_bay,
            registered_at: data.registered_at,
            status: "PRE_ADMITTED_EN_ROUTE"
          });

          closeHospitalAdmissionModal();
          updateHospitalAdmissionHUD();

          if (window.emergencyAudio) {
            window.emergencyAudio.speak(
              `Patient ${name} successfully pre-registered for hospital admission at ${hospName}. ${data.assigned_bay} reserved. ER team alerted.`,
              true,
              true
            );
          }
        }
      } catch (e) {
        console.error("Admission registration error:", e);
      }
    });
  }

  function updateHospitalAdmissionHUD() {
    const card = document.getElementById("hospital-admission-card");
    const content = document.getElementById("hospital-admission-content");
    const opPulse = document.getElementById("op-moving-pulse");

    if (!card || !content) return;

    if (registeredAdmissions.length === 0) {
      card.classList.add("hidden");
      if (opPulse) opPulse.classList.add("hidden");
      return;
    }

    card.classList.remove("hidden");
    if (opPulse) opPulse.classList.remove("hidden");

    const latest = registeredAdmissions[0];
    const isAdmitted = latest.status === "ADMITTED_ON_ARRIVAL";

    content.innerHTML = `
      <div class="p-2.5 rounded-xl bg-slate-900/90 border border-teal-700/60 flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span class="text-sm">${isAdmitted ? '✅' : '🚨'}</span>
            <span class="font-black text-white text-xs">${latest.patient_name} (${latest.age}/${latest.gender[0]})</span>
          </div>
          <span class="font-mono text-[9px] px-2 py-0.5 rounded font-black bg-teal-950 text-teal-300 border border-teal-700">
            ${latest.registration_id}
          </span>
        </div>

        <div class="flex items-center justify-between text-[11px] text-teal-300 font-bold">
          <span class="truncate">${latest.assigned_bay}</span>
          <span class="text-[9px] px-1 py-0.2 rounded font-bold uppercase ${latest.triage_level.includes('RED') ? 'bg-red-950 text-red-400' : 'bg-amber-950 text-amber-400'}">${latest.triage_level.split(' ')[0]}</span>
        </div>

        <!-- Vitals row -->
        <div class="grid grid-cols-4 gap-1 p-1.5 rounded-lg bg-slate-950/80 text-[10px] text-center font-mono border border-slate-800">
          <div><span class="text-slate-400 text-[8px] block">BP</span><span class="text-emerald-400 font-bold">${latest.vitals.bp}</span></div>
          <div><span class="text-slate-400 text-[8px] block">PULSE</span><span class="text-cyan-400 font-bold">${latest.vitals.pulse}</span></div>
          <div><span class="text-slate-400 text-[8px] block">SpO2</span><span class="text-teal-300 font-bold">${latest.vitals.spo2}%</span></div>
          <div><span class="text-slate-400 text-[8px] block">TEMP</span><span class="text-amber-300 font-bold">${latest.vitals.temp}°</span></div>
        </div>

        <p class="text-[10px] text-slate-300 truncate"><b>Complaint:</b> ${latest.chief_complaint}</p>
        <p class="text-[10px] text-emerald-400 truncate"><b>Admitting To:</b> ${latest.destination_hospital_name}</p>

        <button id="btn-admit-arrival" class="mt-1 w-full py-1.5 rounded-lg text-xs font-black transition flex items-center justify-center gap-1 ${isAdmitted ? 'bg-emerald-800 text-white' : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md'}">
          ${isAdmitted ? '✅ Admitted to Hospital ER' : '🏥 Mark Admitted on Arrival'}
        </button>
      </div>
    `;

    const admitBtn = document.getElementById("btn-admit-arrival");
    if (admitBtn && !isAdmitted) {
      admitBtn.addEventListener("click", async () => {
        try {
          const apiBase = window.API_CONFIG ? window.API_CONFIG.baseUrl : "";
          const res = await fetch(`${apiBase}/api/patient/admissions/${latest.registration_id}/admit`, { method: "POST" });
          if (res.ok) {
            latest.status = "ADMITTED_ON_ARRIVAL";
            updateHospitalAdmissionHUD();
            if (window.emergencyAudio) {
              window.emergencyAudio.speak(`Patient ${latest.patient_name} handover completed. Officially admitted to ${latest.destination_hospital_name}.`, true, true);
            }
          }
        } catch (e) {
          console.warn("Admission confirm error:", e);
        }
      });
    }
  }

  window.onPatientPickupToggled = async (patientId) => {
    const p = patientPickups.find(item => item.id === patientId);
    if (!p) return;
    p.picked_up = !p.picked_up;

    if (p.picked_up) {
      if (window.emergencyAudio) {
        window.emergencyAudio.speak(`Patient ${p.name} onboard. Proceeding to destination emergency entrance.`, true);
      }
    }

    if (currentDestination) {
      await routeRenderer.calculateAndRender(
        telemetry.currentPosition,
        currentDestination,
        currentDestination.name,
        patientPickups
      );
    }
    updatePatientPickupsHUD();
  };

  // 10. Recenter Button
  const btnRecenter = document.getElementById("btn-recenter");
  if (btnRecenter) {
    btnRecenter.addEventListener("click", () => {
      map.setView([telemetry.currentPosition.lat, telemetry.currentPosition.lng], 15, {
        animate: true,
        duration: 0.8
      });
    });
  }

  // 10b. Map Style Switcher (Night / Day / Humanitarian)
  const btnTheme = document.getElementById("btn-toggle-theme");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");

  function setMapTheme(mode) {
    activeThemeMode = mode;
    const provider = tileProviders[mode] || tileProviders.night;
    
    // Switch tile URL & class
    baseTileLayer.setUrl(provider.url);
    const tileContainer = baseTileLayer.getContainer();
    if (tileContainer) {
      tileContainer.className = `leaflet-layer ${provider.className}`;
    }

    if (mode === "night") {
      if (themeIcon) themeIcon.textContent = "🌙";
      if (themeLabel) themeLabel.textContent = "Night";
    } else if (mode === "day") {
      if (themeIcon) themeIcon.textContent = "☀️";
      if (themeLabel) themeLabel.textContent = "Day";
    } else if (mode === "humanitarian") {
      if (themeIcon) themeIcon.textContent = "🗺️";
      if (themeLabel) themeLabel.textContent = "Terrain";
    }
  }

  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      if (activeThemeMode === "night") {
        setMapTheme("day");
      } else if (activeThemeMode === "day") {
        setMapTheme("humanitarian");
      } else {
        setMapTheme("night");
      }
    });
  }

  // 11. Search Box Implementation (Instant Hospital & Global Address Search)
  const searchInput = document.getElementById("search-input");
  const searchDropdown = document.getElementById("search-results-dropdown");
  const searchSpinner = document.getElementById("search-spinner");
  const searchClearBtn = document.getElementById("search-clear-btn");
  const btnSearchMyLocation = document.getElementById("btn-search-my-location");

  let searchDebounceTimer = null;
  let currentSearchResults = [];

  async function performSearch(query) {
    const q = query.trim();
    if (!q || q.length < 2) {
      if (searchDropdown) {
        searchDropdown.classList.add("hidden");
        searchDropdown.innerHTML = "";
      }
      if (searchSpinner) searchSpinner.classList.add("hidden");
      return;
    }

    if (searchSpinner) searchSpinner.classList.remove("hidden");

    try {
      const apiBase = window.API_CONFIG ? window.API_CONFIG.baseUrl : "";
      const currentLoc = telemetry.currentPosition;
      const url = `${apiBase}/api/search?q=${encodeURIComponent(q)}&lat=${currentLoc.lat}&lng=${currentLoc.lng}`;
      const res = await fetch(url);
      if (res.ok) {
        const results = await res.json();
        currentSearchResults = results;
        renderSearchResults(results, q);
      }
    } catch (err) {
      console.warn("Search request failed:", err);
    } finally {
      if (searchSpinner) searchSpinner.classList.add("hidden");
    }
  }

  function renderSearchResults(results, query) {
    if (!searchDropdown) return;
    searchDropdown.innerHTML = "";

    if (!results || results.length === 0) {
      searchDropdown.innerHTML = `
        <div class="p-3 text-xs text-slate-400 text-center">
          No matching emergency locations found for "${query}".
        </div>
      `;
      searchDropdown.classList.remove("hidden");
      return;
    }

    results.forEach((item) => {
      const row = document.createElement("div");
      row.className = "search-item p-3 cursor-pointer transition flex items-center justify-between group";

      const distStr = item.distance_km != null ? `${item.distance_km.toFixed(1)} km` : "";
      const categoryBadge = item.category === "hospital"
        ? `<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800">Hospital</span>`
        : (item.category === "coordinate"
           ? `<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800">GPS</span>`
           : `<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">Place</span>`);

      row.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0 pr-2">
          <span class="text-base flex-shrink-0">${item.icon || '📍'}</span>
          <div class="min-w-0">
            <p class="text-xs font-bold text-white group-hover:text-emerald-400 transition truncate">${item.title}</p>
            <p class="text-[10px] text-slate-400 truncate">${item.subtitle || ''}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${distStr ? `<span class="text-[10px] font-mono text-cyan-400 font-bold">${distStr}</span>` : ''}
          ${categoryBadge}
        </div>
      `;

      row.addEventListener("click", () => {
        selectSearchResultDestination(item);
      });

      searchDropdown.appendChild(row);
    });

    searchDropdown.classList.remove("hidden");
  }

  async function selectSearchResultDestination(item) {
    if (searchInput) {
      searchInput.value = item.title;
    }
    if (searchClearBtn) {
      searchClearBtn.classList.remove("hidden");
    }
    if (searchDropdown) {
      searchDropdown.classList.add("hidden");
    }

    currentDestination = {
      lat: item.lat,
      lng: item.lng,
      name: item.title
    };

    // Update active badge in header
    const badge = document.getElementById("active-hospital-badge");
    if (badge) badge.textContent = item.title;

    // Pan & Zoom smoothly to destination
    map.flyTo([item.lat, item.lng], 15, {
      animate: true,
      duration: 1.0
    });

    // Calculate Route
    await routeRenderer.calculateAndRender(
      telemetry.currentPosition,
      currentDestination,
      item.title,
      patientPickups
    );
    updatePatientPickupsHUD();
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const val = e.target.value;
      if (searchClearBtn) {
        if (val.length > 0) searchClearBtn.classList.remove("hidden");
        else searchClearBtn.classList.add("hidden");
      }

      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        performSearch(val);
      }, 250);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (currentSearchResults && currentSearchResults.length > 0) {
          selectSearchResultDestination(currentSearchResults[0]);
        }
      } else if (e.key === "Escape") {
        if (searchDropdown) searchDropdown.classList.add("hidden");
      }
    });

    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim().length >= 2 && currentSearchResults.length > 0) {
        if (searchDropdown) searchDropdown.classList.remove("hidden");
      }
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener("click", () => {
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
      }
      searchClearBtn.classList.add("hidden");
      if (searchDropdown) {
        searchDropdown.classList.add("hidden");
        searchDropdown.innerHTML = "";
      }
    });
  }

  if (btnSearchMyLocation) {
    btnSearchMyLocation.addEventListener("click", () => {
      telemetry.acquireInitialLiveLocation(
        async (loc) => {
          map.setView([loc.lat, loc.lng], 15, { animate: true });
          await loadHospitals({ lat: loc.lat, lng: loc.lng });
        },
        (err) => {
          map.setView([telemetry.currentPosition.lat, telemetry.currentPosition.lng], 15, { animate: true });
        }
      );
    });
  }

  // Close search dropdown on click outside
  document.addEventListener("click", (e) => {
    const searchContainer = document.getElementById("search-container");
    if (searchContainer && !searchContainer.contains(e.target)) {
      if (searchDropdown) searchDropdown.classList.add("hidden");
    }
  });

  // 12. Startup: Fast Live Area Detection + Precision GPS
  async function initLiveAreaAndHospitals() {
    const apiBase = window.API_CONFIG ? window.API_CONFIG.baseUrl : "";
    const areaBadge = document.getElementById("hud-area-name-badge");
    const coordsBadge = document.getElementById("hud-coords-badge");

    let initialLocation = null;

    // Step 1: Immediate IP-based area detection (centers map on user's real city/area instantly)
    try {
      const res = await fetch(`${apiBase}/api/my-location`);
      if (res.ok) {
        const myLoc = await res.json();
        initialLocation = { lat: myLoc.lat, lng: myLoc.lng };

        console.log(`📍 Live Area detected: ${myLoc.area_name} (${myLoc.lat}, ${myLoc.lng})`);
        map.setView([myLoc.lat, myLoc.lng], 14, { animate: false });
        telemetry.updatePosition(myLoc.lat, myLoc.lng, 0, 0, true);

        if (areaBadge) areaBadge.textContent = `📍 ${myLoc.area_name || myLoc.city}`;
        if (coordsBadge) coordsBadge.textContent = `${myLoc.lat.toFixed(4)}° N, ${myLoc.lng.toFixed(4)}° E`;

        // Load real local hospitals for this detected area
        await loadHospitals(initialLocation);
      }
    } catch (e) {
      console.warn("Live area detection warning:", e);
    }

    if (!initialLocation) {
      initialLocation = defaultAmbulanceLocation;
      await loadHospitals(initialLocation);
    }

    // Step 2: Concurrently request high-accuracy HTML5 device GPS
    telemetry.acquireInitialLiveLocation(
      async (loc) => {
        console.log("📍 Precise device GPS locked:", loc);
        map.setView([loc.lat, loc.lng], 15, { animate: true, duration: 0.8 });

        // Reverse geocode to get exact neighborhood name
        try {
          const revRes = await fetch(`${apiBase}/api/reverse-geocode?lat=${loc.lat}&lng=${loc.lng}`);
          if (revRes.ok) {
            const revData = await revRes.json();
            if (areaBadge && revData.area_name) {
              areaBadge.textContent = `📍 ${revData.area_name}`;
            }
          }
        } catch (revErr) {
          console.warn("Reverse geocode warning:", revErr);
        }

        // Refresh local hospitals around high-precision GPS coordinates
        await loadHospitals({ lat: loc.lat, lng: loc.lng });
      },
      (err) => {
        console.info("Device GPS standby notice:", err.message);
      }
    );
  }

  // Run startup sequence
  await initLiveAreaAndHospitals();
});
