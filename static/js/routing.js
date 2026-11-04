/**
 * Emergency Ambulance Routing Engine (Frontend)
 * Visualizes dynamic traffic-segmented polylines, comparison routes,
 * turn-by-turn maneuvers, and emergency reroute actions.
 */

class RouteRenderer {
  constructor(map) {
    this.map = map;
    this.routeData = null;
    this.activeRouteType = "fastest_traffic"; // "fastest_traffic" or "shortest_distance"
    
    // Leaflet layer groups
    this.trafficLayerGroup = L.layerGroup().addTo(this.map);
    this.alternativeLayerGroup = L.layerGroup().addTo(this.map);
    this.incidentLayerGroup = L.layerGroup().addTo(this.map);
    this.pickupMarkersGroup = L.layerGroup().addTo(this.map);
    this.destinationMarker = null;
    this.patientPickups = [];

    // Turn tracking and dynamic voice navigation
    this.activeManeuvers = [];
    this.currentManeuverIndex = 0;
    this.spokenStepIndices = new Set();
    this.spokenTurnNowIndices = new Set();
    this.lastProximityCheckTime = 0;

    // Maneuver icon SVGs
    this.maneuverIcons = {
      "depart": `<svg class="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>`,
      "arrive": `<svg class="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>`,
      "pickup": `<svg class="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 11v6m-3-3h6"/></svg>`,
      "turn-left": `<svg class="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>`,
      "turn-right": `<svg class="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>`,
      "fork": `<svg class="w-7 h-7 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>`,
      "roundabout": `<svg class="w-7 h-7 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`,
      "straight": `<svg class="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>`
    };
  }

  async calculateAndRender(origin, destination, destName = "Emergency Destination", patientPickups = []) {
    try {
      this.showLoadingOverlay(true, "Optimizing Lowest-Congestion Route...");
      this.patientPickups = patientPickups || [];

      const apiBase = window.API_CONFIG ? window.API_CONFIG.baseUrl : "";
      const res = await fetch(`${apiBase}/api/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          destination_name: destName,
          patient_pickups: this.patientPickups
        })
      });

      if (!res.ok) {
        throw new Error(`Routing failed with HTTP ${res.status}`);
      }

      this.routeData = await res.json();
      this.renderCurrentRoute();
      this.updateHUDMetrics();
      this.updateDestinationMarker(destination, destName);
      this.renderPatientPickupMarkers();
      this.showLoadingOverlay(false);

      // Voice Turn-by-Turn Guidance Announcement
      if (window.emergencyAudio && window.emergencyAudio.voiceEnabled) {
        const activeRoute = this.activeRouteType === "fastest_traffic"
          ? this.routeData.recommended_route
          : this.routeData.alternative_route;

        const distKm = activeRoute.total_distance_km;
        const durMin = Math.round(activeRoute.total_duration_minutes);
        const unpickedCount = this.patientPickups.filter(p => !p.picked_up).length;

        if (unpickedCount > 0) {
          window.emergencyAudio.speak(
            `Route calculated with ${unpickedCount} patient pickup stop. Total distance ${distKm} kilometers, estimated arrival ${durMin} minutes to ${destName}.`
          );
        } else {
          window.emergencyAudio.speak(
            `Fastest route to ${destName} calculated. Distance ${distKm} kilometers, estimated arrival ${durMin} minutes.`
          );
        }
      }

      return this.routeData;

    } catch (err) {
      console.warn("Route calculation notice:", err);
      this.showLoadingOverlay(false);
      if (window.emergencyAudio) {
        window.emergencyAudio.speak("Emergency route active.", false);
      }
    }
  }

  renderPatientPickupMarkers() {
    this.pickupMarkersGroup.clearLayers();
    if (!this.patientPickups || this.patientPickups.length === 0) return;

    this.patientPickups.forEach((p, idx) => {
      const isBoarded = p.picked_up;
      const borderCol = isBoarded ? "#10B981" : (p.triage_level && p.triage_level.includes("RED") ? "#EF4444" : "#F59E0B");

      const iconHtml = `
        <div class="relative flex items-center justify-center">
          ${!isBoarded ? '<div class="absolute w-12 h-12 rounded-full border-2 border-amber-400 animate-ping opacity-60"></div>' : ''}
          <div class="w-10 h-10 rounded-full border-2 shadow-2xl flex items-center justify-center cursor-pointer transition hover:scale-110" style="border-color: ${borderCol}; background-color: #0F172A;">
            <span class="text-base">${isBoarded ? '✅' : '🩺'}</span>
          </div>
          <div class="absolute -bottom-2 px-1.5 py-0.2 rounded text-[8px] font-mono font-bold uppercase text-white shadow whitespace-nowrap" style="background-color: ${borderCol};">
            ${isBoarded ? 'ONBOARD' : `STOP ${idx + 1}`}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: "patient-pickup-marker",
        html: iconHtml,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      const m = L.marker([p.location.lat, p.location.lng], { icon: customIcon }).addTo(this.pickupMarkersGroup);

      m.bindPopup(`
        <div class="p-1 space-y-2">
          <div class="flex items-center gap-1.5">
            <span class="text-base">🩺</span>
            <div>
              <p class="font-bold text-white text-xs">${p.name}</p>
              <p class="text-[10px] font-bold" style="color: ${borderCol};">${p.triage_level}</p>
            </div>
          </div>
          ${p.condition_notes ? `<p class="text-[10px] text-slate-300 bg-slate-800 p-1 rounded font-medium">${p.condition_notes}</p>` : ''}
          <p class="text-[9px] text-slate-400 font-mono">${p.address || ''}</p>
          <button id="btn-pickup-mark-${p.id}" class="w-full py-1.5 px-2 rounded text-[11px] font-bold text-white transition ${isBoarded ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-amber-600 hover:bg-amber-500'}">
            ${isBoarded ? '✅ Patient Picked Up (Onboard)' : '🩺 Mark Patient Onboard'}
          </button>
        </div>
      `);

      m.on("popupopen", () => {
        const btn = document.getElementById(`btn-pickup-mark-${p.id}`);
        if (btn) {
          btn.onclick = () => {
            if (window.onPatientPickupToggled) {
              window.onPatientPickupToggled(p.id);
            }
          };
        }
      });
    });
  }

  async triggerEmergencyReroute(currentLocation, reportedBlock = null, reason = "Heavy Bottleneck / Incident") {
    if (!this.routeData) return;

    try {
      this.showLoadingOverlay(true, "🚨 CALCULATING EMERGENCY BYPASS...");
      window.emergencyAudio.playAlertAlarm();

      const apiBase = window.API_CONFIG ? window.API_CONFIG.baseUrl : "";
      const res = await fetch(`${apiBase}/api/reroute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_location: { lat: currentLocation.lat, lng: currentLocation.lng },
          destination: this.routeData.destination,
          destination_name: this.routeData.destination_name,
          reported_block_location: reportedBlock,
          reason: reason
        })
      });

      if (!res.ok) throw new Error("Reroute request failed");

      this.routeData = await res.json();
      this.renderCurrentRoute();
      this.updateHUDMetrics();
      this.showLoadingOverlay(false);

      // Flash emergency notification banner
      this.flashRerouteBanner(reason, this.routeData.time_saved_minutes);

    } catch (err) {
      console.error("Emergency reroute error:", err);
      this.showLoadingOverlay(false);
    }
  }

  setRouteType(type) {
    if (this.activeRouteType === type) return;
    this.activeRouteType = type;
    this.renderCurrentRoute();
    this.updateHUDMetrics();
  }

  clearRoute() {
    this.trafficLayerGroup.clearLayers();
    this.alternativeLayerGroup.clearLayers();
    this.incidentLayerGroup.clearLayers();
    this.pickupMarkersGroup.clearLayers();
    if (this.destinationMarker) {
      this.map.removeLayer(this.destinationMarker);
      this.destinationMarker = null;
    }
    this.routeData = null;
    this.activeManeuvers = [];
    this.currentManeuverIndex = 0;
    this.spokenStepIndices.clear();
    this.spokenTurnNowIndices.clear();

    const eta = document.getElementById("hud-eta");
    const dist = document.getElementById("hud-distance");
    const speed = document.getElementById("hud-avg-speed");
    const summary = document.getElementById("hud-traffic-summary");
    const timeSaved = document.getElementById("hud-time-saved-badge");
    const turnList = document.getElementById("turn-by-turn-list");
    const maneuverDist = document.getElementById("hud-maneuver-dist");
    const maneuverText = document.getElementById("hud-maneuver-text");
    const maneuverRoad = document.getElementById("hud-maneuver-road");

    if (eta) eta.textContent = "-- MIN";
    if (dist) dist.textContent = "-- KM";
    if (speed) speed.textContent = "-- km/h";
    if (summary) summary.textContent = "Standby Flow";
    if (timeSaved) timeSaved.classList.add("hidden");
    if (maneuverDist) maneuverDist.textContent = "STANDBY";
    if (maneuverText) maneuverText.textContent = "Select hospital or tap map";
    if (maneuverRoad) maneuverRoad.textContent = "Ready for Emergency Dispatch";
    if (turnList) {
      turnList.innerHTML = `
        <div class="py-6 text-center text-slate-500 text-xs">
          <p class="font-bold text-slate-400">No active navigation route.</p>
          <p class="text-[11px] mt-1">Select a hospital or click anywhere on map to route.</p>
        </div>
      `;
    }
  }

  renderCurrentRoute() {
    if (!this.routeData) return;

    this.trafficLayerGroup.clearLayers();
    this.alternativeLayerGroup.clearLayers();
    this.incidentLayerGroup.clearLayers();

    const primary = this.activeRouteType === "fastest_traffic"
      ? this.routeData.recommended_route
      : (this.routeData.alternative_route || this.routeData.recommended_route);

    const alternative = this.activeRouteType === "fastest_traffic"
      ? this.routeData.alternative_route
      : this.routeData.recommended_route;

    // 1. Render Alternative (Inactive) Route as subtle translucent dashed line
    if (alternative && alternative.polyline_geojson) {
      const altCoords = alternative.polyline_geojson.coordinates.map(c => [c[1], c[0]]);
      L.polyline(altCoords, {
        color: "#64748B",
        weight: 6,
        opacity: 0.45,
        dashArray: "8, 12",
        lineCap: "round",
        lineJoin: "round"
      }).addTo(this.alternativeLayerGroup);
    }

    // 2. Render Primary Route with Dynamic Traffic Segments
    // Base shadow glow layer
    const allCoords = primary.polyline_geojson.coordinates.map(c => [c[1], c[0]]);
    L.polyline(allCoords, {
      color: "#0F172A",
      weight: 12,
      opacity: 0.9,
      lineCap: "round"
    }).addTo(this.trafficLayerGroup);

    // Colored traffic segments
    if (primary.traffic_segments && primary.traffic_segments.length > 0) {
      primary.traffic_segments.forEach(seg => {
        const segLine = L.polyline(seg.coordinates, {
          color: seg.color,
          weight: 7,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round"
        });

        // Hover tooltip on segment
        segLine.bindTooltip(`
          <div class="text-xs p-1">
            <span class="font-bold uppercase tracking-wider">${seg.congestion_level}</span>: ${seg.speed_kmh} km/h
            ${seg.delay_seconds > 0 ? `<br><span class="text-amber-400">+${Math.round(seg.delay_seconds)}s traffic delay</span>` : ''}
          </div>
        `, { sticky: true, className: 'leaflet-dark-tooltip' });

        segLine.addTo(this.trafficLayerGroup);
      });
    } else {
      // Fallback single line
      L.polyline(allCoords, {
        color: "#10B981",
        weight: 7,
        opacity: 0.9
      }).addTo(this.trafficLayerGroup);
    }

    // 3. Render Incidents / Roadblocks
    if (this.routeData.active_incidents) {
      this.routeData.active_incidents.forEach(inc => {
        const hazardIcon = L.divIcon({
          className: "custom-hazard-marker",
          html: `
            <div class="flex items-center justify-center w-8 h-8 rounded-full bg-red-600 border-2 border-white shadow-lg animate-pulse">
              <span class="text-white text-xs font-black">⚠</span>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });
        L.marker([inc.lat, inc.lng], { icon: hazardIcon })
          .bindPopup(`<b class="text-red-400">Incident Reported</b><br>${inc.type}`)
          .addTo(this.incidentLayerGroup);
      });
    }

    // Fit map bounds smoothly
    if (allCoords.length > 0) {
      this.map.fitBounds(L.latLngBounds(allCoords), {
        paddingTopLeft: [80, 80],
        paddingBottomRight: [80, 80],
        maxZoom: 16
      });
    }
  }

  updateHUDMetrics() {
    if (!this.routeData) return;

    const current = this.activeRouteType === "fastest_traffic"
      ? this.routeData.recommended_route
      : (this.routeData.alternative_route || this.routeData.recommended_route);

    // Update ETA and Distance
    const etaElem = document.getElementById("hud-eta");
    const distElem = document.getElementById("hud-distance");
    const speedAvgElem = document.getElementById("hud-avg-speed");
    const trafficSummaryElem = document.getElementById("hud-traffic-summary");
    const timeSavedBadge = document.getElementById("hud-time-saved-badge");
    const routeTypeBtnFast = document.getElementById("btn-route-fastest");
    const routeTypeBtnShort = document.getElementById("btn-route-shortest");

    if (etaElem) etaElem.textContent = `${Math.round(current.total_duration_minutes)} MIN`;
    if (distElem) distElem.textContent = `${current.total_distance_km.toFixed(1)} KM`;
    if (speedAvgElem) speedAvgElem.textContent = `${Math.round(current.average_speed_kmh)} km/h`;
    if (trafficSummaryElem) trafficSummaryElem.textContent = current.congestion_summary;

    if (timeSavedBadge) {
      if (this.activeRouteType === "fastest_traffic" && this.routeData.time_saved_minutes > 0) {
        timeSavedBadge.textContent = `⚡ SAVES ${this.routeData.time_saved_minutes} MIN`;
        timeSavedBadge.classList.remove("hidden");
      } else {
        timeSavedBadge.classList.add("hidden");
      }
    }

    // Button active states
    if (routeTypeBtnFast && routeTypeBtnShort) {
      if (this.activeRouteType === "fastest_traffic") {
        routeTypeBtnFast.classList.add("bg-emerald-600", "text-white", "shadow-lg");
        routeTypeBtnFast.classList.remove("bg-slate-800", "text-slate-400");
        routeTypeBtnShort.classList.remove("bg-emerald-600", "text-white");
        routeTypeBtnShort.classList.add("bg-slate-800", "text-slate-400");
      } else {
        routeTypeBtnShort.classList.add("bg-cyan-600", "text-white", "shadow-lg");
        routeTypeBtnShort.classList.remove("bg-slate-800", "text-slate-400");
        routeTypeBtnFast.classList.remove("bg-emerald-600", "text-white");
        routeTypeBtnFast.classList.add("bg-slate-800", "text-slate-400");
      }
    }

    // Next Maneuver HUD banner and active maneuvers list
    this.activeManeuvers = current.turn_by_turn || [];
    this.currentManeuverIndex = 0;
    this.spokenStepIndices.clear();
    this.spokenTurnNowIndices.clear();

    this.updateNextManeuverHUD(this.activeManeuvers);
    this.renderTurnByTurnDrawer(this.activeManeuvers);
  }

  onVehicleProgress(vehiclePos, speed = 0, heading = 0) {
    if (!this.activeManeuvers || this.activeManeuvers.length === 0) return;
    if (this.currentManeuverIndex >= this.activeManeuvers.length) return;

    const currentStep = this.activeManeuvers[this.currentManeuverIndex];
    if (!currentStep) return;

    // Calculate distance to this step coordinate
    let distM = 0;
    if (currentStep.location && currentStep.location.lat && currentStep.location.lng) {
      distM = this.haversineMeters(vehiclePos.lat, vehiclePos.lng, currentStep.location.lat, currentStep.location.lng);
    } else {
      distM = currentStep.distance_meters || 0;
    }

    // Advance step if vehicle is close or passed (< 30m)
    if (distM < 30 && this.currentManeuverIndex < this.activeManeuvers.length - 1) {
      this.currentManeuverIndex++;
      const nextActiveSteps = this.activeManeuvers.slice(this.currentManeuverIndex);
      this.renderTurnByTurnDrawer(nextActiveSteps);
      this.updateNextManeuverHUD(nextActiveSteps);
      return;
    }

    // Live update Next Maneuver HUD distances
    const distElem = document.getElementById("hud-maneuver-dist");
    const textElem = document.getElementById("hud-maneuver-text");
    const roadElem = document.getElementById("hud-maneuver-road");

    if (distElem) distElem.textContent = distM >= 1000 ? `IN ${(distM/1000).toFixed(1)} KM` : `IN ${Math.round(distM)} M`;
    if (textElem) textElem.textContent = currentStep.instruction;
    if (roadElem) roadElem.textContent = currentStep.road_name || "Emergency Access Road";

    // Dynamic Turn-by-Turn Spoken Navigation
    if (window.emergencyAudio && window.emergencyAudio.voiceEnabled) {
      // 1. Advance warning prompt at 150m - 240m
      if (distM <= 220 && distM > 45 && !this.spokenStepIndices.has(this.currentManeuverIndex)) {
        this.spokenStepIndices.add(this.currentManeuverIndex);
        const spokenDist = Math.max(50, Math.round(distM / 20) * 20);
        window.emergencyAudio.speak(`In ${spokenDist} meters, ${currentStep.instruction}`, false, true);
      }
      // 2. Immediate prompt when executing turn / stop (< 45m)
      else if (distM <= 45 && !this.spokenTurnNowIndices.has(this.currentManeuverIndex)) {
        this.spokenTurnNowIndices.add(this.currentManeuverIndex);
        if (currentStep.instruction.includes("Stop") || currentStep.instruction.includes("Patient") || currentStep.instruction.includes("OP") || currentStep.instruction.includes("Arrive")) {
          window.emergencyAudio.speak(currentStep.instruction, true, true);
        } else {
          window.emergencyAudio.speak(`${currentStep.instruction} now`, false);
        }
      }
    }
  }

  haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  updateNextManeuverHUD(maneuvers) {
    const iconContainer = document.getElementById("hud-maneuver-icon");
    const textElem = document.getElementById("hud-maneuver-text");
    const distElem = document.getElementById("hud-maneuver-dist");
    const roadElem = document.getElementById("hud-maneuver-road");

    if (!maneuvers || maneuvers.length === 0) return;
    const nextStep = maneuvers[0];

    if (distElem) distElem.textContent = `IN ${Math.round(nextStep.distance_meters)} M`;
    if (textElem) textElem.textContent = nextStep.instruction;
    if (roadElem) roadElem.textContent = nextStep.road_name || "Emergency Access Road";

    if (iconContainer) {
      let iconType = "straight";
      if (nextStep.instruction && (nextStep.instruction.includes("Patient Pickup") || nextStep.instruction.includes("Stop") || nextStep.instruction.includes("OP"))) iconType = "pickup";
      else if (nextStep.type.includes("depart")) iconType = "depart";
      else if (nextStep.type.includes("arrive")) iconType = "arrive";
      else if (nextStep.modifier && nextStep.modifier.includes("left")) iconType = "turn-left";
      else if (nextStep.modifier && nextStep.modifier.includes("right")) iconType = "turn-right";
      else if (nextStep.type.includes("fork")) iconType = "fork";
      else if (nextStep.type.includes("roundabout")) iconType = "roundabout";

      iconContainer.innerHTML = this.maneuverIcons[iconType] || this.maneuverIcons["straight"];
    }
  }

  renderTurnByTurnDrawer(maneuvers) {
    const listElem = document.getElementById("turn-by-turn-list");
    if (!listElem) return;

    listElem.innerHTML = "";
    if (!maneuvers || maneuvers.length === 0) {
      listElem.innerHTML = `<p class="text-sm text-slate-500 py-4 text-center">No steps available</p>`;
      return;
    }

    maneuvers.forEach((step, idx) => {
      const stepDiv = document.createElement("div");
      stepDiv.className = `flex items-center gap-3 p-3 rounded-xl transition border ${idx === 0 ? 'bg-slate-800/90 border-emerald-500/50' : 'bg-slate-900/60 border-slate-800/50 hover:bg-slate-800/50'}`;
      
      let stepIcon = this.maneuverIcons["straight"];
      if (step.type.includes("arrive")) stepIcon = this.maneuverIcons["arrive"];
      else if (step.modifier && step.modifier.includes("left")) stepIcon = this.maneuverIcons["turn-left"];
      else if (step.modifier && step.modifier.includes("right")) stepIcon = this.maneuverIcons["turn-right"];

      stepDiv.innerHTML = `
        <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
          ${stepIcon}
        </div>
        <div class="flex-grow min-w-0">
          <p class="text-sm font-semibold text-slate-100 truncate">${step.instruction}</p>
          <p class="text-xs text-slate-400 truncate">${step.road_name}</p>
        </div>
        <div class="flex-shrink-0 text-right">
          <span class="text-xs font-mono font-bold text-emerald-400">${Math.round(step.distance_meters)}m</span>
        </div>
      `;
      listElem.appendChild(stepDiv);
    });
  }

  updateDestinationMarker(destination, name) {
    if (this.destinationMarker) {
      this.map.removeLayer(this.destinationMarker);
    }

    const destIcon = L.divIcon({
      className: "hospital-marker-container",
      html: `
        <div class="hospital-marker-icon">
          <svg class="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
          </svg>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    this.destinationMarker = L.marker([destination.lat, destination.lng], { icon: destIcon })
      .bindPopup(`<b class="text-emerald-400 text-sm">${name}</b><br><span class="text-xs text-slate-300">Emergency Target Destination</span>`)
      .addTo(this.map);
  }

  showLoadingOverlay(show, message = "Computing Fastest Route...") {
    const overlay = document.getElementById("route-loading-overlay");
    const msgElem = document.getElementById("route-loading-message");
    if (!overlay) return;

    if (this._overlayTimeout) {
      clearTimeout(this._overlayTimeout);
      this._overlayTimeout = null;
    }

    if (show) {
      if (msgElem) msgElem.textContent = message;
      overlay.classList.remove("hidden");
      // Auto-dismiss safety timer so UI never gets stuck
      this._overlayTimeout = setTimeout(() => {
        overlay.classList.add("hidden");
      }, 3500);
    } else {
      overlay.classList.add("hidden");
    }
  }

  flashRerouteBanner(reason, timeSaved) {
    const banner = document.getElementById("reroute-alert-banner");
    const reasonElem = document.getElementById("reroute-reason-text");
    const savedElem = document.getElementById("reroute-saved-text");
    if (!banner) return;

    if (reasonElem) reasonElem.textContent = reason;
    if (savedElem) savedElem.textContent = `Bypass estimated to save ${timeSaved || 3.5} mins`;

    banner.classList.remove("hidden");
    banner.classList.add("animate-bounce");

    setTimeout(() => {
      banner.classList.remove("animate-bounce");
    }, 2000);

    setTimeout(() => {
      banner.classList.add("hidden");
    }, 7000);
  }
}

window.RouteRenderer = RouteRenderer;
