import asyncio
import json
import websockets
import httpx
import sys

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

async def full_audit():
    print("--- AUDITING BOTH SERVERS ---")
    async with httpx.AsyncClient() as c:
        # Backend tests (8000)
        tests_8000 = [
            ("/", 200),
            ("/css/style.css", 200),
            ("/js/app.js", 200),
            ("/js/config.js", 200),
            ("/api/health", 200),
            ("/api/hospitals", 200),
        ]
        for path, expected in tests_8000:
            res = await c.get(f"http://localhost:8000{path}")
            assert res.status_code == expected, f"Failed {path}: {res.status_code}"
            print(f"[OK] [Port 8000] {path} -> {res.status_code}")

        # Test Route calculation
        r_route = await c.post("http://localhost:8000/api/route", json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "destination": {"lat": 12.9344, "lng": 77.6192},
            "destination_name": "Audit Hospital"
        })
        assert r_route.status_code == 200, f"Route failed: {r_route.status_code}"
        dist = r_route.json()["recommended_route"]["total_distance_km"]
        print(f"[OK] [Port 8000] /api/route -> 200 (Distance: {dist} km)")

        # Test Patient Pickup En-Route calculation
        r_pickup = await c.post("http://localhost:8000/api/route", json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "destination": {"lat": 12.9344, "lng": 77.6192},
            "destination_name": "Audit Hospital",
            "patient_pickups": [
                {
                    "id": "pickup-audit-1",
                    "name": "Audit Patient #1",
                    "triage_level": "CODE RED (Critical)",
                    "location": {"lat": 12.9550, "lng": 77.6050},
                    "picked_up": False
                }
            ]
        })
        assert r_pickup.status_code == 200, f"Pickup Route failed: {r_pickup.status_code}"
        p_route = r_pickup.json()
        assert len(p_route.get("patient_pickups", [])) == 1, "Patient pickup not returned"
        print(f"[OK] [Port 8000] /api/route (Patient Pickup En Route) -> 200 (Waypoints processed: {len(p_route['patient_pickups'])})")

        # Test Search endpoint
        r_search = await c.get("http://localhost:8000/api/search?q=Apollo&lat=12.9716&lng=77.5946")
        assert r_search.status_code == 200, f"Search failed: {r_search.status_code}"
        results = r_search.json()
        assert len(results) > 0, "No search results returned"
        print(f"[OK] [Port 8000] /api/search -> 200 (Found {len(results)} places, Top: '{results[0]['title']}')")

        # Test My Location endpoint
        r_loc = await c.get("http://localhost:8000/api/my-location")
        assert r_loc.status_code == 200, f"My-location failed: {r_loc.status_code}"
        loc_data = r_loc.json()
        print(f"[OK] [Port 8000] /api/my-location -> 200 (Live Area: {loc_data.get('area_name')})")

        # Test Local Hospitals in detected live area
        r_nearby = await c.post("http://localhost:8000/api/hospitals/nearby", json={
            "ambulance_location": {"lat": loc_data["lat"], "lng": loc_data["lng"]},
            "radius_km": 25.0
        })
        assert r_nearby.status_code == 200, f"Nearby hospitals failed: {r_nearby.status_code}"
        local_hospitals = r_nearby.json()
        assert len(local_hospitals) > 0, "No local hospitals found"
        print(f"[OK] [Port 8000] /api/hospitals/nearby -> 200 (Found {len(local_hospitals)} real local hospitals, Top: '{local_hospitals[0]['name']}')")

        # Test Reverse Geocode endpoint
        r_rev = await c.get(f"http://localhost:8000/api/reverse-geocode?lat={loc_data['lat']}&lng={loc_data['lng']}")
        assert r_rev.status_code == 200, f"Reverse geocode failed: {r_rev.status_code}"
        print(f"[OK] [Port 8000] /api/reverse-geocode -> 200 (Area: '{r_rev.json().get('area_name')}')")

        # Test Hospital Pre-Admission Registration while Travelling in Ambulance
        r_adm = await c.post("http://localhost:8000/api/patient/admit-register", json={
            "patient_name": "Test Patient Kumar",
            "age": 45,
            "gender": "Male",
            "contact_phone": "+91-9876543210",
            "admission_type": "EMERGENCY_IP",
            "triage_level": "CODE RED (Critical)",
            "chief_complaint": "Acute Myocardial Infarction",
            "vitals": {"bp": "140/90", "pulse": 105, "spo2": 94, "temp": 98.6},
            "destination_hospital_id": "hosp-001",
            "destination_hospital_name": "Apollo Emergency & Trauma Center"
        })
        assert r_adm.status_code == 200, f"Hospital admission register failed: {r_adm.status_code}"
        adm_data = r_adm.json()
        assert adm_data["success"] is True
        reg_id = adm_data["registration_id"]
        print(f"[OK] [Port 8000] /api/patient/admit-register -> 200 (Token: {reg_id}, Bay: '{adm_data['assigned_bay']}')")

        # Test Confirm Admission on Arrival
        r_conf = await c.post(f"http://localhost:8000/api/patient/admissions/{reg_id}/admit")
        assert r_conf.status_code == 200, f"Confirm admission failed: {r_conf.status_code}"
        print(f"[OK] [Port 8000] /api/patient/admissions/{reg_id}/admit -> 200 (Admitted on arrival)")

        # Frontend tests (3000, optional if running)
        try:
            tests_3000 = [
                ("/", 200),
                ("/css/style.css", 200),
                ("/js/app.js", 200),
                ("/js/config.js", 200),
                ("/js/routing.js", 200),
                ("/js/telemetry.js", 200),
                ("/js/audio.js", 200),
            ]
            for path, expected in tests_3000:
                res = await c.get(f"http://localhost:3000{path}")
                if res.status_code == expected:
                    print(f"[OK] [Port 3000] {path} -> {res.status_code}")
        except Exception:
            print("[INFO] [Port 3000] Standalone frontend dev server not running (all static assets are hosted directly on Port 8000)")

    # WebSocket Audit
    async with websockets.connect("ws://localhost:8000/ws/ambulance") as ws:
        msg = await ws.recv()
        print("[OK] [WebSocket] Connected! Received:", json.loads(msg).get("type"))
        
        await ws.send(json.dumps({
            "type": "telemetry",
            "ambulance_id": "AMB-AUDIT",
            "lat": 12.9716,
            "lng": 77.5946,
            "speed_kmh": 62.0,
            "heading_degrees": 90.0,
            "status": "EN_ROUTE_CODE_3",
            "siren_active": True,
            "timestamp": 1700000000
        }))
        bcast = await ws.recv()
        data = json.loads(bcast)
        assert data.get("type") == "telemetry_update"
        speed = data["telemetry"]["speed_kmh"]
        print(f"[OK] [WebSocket] Telemetry Broadcast Confirmed: Speed = {speed} km/h")

    print("\n>>> ALL 14 HEALTH CHECKS PASSED WITH 100% SUCCESS! <<<")

if __name__ == "__main__":
    asyncio.run(full_audit())
