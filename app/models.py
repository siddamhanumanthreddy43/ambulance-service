from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class Coordinate(BaseModel):
    lat: float = Field(..., description="Latitude in decimal degrees")
    lng: float = Field(..., description="Longitude in decimal degrees")

class Hospital(BaseModel):
    id: str
    name: str
    address: str
    lat: float
    lng: float
    trauma_level: str  
    er_beds_available: int
    icu_beds_available: int
    emergency_phone: str
    distance_km: Optional[float] = None
    estimated_arrival_mins: Optional[int] = None

class NearbyHospitalsRequest(BaseModel):
    ambulance_location: Coordinate
    radius_km: Optional[float] = 25.0

class TurnManeuver(BaseModel):
    step_number: int
    instruction: str
    type: str 
    modifier: Optional[str] = None
    road_name: str
    distance_meters: float
    duration_seconds: float
    location: Coordinate

class TrafficSegment(BaseModel):
    segment_id: int
    coordinates: List[List[float]]  
    congestion_level: str 
    color: str 
    speed_kmh: float
    delay_seconds: float
    road_name: Optional[str] = ""

class RouteSummary(BaseModel):
    route_type: str 
    total_distance_km: float
    total_duration_minutes: float
    base_duration_minutes: float
    traffic_delay_minutes: float
    average_speed_kmh: float
    congestion_summary: str 
    polyline_geojson: Dict[str, Any]
    traffic_segments: List[TrafficSegment]
    turn_by_turn: List[TurnManeuver]

class RouteComparisonResponse(BaseModel):
    origin: Coordinate
    destination: Coordinate
    destination_name: str
    recommended_route: RouteSummary
    alternative_route: Optional[RouteSummary] = None
    time_saved_minutes: float
    active_incidents: List[Dict[str, Any]] = []
    patient_pickups: List[Dict[str, Any]] = []

class PatientPickup(BaseModel):
    id: str
    name: str = "Emergency Patient"
    triage_level: str = "CODE RED (Critical)" 
    location: Coordinate
    address: Optional[str] = "En Route Pickup Point"
    contact_phone: Optional[str] = "+91-9876543210"
    picked_up: bool = False
    pickup_time: Optional[float] = None
    condition_notes: Optional[str] = ""

class RouteRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    destination_name: Optional[str] = "Selected Destination"
    avoid_roadblocks: Optional[List[Coordinate]] = []
    patient_pickups: Optional[List[PatientPickup]] = []

class RerouteRequest(BaseModel):
    current_location: Coordinate
    destination: Coordinate
    destination_name: Optional[str] = "Destination"
    reported_block_location: Optional[Coordinate] = None
    reason: Optional[str] = "Severe Traffic / Roadblock Detected"

class TelemetryPacket(BaseModel):
    type: str = "telemetry"
    ambulance_id: str = "AMB-042"
    timestamp: float
    lat: float
    lng: float
    speed_kmh: float = 0.0
    heading_degrees: float = 0.0
    status: str = "EN_ROUTE_CODE_3" 
    siren_active: bool = True
    next_step_distance_meters: Optional[float] = None
    next_step_instruction: Optional[str] = None

class SearchResult(BaseModel):
    title: str
    subtitle: Optional[str] = ""
    lat: float
    lng: float
    category: str = "place" 
    distance_km: Optional[float] = None
    icon: Optional[str] = "📍"
    raw_data: Optional[Dict[str, Any]] = None

class PatientAdmissionRegistration(BaseModel):
    registration_id: Optional[str] = None
    patient_name: str
    age: int = 35
    gender: str = "Male"
    contact_phone: Optional[str] = "+91-9876543210"
    emergency_contact: Optional[str] = ""
    admission_type: str = "EMERGENCY_IP"  # "EMERGENCY_IP" (In-Patient Bed/ICU) or "OUTPATIENT_OP" (OP / Urgent Care)
    triage_level: str = "CODE RED (Critical)"
    chief_complaint: str = "Severe Chest Pain / Trauma"
    vitals: Dict[str, Any] = Field(default_factory=lambda: {
        "bp": "120/80",
        "pulse": 88,
        "spo2": 98,
        "temp": 98.6
    })
    destination_hospital_id: str
    destination_hospital_name: str
    ambulance_id: str = "AMB-042"
    status: str = "PRE_ADMITTED_EN_ROUTE"
    assigned_bay: Optional[str] = None
    registered_at: Optional[float] = None
    notes: Optional[str] = ""

class AdmissionResponse(BaseModel):
    success: bool
    registration_id: str
    patient_name: str
    admission_type: str
    destination_hospital_name: str
    assigned_bay: str
    message: str
    beds_remaining: int
    registered_at: float


