/**
 * Emergency Ambulance Telemetry & GPS Tracking Engine
 * Manages WebSocket streaming, device GPS tracking, realistic vehicle simulation,
 * and animated moving ambulance icon on the Leaflet map.
 */

class TelemetryManager {
  constructor(map, onPositionUpdateCallback) {
    this.map = map;
    this.onPositionUpdateCallback = onPositionUpdateCallback;
    this.ws = null;
    this.reconnectTimer = null;
    
    // Ambulance state
    this.ambulanceId = "AMB-042";
    this.currentPosition = { lat: 12.9716, lng: 77.5946 };
    this.currentSpeed = 0.0;
    this.currentHeading = 0.0;
    this.sirenActive = true;
    
    // Map Marker
    this.ambulanceMarker = null;
    this.accuracyCircle = null;
    this.initAmbulanceMarker();

    // Tracking Modes
    this.trackingMode = "SIMULATION"; // "SIMULATION" or "DEVICE_GPS" or "MOCK_BACKEND"
    this.geolocationWatchId = null;
    this.liveGpsActive = false;
    
    // Simulation state
    this.simulationRunning = false;
    this.simulationTimer = null;
    this.activeWaypoints = [];
    this.simWaypointIndex = 0;

    // Connect to WebSocket
    this.connectWebSocket();
  }

  initAmbulanceMarker() {
    const ambulanceIcon = L.divIcon({
      className: "ambulance-marker-container",
      html: `
        <div class="radar-ring-red"></div>
        <div id="ambulance-icon-inner" class="ambulance-icon-body" style="transform: rotate(0deg);">
          <svg class="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="currentColor">
            <!-- Sleek Ambulance Vehicle Top-Down Silhouette -->
            <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.22.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.77l.11.34V17z"/>
            <!-- Emergency Cross on roof -->
            <path fill="#FFFFFF" d="M11 11h2v2h2v2h-2v2h-2v-2H9v-2h2z"/>
          </svg>
        </div>
      `,
      iconSize: [52, 52],
      iconAnchor: [26, 26]
    });

    this.ambulanceMarker = L.marker([this.currentPosition.lat, this.currentPosition.lng], {
      icon: ambulanceIcon,
      zIndexOffset: 1000
    }).addTo(this.map);
  }

  connectWebSocket() {
    const wsUrl = window.API_CONFIG
      ? window.API_CONFIG.wsUrl
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/ambulance`;

    console.log(`Connecting to Telemetry WebSocket: ${wsUrl}`);
    const badge = document.getElementById("ws-status-badge");
    const indicator = document.getElementById("ws-status-indicator");

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("Telemetry WebSocket connected.");
        if (badge) badge.textContent = "ONLINE (LIVE STREAM)";
        if (indicator) {
          indicator.classList.remove("bg-red-500", "bg-amber-500");
          indicator.classList.add("bg-emerald-500");
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handleIncomingPacket(packet);
        } catch (e) {
          console.warn("Invalid telemetry packet:", e);
        }
      };

      this.ws.onclose = () => {
        console.warn("WebSocket closed. Retrying in 3 seconds...");
        if (badge) badge.textContent = "DISCONNECTED (RETRYING)";
        if (indicator) {
          indicator.classList.remove("bg-emerald-500");
          indicator.classList.add("bg-red-500");
        }
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 3000);
      };

      this.ws.onerror = (err) => {
        console.error("WebSocket error:", err);
      };

    } catch (err) {
      console.error("Could not initialize WebSocket:", err);
    }
  }

  handleIncomingPacket(packet) {
    if (packet.type === "telemetry_update" || packet.type === "initial_state") {
      const data = packet.telemetry;
      if (!data) return;

      // Update position on map if not actively simulating locally
      if (!this.simulationRunning) {
        this.updatePosition(
          data.lat,
          data.lng,
          data.speed_kmh,
          data.heading_degrees,
          false // do not echo back to ws
        );
      }
    } else if (packet.type === "emergency_alert") {
      console.log("Emergency Alert:", packet.message);
      // Play alarm chime
      window.emergencyAudio.playAlertAlarm();
    }
  }

  sendTelemetryUpdate(lat, lng, speed, heading) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      type: "telemetry",
      ambulance_id: this.ambulanceId,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      speed_kmh: Number(speed.toFixed(1)),
      heading_degrees: Number(heading.toFixed(1)),
      status: "EN_ROUTE_CODE_3",
      siren_active: this.sirenActive,
      timestamp: Date.now() / 1000
    };

    this.ws.send(JSON.stringify(payload));
  }

  updatePosition(lat, lng, speed = 0, heading = 0, shouldBroadcast = true, accuracy = null) {
    this.currentPosition = { lat, lng };
    this.currentSpeed = speed;
    this.currentHeading = heading;

    // 1. Move Leaflet Marker smoothly
    if (this.ambulanceMarker) {
      this.ambulanceMarker.setLatLng([lat, lng]);
      const iconElem = document.getElementById("ambulance-icon-inner");
      if (iconElem) {
        iconElem.style.transform = `rotate(${heading}deg)`;
      }
    }

    // 1b. Update Accuracy Circle if live GPS active
    if (this.liveGpsActive && accuracy && accuracy < 2000) {
      if (!this.accuracyCircle) {
        this.accuracyCircle = L.circle([lat, lng], {
          radius: accuracy,
          color: "#10B981",
          weight: 1.5,
          opacity: 0.6,
          fillColor: "#10B981",
          fillOpacity: 0.12
        }).addTo(this.map);
      } else {
        this.accuracyCircle.setLatLng([lat, lng]);
        this.accuracyCircle.setRadius(accuracy);
      }
    } else if (this.accuracyCircle && !this.liveGpsActive) {
      this.map.removeLayer(this.accuracyCircle);
      this.accuracyCircle = null;
    }

    // 2. Update HUD Speedometer & Heading & Lat/Lng
    const speedGauge = document.getElementById("hud-speed-gauge");
    const headingGauge = document.getElementById("hud-heading-gauge");
    const latLngBadge = document.getElementById("hud-coords-badge");

    if (speedGauge) speedGauge.textContent = Math.round(speed);
    if (headingGauge) headingGauge.textContent = `${Math.round(heading)}°`;
    if (latLngBadge) latLngBadge.textContent = `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`;

    // 3. Broadcast to WebSocket
    if (shouldBroadcast) {
      this.sendTelemetryUpdate(lat, lng, speed, heading);
    }

    // Notify listeners
    if (this.onPositionUpdateCallback) {
      this.onPositionUpdateCallback(this.currentPosition, speed, heading);
    }
  }

  // --- AUTOMATIC LIVE LOCATION DETECTION ON STARTUP ---
  acquireInitialLiveLocation(onSuccess, onError) {
    if (!navigator.geolocation) {
      if (onError) onError(new Error("Geolocation not supported by browser."));
      return;
    }

    console.log("📍 Acquiring initial live GPS location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy || 15;
        const speedKmh = pos.coords.speed ? (pos.coords.speed * 3.6) : 0;
        const heading = pos.coords.heading || 0;

        console.log(`✅ Live GPS acquired: ${lat.toFixed(4)}, ${lng.toFixed(4)} (Accuracy: ${Math.round(accuracy)}m)`);
        
        this.liveGpsActive = true;
        this.trackingMode = "DEVICE_GPS";
        this.updatePosition(lat, lng, speedKmh, heading, true, accuracy);
        this.startDeviceGeolocation();

        if (onSuccess) onSuccess({ lat, lng, accuracy });
      },
      (err) => {
        console.warn("Could not acquire initial GPS (user may have denied or timed out):", err.message);
        if (onError) onError(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 9000,
        maximumAge: 120000
      }
    );
  }

  // --- DEVICE GEOLOCATION API (watchPosition) ---
  startDeviceGeolocation() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    this.stopSimulation();
    this.trackingMode = "DEVICE_GPS";
    this.liveGpsActive = true;

    // Update UI Indicators
    const btnSim = document.getElementById("btn-toggle-sim");
    const btnGps = document.getElementById("btn-toggle-gps");
    const gpsIndicator = document.getElementById("hud-gps-indicator");
    const gpsDot = document.getElementById("hud-gps-dot");
    const gpsText = document.getElementById("hud-gps-text");

    if (btnGps) {
      btnGps.classList.add("bg-emerald-600", "text-white");
      btnGps.classList.remove("bg-slate-800", "text-slate-300");
    }
    if (btnSim) {
      btnSim.classList.remove("bg-emerald-600", "text-white");
      btnSim.classList.add("bg-slate-800", "text-slate-300");
    }
    if (gpsIndicator) {
      gpsIndicator.className = "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700/60";
    }
    if (gpsDot) {
      gpsDot.className = "w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse";
    }
    if (gpsText) {
      gpsText.textContent = "LIVE GPS LOCK";
    }

    if (this.geolocationWatchId !== null) {
      navigator.geolocation.clearWatch(this.geolocationWatchId);
    }

    this.geolocationWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy || 20;
        const speedKmh = pos.coords.speed ? (pos.coords.speed * 3.6) : 0;
        const heading = pos.coords.heading || this.currentHeading;

        this.updatePosition(lat, lng, speedKmh, heading, true, accuracy);
        this.map.panTo([lat, lng], { animate: true, duration: 0.8 });
      },
      (err) => {
        console.warn("Geolocation watch error:", err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000
      }
    );
  }

  stopDeviceGeolocation() {
    this.liveGpsActive = false;
    if (this.geolocationWatchId !== null) {
      navigator.geolocation.clearWatch(this.geolocationWatchId);
      this.geolocationWatchId = null;
    }

    if (this.accuracyCircle) {
      this.map.removeLayer(this.accuracyCircle);
      this.accuracyCircle = null;
    }

    const btnGps = document.getElementById("btn-toggle-gps");
    const gpsIndicator = document.getElementById("hud-gps-indicator");
    const gpsDot = document.getElementById("hud-gps-dot");
    const gpsText = document.getElementById("hud-gps-text");

    if (btnGps) {
      btnGps.classList.remove("bg-emerald-600", "text-white");
      btnGps.classList.add("bg-slate-800", "text-slate-300");
    }
    if (gpsIndicator) {
      gpsIndicator.className = "inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold font-mono bg-slate-800 text-slate-400 border border-slate-700";
    }
    if (gpsDot) {
      gpsDot.className = "w-1.5 h-1.5 rounded-full bg-slate-500";
    }
    if (gpsText) {
      gpsText.textContent = "STANDBY GPS";
    }
  }

  // --- REALISTIC DRIVER SIMULATION ENGINE ---
  startSimulationAlongRoute(routeCoordinates) {
    if (!routeCoordinates || routeCoordinates.length < 2) {
      alert("Please calculate a route first before starting simulation.");
      return;
    }

    this.stopDeviceGeolocation();
    this.stopSimulation();

    this.trackingMode = "SIMULATION";
    this.simulationRunning = true;
    this.activeWaypoints = routeCoordinates;
    this.simWaypointIndex = 0;
    this.isPausedForPickup = false;

    const btnSim = document.getElementById("btn-toggle-sim");
    if (btnSim) {
      btnSim.innerHTML = `
        <svg class="w-5 h-5 text-red-400 animate-pulse" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd"></path></svg>
        <span>Stop Sim</span>
      `;
      btnSim.classList.add("bg-red-600/80", "text-white");
      btnSim.classList.remove("bg-slate-800", "text-slate-300");
    }

    // Move to start
    const startPt = this.activeWaypoints[0];
    this.updatePosition(startPt[0], startPt[1], 55.0, 0.0, true);

    const stepIntervalMs = 400; // Update every 400ms
    let curSubStep = 0;
    let totalSubSteps = 5;
    let p1 = this.activeWaypoints[0];
    let p2 = this.activeWaypoints[1];

    this.simulationTimer = setInterval(() => {
      if (this.simWaypointIndex >= this.activeWaypoints.length - 1) {
        // Arrived at destination
        this.stopSimulation();
        this.updatePosition(
          this.activeWaypoints[this.activeWaypoints.length - 1][0],
          this.activeWaypoints[this.activeWaypoints.length - 1][1],
          0.0,
          this.currentHeading,
          true
        );
        window.emergencyAudio.playTurnChime();
        alert("🏁 AMBULANCE 042: ARRIVED AT DESTINATION EMERGENCY ENTRANCE!");
        return;
      }

      // Check if temporarily paused for patient boarding
      if (this.isPausedForPickup) {
        return;
      }

      curSubStep++;
      if (curSubStep >= totalSubSteps) {
        // Advance to next waypoint
        this.simWaypointIndex++;
        if (this.simWaypointIndex >= this.activeWaypoints.length - 1) return;

        p1 = this.activeWaypoints[this.simWaypointIndex];
        p2 = this.activeWaypoints[this.simWaypointIndex + 1];

        const distM = this.haversineMeters(p1[0], p1[1], p2[0], p2[1]);
        // Speed simulation: fast on long stretches, slower on sharp turns
        let speedKmh = 68.0;
        if (distM < 30) speedKmh = 38.0;
        else if (distM > 120) speedKmh = 76.0;

        totalSubSteps = Math.max(2, Math.round((distM / (speedKmh / 3.6)) / (stepIntervalMs / 1000)));
        curSubStep = 0;
      }

      const alpha = curSubStep / totalSubSteps;
      const interpLat = p1[0] + (p2[0] - p1[0]) * alpha;
      const interpLng = p1[1] + (p2[1] - p1[1]) * alpha;
      const heading = this.calculateBearing(p1[0], p1[1], p2[0], p2[1]);

      // Calculate simulated speed with natural variance
      const currentSimSpeed = 50.0 + Math.sin(curSubStep) * 12.0;

      this.updatePosition(interpLat, interpLng, currentSimSpeed, heading, true);

      // Auto-pan map smoothly to follow ambulance
      if (this.simWaypointIndex % 4 === 0 && curSubStep === 1) {
        this.map.panTo([interpLat, interpLng], { animate: true, duration: 0.6 });
      }

    }, stepIntervalMs);
  }

  updateActiveRouteDuringSimulation(newRouteCoordinates) {
    if (!newRouteCoordinates || newRouteCoordinates.length < 2) return;
    this.activeWaypoints = newRouteCoordinates;
    this.simWaypointIndex = 0;
    console.log("🔄 Dynamic en-route simulation waypoints updated seamlessly. Stops remaining:", newRouteCoordinates.length);
  }

  pauseForPatientBoarding(durationMs = 3500, onComplete = null) {
    if (this.isPausedForPickup) return;
    this.isPausedForPickup = true;
    this.currentSpeed = 0;
    const speedGauge = document.getElementById("hud-speed-gauge");
    if (speedGauge) speedGauge.textContent = "0";

    setTimeout(() => {
      this.isPausedForPickup = false;
      if (onComplete) onComplete();
    }, durationMs);
  }

  stopSimulation() {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
    this.simulationRunning = false;

    const btnSim = document.getElementById("btn-toggle-sim");
    if (btnSim) {
      btnSim.innerHTML = `
        <svg class="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
        <span>Simulate Drive</span>
      `;
      btnSim.classList.remove("bg-red-600/80", "text-white");
      btnSim.classList.add("bg-slate-800", "text-slate-300");
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

  calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }
}

window.TelemetryManager = TelemetryManager;
