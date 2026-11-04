import asyncio
import json
import logging
import re
import sys
import time
from typing import List, Dict, Any, Set, Optional
import httpx
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from app.models import (
    Coordinate,
    Hospital,
    NearbyHospitalsRequest,
    RouteRequest,
    RerouteRequest,
    RouteComparisonResponse,
    TelemetryPacket,
    SearchResult,
    PatientAdmissionRegistration,
    AdmissionResponse,
)
from app.hospitals import (
    DEFAULT_HOSPITALS,
    get_hospitals_near_location,
    get_real_local_hospitals,
    get_hospital_by_id,
    haversine_distance_km,
)
from app.routing import (
    calculate_emergency_routes,
    calculate_bearing,
    calculate_distance_meters,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("ambulance.main")

app = FastAPI(
    title="Emergency Ambulance Smart Routing & Telemetry API",
    description="Traffic-aware lowest-congestion route optimization & real-time GPS tracking for emergency services",
    version="1.0.0"
)

# Enable CORS for external map integrations or mobile webviews
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

# Mount static directories for frontend assets
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/css", StaticFiles(directory=str(STATIC_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(STATIC_DIR / "js")), name="js")

# In-memory WebSocket Connection Manager
class TelemetryConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.latest_telemetry: Dict[str, Any] = {
            "ambulance_id": "AMB-042",
            "lat": 12.9716,
            "lng": 77.5946,
            "speed_kmh": 0.0,
            "heading_degrees": 0.0,
            "status": "EN_ROUTE_CODE_3",
            "timestamp": time.time(),
            "siren_active": True
        }

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")
        # Immediately transmit last known telemetry to the newly connected client
        await websocket.send_json({
            "type": "initial_state",
            "telemetry": self.latest_telemetry
        })

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any], sender: WebSocket = None):
        """Broadcasts telemetry update to all connected dispatch/driver clients."""
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"Error sending to client: {e}")
                dead_connections.append(connection)

        for dead in dead_connections:
            self.active_connections.discard(dead)

manager = TelemetryConnectionManager()

# --- REST ENDPOINTS ---

@app.get("/")
async def serve_index():
    """Serves the main Emergency Driver HUD interface with no-cache headers."""
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend index.html not found.")
    return FileResponse(
        index_file,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/api/health")
async def health_check():
    return {
        "status": "HEALTHY",
        "service": "Emergency Ambulance Routing & Telemetry Engine",
        "active_telemetry_clients": len(manager.active_connections),
        "timestamp": time.time()
    }

@app.get("/api/hospitals", response_model=List[Hospital])
async def list_hospitals():
    """Retrieve the directory of pre-loaded emergency medical centers."""
    return DEFAULT_HOSPITALS

@app.get("/api/my-location")
async def detect_my_location():
    """
    Detects user's real geographic live area using fast IP geolocation fallback
    so the map immediately centers on their real city/area upon opening.
    """
    for service_url in ["http://ip-api.com/json/", "https://ipwho.is/"]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(service_url)
                if r.status_code == 200:
                    data = r.json()
                    lat = data.get("lat") or data.get("latitude")
                    lng = data.get("lon") or data.get("longitude")
                    city = data.get("city") or "Local Area"
                    region = data.get("region") or data.get("region_name") or ""
                    country = data.get("country") or data.get("country_name") or ""
                    if lat and lng:
                        area_name = f"{city}, {region}" if (region and region != city) else city
                        return {
                            "lat": float(lat),
                            "lng": float(lng),
                            "city": city,
                            "region": region,
                            "country": country,
                            "area_name": area_name
                        }
        except Exception as e:
            logger.warning(f"IP lookup failed on {service_url}: {e}")
            continue

    # Default fallback
    return {
        "lat": 15.8288,
        "lng": 78.0360,
        "city": "Kurnool",
        "region": "Andhra Pradesh",
        "country": "India",
        "area_name": "Kurnool, Andhra Pradesh"
    }

@app.get("/api/reverse-geocode")
async def reverse_geocode_area(lat: float, lng: float):
    """
    Reverse geocodes coordinates to a human-readable live area & neighborhood name.
    """
    try:
        headers = {"User-Agent": "AmbuRouteX-EmergencyRouting/1.0 (Emergency Response Navigation HUD; contact=admin@localhost)"}
        params = {"lat": lat, "lon": lng, "format": "json"}
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get("https://nominatim.openstreetmap.org/reverse", params=params, headers=headers)
            if r.status_code == 200:
                data = r.json()
                addr = data.get("address", {})
                suburb = addr.get("suburb") or addr.get("neighbourhood") or addr.get("residential") or addr.get("city_district") or ""
                city = addr.get("city") or addr.get("town") or addr.get("county") or addr.get("state") or ""
                area_display = f"{suburb}, {city}" if (suburb and city and suburb != city) else (city or suburb or "Live Area")
                return {
                    "area_name": area_display,
                    "city": city,
                    "suburb": suburb,
                    "full_address": data.get("display_name", ""),
                    "lat": lat,
                    "lng": lng
                }
    except Exception as e:
        logger.warning(f"Reverse geocode error: {e}")

    return {
        "area_name": f"Area ({lat:.3f}, {lng:.3f})",
        "city": "",
        "suburb": "",
        "full_address": "",
        "lat": lat,
        "lng": lng
    }

@app.post("/api/hospitals/nearby", response_model=List[Hospital])
async def find_nearby_hospitals(req: NearbyHospitalsRequest):
    """
    Given ambulance GPS coordinates, returns real local hospitals around
    the user's live area sorted by proximity and estimated emergency code-3 arrival times.
    """
    return await get_real_local_hospitals(req.ambulance_location, radius_km=req.radius_km or 30.0)

@app.get("/api/search", response_model=List[SearchResult])
async def search_locations(
    q: str,
    lat: Optional[float] = None,
    lng: Optional[float] = None
):
    """
    Unified place and address search:
    1. Direct coordinate parsing (e.g. '12.9716, 77.5946').
    2. Instant matching against emergency hospitals and trauma centers.
    3. Global geocoding via OpenStreetMap Nominatim for streets, landmarks, and addresses.
    """
    query = q.strip()
    if not query:
        return []

    results: List[SearchResult] = []
    seen_coords = set()

    # 1. Check for literal coordinates (e.g., "12.9716, 77.5946" or "12.9716 77.5946")
    coord_match = re.match(r"^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)[,\s]+[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$", query)
    if coord_match:
        parts = re.split(r"[,\s]+", query)
        try:
            c_lat = float(parts[0])
            c_lng = float(parts[1])
            dist = haversine_distance_km(lat, lng, c_lat, c_lng) if (lat is not None and lng is not None) else None
            results.append(SearchResult(
                title=f"Coordinates ({c_lat:.4f}, {c_lng:.4f})",
                subtitle="Direct GPS Target Location",
                lat=c_lat,
                lng=c_lng,
                category="coordinate",
                distance_km=dist,
                icon="🧭"
            ))
            seen_coords.add((round(c_lat, 4), round(c_lng, 4)))
        except Exception:
            pass

    # 2. Local emergency hospitals match
    # If ambulance coordinates provided, also get localized dynamic hospitals
    hospital_pool = DEFAULT_HOSPITALS
    if lat is not None and lng is not None:
        hospital_pool = get_hospitals_near_location(Coordinate(lat=lat, lng=lng), radius_km=150.0)

    q_lower = query.lower()
    for h in hospital_pool:
        if (q_lower in h.name.lower() or 
            q_lower in h.address.lower() or 
            q_lower in h.trauma_level.lower()):
            coord_key = (round(h.lat, 4), round(h.lng, 4))
            if coord_key not in seen_coords:
                dist = haversine_distance_km(lat, lng, h.lat, h.lng) if (lat is not None and lng is not None) else h.distance_km
                results.append(SearchResult(
                    title=h.name,
                    subtitle=f"{h.trauma_level} • {h.address} ({h.er_beds_available} ER beds)",
                    lat=h.lat,
                    lng=h.lng,
                    category="hospital",
                    distance_km=dist,
                    icon="🏥",
                    raw_data=h.model_dump()
                ))
                seen_coords.add(coord_key)

    # 3. OpenStreetMap Nominatim Geocoding for addresses and landmarks
    # Search externally if query length >= 3
    if len(query) >= 3:
        try:
            headers = {
                "User-Agent": "AmbuRouteX-EmergencyRouting/1.0 (Emergency Response Navigation HUD; contact=admin@localhost)"
            }
            params = {
                "q": query,
                "format": "json",
                "addressdetails": "1",
                "limit": 6
            }
            # Bias results near current location if available
            if lat is not None and lng is not None:
                params["viewbox"] = f"{lng-0.5},{lat+0.5},{lng+0.5},{lat-0.5}"
                params["bounded"] = "0"

            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get("https://nominatim.openstreetmap.org/search", params=params, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data:
                        i_lat = float(item.get("lat", 0))
                        i_lng = float(item.get("lon", 0))
                        coord_key = (round(i_lat, 4), round(i_lng, 4))
                        if coord_key in seen_coords:
                            continue

                        display_name = item.get("display_name", "")
                        # Split display name into title (first 1-2 parts) and subtitle (rest)
                        parts = [p.strip() for p in display_name.split(",") if p.strip()]
                        title = parts[0] if parts else display_name
                        subtitle = ", ".join(parts[1:4]) if len(parts) > 1 else ""

                        item_type = item.get("type", "")
                        category = "hospital" if "hospital" in item_type or "clinic" in item_type else "place"
                        icon = "🏥" if category == "hospital" else "📍"

                        dist = haversine_distance_km(lat, lng, i_lat, i_lng) if (lat is not None and lng is not None) else None

                        results.append(SearchResult(
                            title=title,
                            subtitle=subtitle,
                            lat=i_lat,
                            lng=i_lng,
                            category=category,
                            distance_km=dist,
                            icon=icon,
                            raw_data={"osm_id": item.get("osm_id"), "type": item_type}
                        ))
                        seen_coords.add(coord_key)
        except Exception as e:
            logger.warning(f"Nominatim search warning: {e}")

    # Sort results prioritizing hospitals and closest distances
    def sort_key(item: SearchResult):
        cat_priority = 0 if item.category == "hospital" else (1 if item.category == "coordinate" else 2)
        dist = item.distance_km if item.distance_km is not None else 9999.0
        return (cat_priority, dist)

    results.sort(key=sort_key)
    return results[:8]


@app.post("/api/route", response_model=RouteComparisonResponse)
async def get_route(req: RouteRequest):
    """
    Calculates both the Fastest Traffic Route and Shortest Route between
    ambulance origin and target destination.
    """
    try:
        response = await calculate_emergency_routes(
            origin=req.origin,
            destination=req.destination,
            destination_name=req.destination_name or "Hospital Destination",
            avoid_roadblocks=req.avoid_roadblocks or [],
            patient_pickups=req.patient_pickups or []
        )
        return response
    except Exception as e:
        logger.exception(f"Routing calculation failure: {e}")
        raise HTTPException(status_code=500, detail=f"Route calculation error: {str(e)}")

@app.post("/api/reroute", response_model=RouteComparisonResponse)
async def emergency_reroute(req: RerouteRequest):
    """
    Triggered when the driver hits 'EMERGENCY: REROUTE' or encounters a severe roadblock.
    Injects the incident coordinates as an obstacle and re-optimizes the fastest bypass corridor.
    """
    logger.info(f"[EMERGENCY] REROUTE REQUESTED: Reason='{req.reason}' from {req.current_location}")
    
    # If no explicit block point was provided, simulate roadblock 600m ahead on the original heading
    block_pt = req.reported_block_location
    if not block_pt:
        # Approximate 500m ahead towards destination
        d_lat = (req.destination.lat - req.current_location.lat) * 0.15
        d_lng = (req.destination.lng - req.current_location.lng) * 0.15
        block_pt = Coordinate(
            lat=req.current_location.lat + d_lat,
            lng=req.current_location.lng + d_lng
        )

    # Calculate reroute avoiding this road hazard
    reroute_resp = await calculate_emergency_routes(
        origin=req.current_location,
        destination=req.destination,
        destination_name=req.destination_name,
        avoid_roadblocks=[block_pt]
    )
    
    # Broadcast incident notification to connected telemetry dispatch
    await manager.broadcast({
        "type": "emergency_alert",
        "title": "[ALERT] REROUTE DISPATCH ALERT",
        "message": f"Ambulance {manager.latest_telemetry.get('ambulance_id')} rerouted due to {req.reason}.",
        "incident_location": {"lat": block_pt.lat, "lng": block_pt.lng},
        "time_saved": reroute_resp.time_saved_minutes
    })

    return reroute_resp

# --- HOSPITAL PRE-ADMISSION (PATIENT TRAVELLING IN AMBULANCE) ---

REGISTERED_ADMISSIONS: List[Dict[str, Any]] = []

@app.post("/api/patient/admit-register", response_model=AdmissionResponse)
async def register_patient_admission(reg: PatientAdmissionRegistration):
    """
    Pre-registers an ambulance-transported patient (OP/IP) directly with the destination
    hospital so admission, triage priority, trauma bays, and doctors are ready on arrival.
    """
    reg_id = reg.registration_id or f"ADM-{int(time.time() * 1000) % 1000000:06d}"
    bay_number = ((hash(reg_id) % 8) + 1)
    if "IP" in reg.admission_type or "Critical" in reg.triage_level:
        assigned_bay = f"Resuscitation Bay #{bay_number} (ICU / Code Red)"
    else:
        assigned_bay = f"Emergency OP Cubicle #{bay_number}"

    admission_record = {
        "registration_id": reg_id,
        "patient_name": reg.patient_name,
        "age": reg.age,
        "gender": reg.gender,
        "contact_phone": reg.contact_phone,
        "emergency_contact": reg.emergency_contact,
        "admission_type": reg.admission_type,
        "triage_level": reg.triage_level,
        "chief_complaint": reg.chief_complaint,
        "vitals": reg.vitals,
        "destination_hospital_id": reg.destination_hospital_id,
        "destination_hospital_name": reg.destination_hospital_name,
        "ambulance_id": reg.ambulance_id,
        "status": "PRE_ADMITTED_EN_ROUTE",
        "assigned_bay": assigned_bay,
        "registered_at": time.time(),
        "notes": reg.notes or ""
    }

    REGISTERED_ADMISSIONS.insert(0, admission_record)

    # Broadcast pre-admission alert to connected hospital and dispatch clients
    await manager.broadcast({
        "type": "hospital_pre_admission_alert",
        "title": "🚨 INCOMING PATIENT HOSPITAL PRE-ADMISSION",
        "message": f"Ambulance {reg.ambulance_id} registered {reg.patient_name} ({reg.triage_level}) for admission at {reg.destination_hospital_name}.",
        "admission": admission_record
    })

    return AdmissionResponse(
        success=True,
        registration_id=reg_id,
        patient_name=reg.patient_name,
        admission_type=reg.admission_type,
        destination_hospital_name=reg.destination_hospital_name,
        assigned_bay=assigned_bay,
        message=f"Pre-admission confirmed at {reg.destination_hospital_name}. Trauma team alerted and {assigned_bay} reserved.",
        beds_remaining=max(1, 6 - len([a for a in REGISTERED_ADMISSIONS if a.get('destination_hospital_id') == reg.destination_hospital_id])),
        registered_at=admission_record["registered_at"]
    )

@app.get("/api/patient/admissions")
async def list_patient_admissions():
    """Returns directory of patients pre-registered/admitted during ambulance transit."""
    return REGISTERED_ADMISSIONS

@app.post("/api/patient/admissions/{reg_id}/admit")
async def confirm_hospital_admission(reg_id: str):
    """Marks patient as officially admitted upon arrival at hospital ER doors."""
    for adm in REGISTERED_ADMISSIONS:
        if adm["registration_id"] == reg_id:
            adm["status"] = "ADMITTED_ON_ARRIVAL"
            adm["admitted_at"] = time.time()
            await manager.broadcast({
                "type": "patient_admitted_confirmed",
                "registration_id": reg_id,
                "patient_name": adm["patient_name"],
                "hospital": adm["destination_hospital_name"]
            })
            return {"success": True, "message": f"Patient {adm['patient_name']} officially admitted to hospital."}
    raise HTTPException(status_code=404, detail="Admission registration not found.")

# --- REAL-TIME WEBSOCKET TELEMETRY LAYER ---

@app.websocket("/ws/ambulance")
async def websocket_ambulance_telemetry(websocket: WebSocket):
    """
    Real-time bidirectional WebSocket endpoint for streaming ambulance coordinates,
    speed, heading, siren status, and receiving dispatch warnings.
    """
    await manager.connect(websocket)
    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data = json.loads(raw_text)
                msg_type = data.get("type", "telemetry")
                
                if msg_type in ("telemetry", "position_update"):
                    # Update cache
                    manager.latest_telemetry.update({
                        "ambulance_id": data.get("ambulance_id", "AMB-042"),
                        "lat": data.get("lat"),
                        "lng": data.get("lng"),
                        "speed_kmh": data.get("speed_kmh", 0.0),
                        "heading_degrees": data.get("heading_degrees", 0.0),
                        "status": data.get("status", "EN_ROUTE_CODE_3"),
                        "siren_active": data.get("siren_active", True),
                        "timestamp": data.get("timestamp", time.time()),
                        "next_step_distance_meters": data.get("next_step_distance_meters"),
                        "next_step_instruction": data.get("next_step_instruction")
                    })
                    
                    # Broadcast packet to all listeners (drivers, dispatchers)
                    broadcast_payload = {
                        "type": "telemetry_update",
                        "telemetry": manager.latest_telemetry
                    }
                    await manager.broadcast(broadcast_payload, sender=websocket)

                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong", "time": time.time()})

                elif msg_type == "emergency_siren_toggle":
                    siren_state = data.get("siren_active", True)
                    manager.latest_telemetry["siren_active"] = siren_state
                    await manager.broadcast({
                        "type": "siren_state_changed",
                        "siren_active": siren_state,
                        "ambulance_id": manager.latest_telemetry.get("ambulance_id")
                    })

            except json.JSONDecodeError:
                logger.warning("Received invalid JSON on WebSocket")

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
