"""
Emergency Ambulance GPS Mock Telemetry Driver
Simulates realistic GPS movement along the calculated route and streams telemetry to the WebSocket backend.
"""

import asyncio
import json
import math
import time
import sys
import httpx
import websockets

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

BACKEND_HTTP = "http://localhost:8000"
BACKEND_WS = "ws://localhost:8000/ws/ambulance"


def calculate_bearing(lat1, lon1, lat2, lon2):
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - \
        math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

async def run_mock_simulation():
    print("🚑 [AMBULANCE TELEMETRY IOT SIMULATOR]")
    print(f"Connecting to Backend: {BACKEND_HTTP}...")

    # 1. Fetch initial ambulance route to first hospital
    origin = {"lat": 12.9716, "lng": 77.5946}
    dest = {"lat": 12.9344, "lng": 77.6192} # St. John's Super-Specialty Medical Institute

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            print("Requesting route from server...")
            resp = await client.post(f"{BACKEND_HTTP}/api/route", json={
                "origin": origin,
                "destination": dest,
                "destination_name": "St. John's Super-Specialty Medical Institute"
            })
            if resp.status_code != 200:
                print(f"❌ Failed to get route: {resp.text}")
                return
            route_data = resp.json()
        except Exception as e:
            print(f"❌ Could not connect to API: {e}")
            print("Make sure the FastAPI server is running with: uvicorn app.main:app --port 8000")
            return

    # Extract route coordinates (GeoJSON [lng, lat])
    geojson_coords = route_data["recommended_route"]["polyline_geojson"]["coordinates"]
    waypoints = [[c[1], c[0]] for c in geojson_coords] # convert to [lat, lng]
    maneuvers = route_data["recommended_route"]["turn_by_turn"]
    
    print(f"✅ Route received: {route_data['recommended_route']['total_distance_km']} km, "
          f"ETA: {route_data['recommended_route']['total_duration_minutes']} min, "
          f"{len(waypoints)} waypoints.")

    # 2. Connect to WebSocket
    print(f"Connecting to WebSocket at {BACKEND_WS}...")
    try:
        async with websockets.connect(BACKEND_WS) as ws:
            print("🟢 Connected to WebSocket stream! Streaming live vehicle telemetry...")
            
            # Step through waypoints with interpolation
            step_interval = 0.5 # update every 500ms
            speed_kmh = 65.0
            
            for i in range(len(waypoints) - 1):
                p1 = waypoints[i]
                p2 = waypoints[i+1]
                leg_distance = haversine_m(p1[0], p1[1], p2[0], p2[1])
                heading = calculate_bearing(p1[0], p1[1], p2[0], p2[1])

                # Slow down on short/sharp turns, accelerate on straights
                if leg_distance < 20:
                    speed_kmh = 35.0
                elif leg_distance > 150:
                    speed_kmh = 75.0
                else:
                    speed_kmh = 55.0

                speed_mps = speed_kmh / 3.6
                travel_time = max(0.5, leg_distance / speed_mps)
                num_substeps = max(1, int(travel_time / step_interval))

                for s in range(num_substeps):
                    alpha = (s + 1) / num_substeps
                    cur_lat = p1[0] + (p2[0] - p1[0]) * alpha
                    cur_lng = p1[1] + (p2[1] - p1[1]) * alpha

                    # Find upcoming maneuver
                    next_inst = "En route to Emergency Department"
                    next_dist = leg_distance
                    if maneuvers:
                        next_inst = maneuvers[0]["instruction"]
                        next_dist = maneuvers[0]["distance_meters"]

                    payload = {
                        "type": "telemetry",
                        "ambulance_id": "AMB-042",
                        "lat": round(cur_lat, 6),
                        "lng": round(cur_lng, 6),
                        "speed_kmh": round(speed_kmh, 1),
                        "heading_degrees": round(heading, 1),
                        "status": "EN_ROUTE_CODE_3",
                        "siren_active": True,
                        "timestamp": time.time(),
                        "next_step_instruction": next_inst,
                        "next_step_distance_meters": round(next_dist, 1)
                    }

                    await ws.send(json.dumps(payload))
                    print(f"📡 [AMB-042] GPS: {cur_lat:.5f}, {cur_lng:.5f} | "
                          f"Speed: {speed_kmh:.0f} km/h | Heading: {heading:.0f}° | "
                          f"Remaining: {len(waypoints) - i} pts")
                    
                    await asyncio.sleep(step_interval)

            print("🏁 Ambulance arrived at destination trauma center!")

    except Exception as e:
        print(f"❌ WebSocket error: {e}")

if __name__ == "__main__":
    asyncio.run(run_mock_simulation())
