/**
 * Global API & WebSocket Configuration
 * Automatically detects whether the frontend is running on a dedicated dev server
 * (e.g. port 3000, 5000, 5500) or served directly by the FastAPI backend (port 8000).
 */
window.API_CONFIG = {
  BACKEND_PORT: 8000,

  get baseUrl() {
    // If running on a dedicated frontend server (e.g. port 3000, 5500, 8080), route API requests to port 8000
    if (window.location.port !== "8000" && window.location.port !== "") {
      return `http://${window.location.hostname}:8000`;
    }
    return ""; // Same origin when served by FastAPI
  },

  get wsUrl() {
    // If running on a separate port, connect WebSocket to backend port 8000
    if (window.location.port !== "8000" && window.location.port !== "") {
      return `ws://${window.location.hostname}:8000/ws/ambulance`;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws/ambulance`;
  }
};
