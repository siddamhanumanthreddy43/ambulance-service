# AMBU-ROUTEX: Emergency Ambulance Smart Routing & Telemetry HUD

> **High-Performance Emergency Response System**: A full-stack real-time emergency routing application designed for ambulance drivers to navigate the fastest, lowest-congestion route to medical trauma centers, featuring map-click destination picking, live GPS telemetry streaming via WebSockets, and dynamic traffic-aware shortest-path rerouting.

---

## 1. Architecture Overview

### High-Level System Architecture
```
                                 +-------------------------------------------------+
                                 |         Leaflet.js + Tailwind CSS HUD           |
                                 |  - High-Contrast Night Mode Driver Display      |
                                 |  - Dynamic Traffic Polylines (Green/Amber/Red)  |
                                 |  - Map-Click Destination Picking                |
                                 |  - Turn-by-Turn Maneuver Banners                |
                                 |  - Web Audio API Dual-Tone Emergency Siren      |
                                 +-----------------------+-------------------------+
                                                         ^
                                                         | (HTTP REST + WebSockets)
                                                         v
+-------------------------------------------------------------------------------------------------------+
|                                    Python FastAPI Backend                                             |
|                                                                                                       |
|  +---------------------------+  +-------------------------------+  +-------------------------------+  |
|  |     Routing Engine        |  |     Hospital Directory        |  |     Telemetry Manager         |  |
|  | - OSRM Routing Proxy      |  | - Pre-loaded Trauma Centers    |  | - WebSocket Broadcast Room    |  |
|  | - Dynamic Congestion Model|  | - ER / ICU Bed Availability   |  | - Sub-100ms GPS Relaying      |  |
|  | - Fastest vs Shortest Path|  | - Geographic Proximity Sort   |  | - Real-time Speed & Heading   |  |
|  | - Emergency Reroute Engine|  | - Dynamic Regional Fallback   |  | - Siren & Incident Alerts     |  |
|  +---------------------------+  +-------------------------------+  +-------------------------------+  |
+-------------------------------------------------------------------------------------------------------+
                                                         ^
                                                         |
                           +-----------------------------+-----------------------------+
                           |                                                           |
                           v                                                           v
            +-------------------------------+                           +-------------------------------+
            |      Browser Geolocation      |                           |     Python Mock GPS Driver    |
            | navigator.geolocation.watch() |                           |      (`mock_driver.py`)       |
            | Real Ambulance Mobile/Tablet  |                           | Simulated IoT Telemetry Stream|
            +-------------------------------+                           +-------------------------------+
```

---

## 2. Project Folder Structure

```
ambulance/
├── app/
│   ├── __init__.py          # Package initialization
│   ├── main.py              # FastAPI application, REST endpoints, and WebSocket manager
│   ├── models.py            # Pydantic data schemas (Routes, Hospitals, Telemetry, Packets)
│   ├── hospitals.py         # Curated trauma centers, bed capacity, and proximity calculations
│   └── routing.py           # Traffic congestion modeling, OSRM routing, and reroute engine
├── static/
│   ├── css/
│   │   └── style.css        # Driver HUD high-contrast styling, strobe lights, and radar pulses
│   ├── js/
│   │   ├── app.js           # UI coordinator, Leaflet initialization, hospital selection
│   │   ├── routing.js       # Dynamic route rendering, traffic segment coloring, turn-by-turn HUD
│   │   ├── telemetry.js     # WebSocket streaming, GPS tracking, and in-browser simulator
│   │   └── audio.js         # Web Audio API emergency siren (wail/yelp) and alert synthesizer
│   └── index.html           # Driver-centric night-mode HUD interface
├── mock_driver.py           # Standalone Python script simulating IoT GPS vehicle telemetry
├── requirements.txt         # Project dependencies
├── run.py                   # Development runner script
└── README.md                # Documentation and architecture guide
```

---

## 3. Core Features

### 1. Interactive Map & Hospital Selection
- **Leaflet.js & CartoDB Dark Matter**: Ultra-high-contrast night theme tailored for driver visibility in emergency vehicle mounts.
- **Hospital Directory**: Pre-loaded Level 1 Trauma Centers, Cardiac Emergency Hubs, and Pediatric Care Centers with live ER and ICU bed occupancy.
- **Map-Click Destination Picking**: Click anywhere directly on the map to place a custom emergency triage target; the engine immediately computes the optimal route.

### 2. Dynamic Traffic-Aware Routing Engine
- **Two Distinct Metrics**: Computes and contrasts both:
  1. **Fastest Route (Traffic-Aware)**: Re-weights speeds across corridors, prioritizing highway expressways and emergency priority lanes to avoid downtown gridlock.
  2. **Shortest Route (Geographic)**: The strictly shortest physical distance in meters, illustrating congestion penalties and time saved.
- **Segmented Traffic Polylines**: The calculated route is segmented and color-coded on the map:
  - 🟢 **Emerald Green (`#10B981`)**: Free-flow traffic (>50 km/h).
  - 🟡 **Amber Orange (`#F59E0B`)**: Moderate congestion (25–45 km/h).
  - 🔴 **Crimson Red (`#EF4444`)**: Severe bottleneck (8–20 km/h).
  - 🛑 **Deep Maroon (`#7F1D1D`)**: Reported roadblock / standstill accident.
- **Turn-by-Turn Guidance**: Prominent top-left HUD banner showing upcoming maneuvers (`IN 250 M`, `Turn Right onto Lincoln Expressway`), street names, and a full turn list.

### 3. Live Ambulance GPS Tracking
- **Real-Time Telemetry Layer**: WebSocket (`/ws/ambulance`) relays continuous updates (latitude, longitude, speed in km/h, heading bearing in degrees, siren status) with sub-100ms latency.
- **Dual Telemetry Modes**:
  - **Browser Geolocation API**: Live tracking via `navigator.geolocation.watchPosition` for physical in-vehicle tablets and mobile devices.
  - **Smooth Driving Simulation**: Built-in physics engine animating vehicle movement along the calculated polyline with realistic acceleration, curve deceleration, and heading rotation.
  - **Python Mock Script (`mock_driver.py`)**: External terminal script simulating an ambulance IoT tracking box streaming telemetry directly into the backend.

### 4. Driver-Centric UI/UX
- **Night-Mode OLED HUD**: Deep black palette (`#070B14`) preventing driver glare during nighttime emergency runs.
- **Prominent "EMERGENCY: REROUTE" Button**: Pulsing red button allowing the driver to instantly compute an emergency detour avoiding road hazards.
- **Web Audio Siren Synthesizer**: Self-contained dual-tone emergency siren (wail/yelp) and turn alert chime without requiring external audio files.

---

## 4. Setup & Running Instructions

### Prerequisites
- Python 3.10+ (Tested on Python 3.13)
- Modern web browser (Chrome, Edge, Firefox, Safari)

### Step 1: Install Dependencies
```bash
cd ambulance
pip install -r requirements.txt
```

### Step 2: Start the FastAPI Backend
```bash
python run.py
```
*(Or alternatively: `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`)*

The server will be available at:
👉 **`http://localhost:8000`**

### Step 3: Open the Emergency Driver HUD
Open your browser and navigate to:
```
http://localhost:8000/
```

---

## 5. Testing the Key Features

1. **Hospital Selection**:
   - Select any hospital from the top dropdown or the left quick-cards.
   - Watch the route render dynamically with green, yellow, and red traffic segments.
2. **Map-Click Custom Destination**:
   - Click anywhere on the map to set an ad-hoc emergency rendezvous or triage point.
   - The system immediately calculates and plots the fastest route.
3. **Compare Fastest vs. Shortest Route**:
   - Toggle between **"⚡ Fastest Route"** and **"📏 Shortest Route"**.
   - Notice the time saved badge and comparative traffic delay breakdown.
4. **Emergency Reroute**:
   - Press the glowing red **"EMERGENCY: REROUTE NOW"** button.
   - The engine injects a simulated obstacle ahead on the current route and re-computes an optimal bypass with an alert chime.
5. **Start Vehicle Movement Simulation**:
   - Click **"▶ Simulate Drive"** on the bottom control bar.
   - Watch the ambulance vehicle icon smoothly move along the route with animated radar rings, real-time heading rotation, and live speedometer readouts.
6. **External Python IoT Mock Driver**:
   - Open a second terminal window and run:
     ```bash
     python mock_driver.py
     ```
   - Watch the vehicle stream telemetry live into the browser dashboard via WebSockets.
