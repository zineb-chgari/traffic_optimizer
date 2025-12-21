import React, { useState, useEffect, useRef } from "react";
import {
  Bus,
  MapPin,
  Search,
  AlertTriangle,
  Clock,
  Navigation,
  Activity,
  TrendingUp
} from "lucide-react";

const API_URL = "http://localhost:3000";

class TransportOptimizer {
  static calculateUrbanDensity(lat, lon) {
    const highDensityZones = [
      { lat: 33.5731, lon: -7.5898, radius: 0.02, name: "Centre-ville" },
      { lat: 33.5892, lon: -7.6039, radius: 0.015, name: "Maarif" },
      { lat: 33.6016, lon: -7.6322, radius: 0.012, name: "Ain Diab" }
    ];

    let density = 30;
    for (const zone of highDensityZones) {
      const distance = Math.sqrt(
        Math.pow(lat - zone.lat, 2) + Math.pow(lon - zone.lon, 2)
      );
      if (distance < zone.radius) {
        density += (1 - distance / zone.radius) * 70;
      }
    }
    return Math.min(100, Math.round(density));
  }

  static generateTransportRoutes(originLat, originLon, destLat, destLon, baseRoute, trafficData, transportLines) {
    const routes = [];
    const distance = baseRoute.distance;
    const baseDuration = baseRoute.duration;
    const realTraffic = trafficData.averageCongestion;
    const avgDensity = (this.calculateUrbanDensity(originLat, originLon) + this.calculateUrbanDensity(destLat, destLon)) / 2;

    const busLines = [transportLines.bus[0].id, transportLines.bus[1].id];
    routes.push({
      id: 1,
      name: "Itinéraire 1",
      subtitle: "Plus rapide",
      type: "BUS_DIRECT",
      coordinates: baseRoute.coordinates,
      duration: Math.round(baseDuration / 60 * (1.3 + realTraffic / 200)),
      transfers: 0,
      walkingDistance: Math.round(distance * 0.05),
      totalDistance: Math.round(distance),
      busLines: busLines,
      lineDetails: busLines.map(id => transportLines.bus.find(l => l.id === id)),
      trafficLevel: realTraffic > 60 ? "Dense" : realTraffic > 40 ? "Modéré" : "Fluide",
      trafficSpeed: `${Math.round(42 + Math.random() * 15)}.${Math.round(Math.random() * 9)}`,
      congestion: realTraffic,
      score: this.calculateScore(baseDuration / 60 * 1.3, 0, distance * 0.05, avgDensity, realTraffic),
      alerts: realTraffic > 60 ? [{type: "alert", text: "1 alerte(s)"}, {type: "info", text: `+${Math.round(realTraffic / 10)} min de retard estimé`}] : [],
      segments: this.generateSegments(baseRoute.coordinates, busLines, transportLines)
    });

    const tramRoute = this.generateAlternativeRoute(baseRoute.coordinates, 0.08);
    const tramLines = [transportLines.tramway[0].id, transportLines.bus[2].id];
    routes.push({
      id: 2,
      name: "Itinéraire 2",
      subtitle: "Moins de correspondances",
      type: "TRAM_BUS",
      coordinates: tramRoute,
      duration: Math.round(baseDuration / 60 * (1.5 + realTraffic / 300)),
      transfers: 1,
      walkingDistance: Math.round(distance * 0.08),
      totalDistance: Math.round(distance * 1.1),
      busLines: tramLines,
      lineDetails: [transportLines.tramway.find(l => l.id === tramLines[0]), transportLines.bus.find(l => l.id === tramLines[1])],
      trafficLevel: "Modéré",
      trafficSpeed: `${Math.round(34 + Math.random() * 15)}.${Math.round(Math.random() * 9)}`,
      congestion: Math.round(realTraffic * 0.6),
      score: this.calculateScore(baseDuration / 60 * 1.5, 1, distance * 0.08, avgDensity, realTraffic * 0.6),
      alerts: [{type: "info", text: `+10 min de retard estimé`}],
      segments: this.generateSegments(tramRoute, tramLines, transportLines)
    });

    const multiRoute = this.generateAlternativeRoute(baseRoute.coordinates, 0.12);
    const multiLines = [transportLines.bus[3].id, transportLines.bus[4].id, transportLines.bus[5].id];
    routes.push({
      id: 3,
      name: "Itinéraire 3",
      subtitle: "Économique",
      type: "MULTI_BUS",
      coordinates: multiRoute,
      duration: Math.round(baseDuration / 60 * 1.8),
      transfers: 2,
      walkingDistance: Math.round(distance * 0.12),
      totalDistance: Math.round(distance * 1.2),
      busLines: multiLines,
      lineDetails: multiLines.map(id => transportLines.bus.find(l => l.id === id)),
      trafficLevel: "Modéré",
      trafficSpeed: `${Math.round(28 + Math.random() * 15)}.${Math.round(Math.random() * 9)}`,
      congestion: realTraffic,
      score: this.calculateScore(baseDuration / 60 * 1.8, 2, distance * 0.12, avgDensity * 0.6, realTraffic),
      alerts: [],
      segments: this.generateSegments(multiRoute, multiLines, transportLines)
    });

    return routes.sort((a, b) => b.score - a.score);
  }

  static generateSegments(coordinates, lineIds, transportLines) {
    const segments = [];
    const segmentLength = Math.floor(coordinates.length / lineIds.length);
    lineIds.forEach((lineId, index) => {
      const start = index * segmentLength;
      const end = index === lineIds.length - 1 ? coordinates.length : (index + 1) * segmentLength;
      const line = [...transportLines.tramway, ...transportLines.bus].find(l => l.id === lineId);
      segments.push({
        lineId,
        lineName: line?.name || lineId,
        lineColor: line?.color || '#666',
        startIndex: start,
        endIndex: end,
        coordinates: coordinates.slice(start, end)
      });
    });
    return segments;
  }

  static calculateScore(duration, transfers, walking, density, traffic) {
    let score = 100;
    score -= duration * 0.8;
    score -= transfers * 8;
    score -= (walking / 100) * 2;
    score -= (density / 100) * 5;
    score -= (traffic / 100) * 10;
    return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  }

  static generateAlternativeRoute(baseCoords, deviation) {
    const newCoords = [];
    for (let i = 0; i < baseCoords.length; i++) {
      const coord = baseCoords[i];
      if (i === 0 || i === baseCoords.length - 1) {
        newCoords.push(coord);
      } else {
        const ratio = i / (baseCoords.length - 1);
        const devFactor = Math.sin(ratio * Math.PI) * deviation;
        const direction = i % 2 === 0 ? 1 : -1;
        newCoords.push([coord[0] + direction * devFactor * 0.8, coord[1] + direction * devFactor]);
      }
    }
    return newCoords;
  }
}

function LeafletMap({ route, allRoutes }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!mapRef.current) return;

    // Charger Leaflet CSS et JS dynamiquement
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (!window.L) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => initMap();
      document.body.appendChild(script);
    } else {
      initMap();
    }
  }, []);

  useEffect(() => {
    if (window.L && mapInstanceRef.current && route) {
      updateMap();
    }
  }, [route]);

  const initMap = () => {
    if (!window.L || !mapRef.current || mapInstanceRef.current) return;

    const defaultCenter = [33.5731, -7.5898]; // Casablanca
    const map = window.L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 13,
      zoomControl: true
    });

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    mapInstanceRef.current = map;

    if (route) {
      updateMap();
    }
  };

  const updateMap = () => {
    const map = mapInstanceRef.current;
    if (!map || !route) return;

    // Nettoyer les anciens marqueurs et lignes
    markersRef.current.forEach(layer => map.removeLayer(layer));
    markersRef.current = [];

    // Dessiner les segments
    route.segments && route.segments.forEach((segment) => {
      const polyline = window.L.polyline(
        segment.coordinates.map(c => [c[0], c[1]]),
        {
          color: segment.lineColor,
          weight: 6,
          opacity: 0.8,
          smoothFactor: 1
        }
      ).addTo(map);
      markersRef.current.push(polyline);

      // Ajouter des points d'arrêt
      segment.coordinates.forEach((coord, i) => {
        if (i % 3 === 0) {
          const stopMarker = window.L.circleMarker([coord[0], coord[1]], {
            radius: 4,
            fillColor: segment.lineColor,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
          }).addTo(map);
          markersRef.current.push(stopMarker);
        }
      });
    });

    // Marqueur de départ (vert)
    if (route.coordinates.length > 0) {
      const startIcon = window.L.divIcon({
        className: 'custom-marker',
        html: '<div style="background-color: #10b981; width: 30px; height: 30px; border-radius: 50%; border: 4px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const startMarker = window.L.marker(
        [route.coordinates[0][0], route.coordinates[0][1]],
        { icon: startIcon }
      ).addTo(map);
      markersRef.current.push(startMarker);

      // Marqueur d'arrivée (rouge)
      const endIcon = window.L.divIcon({
        className: 'custom-marker',
        html: '<div style="background-color: #ef4444; width: 30px; height: 30px; border-radius: 50%; border: 4px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const endMarker = window.L.marker(
        [route.coordinates[route.coordinates.length - 1][0], route.coordinates[route.coordinates.length - 1][1]],
        { icon: endIcon }
      ).addTo(map);
      markersRef.current.push(endMarker);
    }

    // Ajuster la vue pour afficher tout l'itinéraire
    const bounds = window.L.latLngBounds(route.coordinates.map(c => [c[0], c[1]]));
    map.fitBounds(bounds, { padding: [50, 50] });
  };

  if (!route) {
    return (
      <div className="h-full bg-gradient-to-br from-blue-100 via-blue-50 to-indigo-100 rounded-lg flex items-center justify-center">
        <p className="text-gray-400 font-medium">Sélectionnez un itinéraire pour voir la carte</p>
      </div>
    );
  }

  return (
    <div className="relative h-full rounded-lg overflow-hidden shadow-lg border-2 border-gray-200">
      <div ref={mapRef} className="w-full h-full"></div>
      
      {/* Légende */}
      <div className="absolute top-4 right-4 bg-white rounded-lg shadow-xl p-4 border border-gray-200 z-[1000]">
        <div className="font-bold text-sm mb-3 text-gray-800 border-b pb-2">
          {route.busLines.join(" ")}
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full bg-green-500 border-2 border-white shadow-md"></div>
            <span className="text-xs text-gray-700 font-medium">Origine</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full bg-red-500 border-2 border-white shadow-md"></div>
            <span className="text-xs text-gray-700 font-medium">Destination</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RouteCardModern({ route, selected, onClick }) {
  const getTrafficColor = () => {
    if (route.congestion < 40) return "bg-green-500";
    if (route.congestion < 70) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-5 cursor-pointer transition-all border-4 ${
        selected ? "border-blue-500 shadow-xl" : "border-transparent shadow-md hover:shadow-lg"
      }`}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-800">{route.name}</h3>
          <p className="text-sm text-gray-500">{route.subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold text-blue-600">{route.score}</div>
          <div className="text-xs text-gray-500">score</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div>
          <Clock className="w-5 h-5 mx-auto text-gray-400 mb-1" />
          <div className="text-xl font-bold">{route.duration}min</div>
          <div className="text-xs text-gray-500">Durée</div>
        </div>
        <div>
          <Bus className="w-5 h-5 mx-auto text-gray-400 mb-1" />
          <div className="text-xl font-bold">{route.transfers}</div>
          <div className="text-xs text-gray-500">Corresp.</div>
        </div>
        <div>
          <Navigation className="w-5 h-5 mx-auto text-gray-400 mb-1" />
          <div className="text-xl font-bold">{route.walkingDistance}m</div>
          <div className="text-xs text-gray-500">Marche</div>
        </div>
      </div>

      <div className="border-t pt-3 mb-3">
        <div className="text-xs text-gray-600 mb-2">Ligne: <span className="font-semibold">{route.busLines.join(", ")}</span></div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-600">Trafic:</span>
          <div className={`w-2 h-2 rounded-full ${getTrafficColor()}`}></div>
          <span className="font-semibold">{route.trafficLevel}</span>
          <span className="text-gray-400">({route.trafficSpeed} km/h)</span>
        </div>
      </div>

      {route.alerts.length > 0 && (
        <div className="space-y-1">
          {route.alerts.map((alert, i) => (
            <div key={i} className={`flex items-center gap-2 text-xs ${alert.type === 'alert' ? 'text-red-600' : 'text-orange-600'}`}>
              <AlertTriangle className="w-3 h-3" />
              <span>{alert.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailsPanel({ route }) {
  if (!route) return null;

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg">
      <h3 className="text-xl font-bold mb-4">Détails de l'itinéraire</h3>
      
      <div className="bg-blue-50 rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold text-gray-700">Score global</span>
          <span className="text-3xl font-bold text-blue-600">{route.score}/100</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-blue-600 h-2 rounded-full transition-all" style={{width: `${route.score}%`}}></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-gray-600">Durée:</div>
          <div className="font-bold">{route.duration} min</div>
        </div>
        <div>
          <div className="text-gray-600">Correspondances:</div>
          <div className="font-bold">{route.transfers}</div>
        </div>
        <div>
          <div className="text-gray-600">Marche:</div>
          <div className="font-bold">{(route.walkingDistance / 1000).toFixed(1)} km</div>
        </div>
        <div>
          <div className="text-gray-600">Congestion:</div>
          <div className="font-bold">{route.congestion}%</div>
        </div>
      </div>
    </div>
  );
}

export default function TransportOptimizerApp() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!origin || !destination) {
      setError("Veuillez saisir l'origine et la destination");
      return;
    }

    setLoading(true);
    setError("");
    setRoutes([]);
    setSelectedRoute(null);

    try {
      const geoOrigin = await fetch(`${API_URL}/api/geocode?address=${encodeURIComponent(origin)}`).then(r => {
        if (!r.ok) throw new Error('Adresse d\'origine introuvable');
        return r.json();
      });

      const geoDest = await fetch(`${API_URL}/api/geocode?address=${encodeURIComponent(destination)}`).then(r => {
        if (!r.ok) throw new Error('Adresse de destination introuvable');
        return r.json();
      });

      const optimizeResponse = await fetch(`${API_URL}/api/routes/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: geoOrigin.lat, lon: geoOrigin.lon },
          destination: { lat: geoDest.lat, lon: geoDest.lon }
        })
      });

      if (!optimizeResponse.ok) throw new Error('Erreur lors de l\'optimisation');

      const data = await optimizeResponse.json();
      const optimizedRoutes = TransportOptimizer.generateTransportRoutes(
        geoOrigin.lat, geoOrigin.lon, geoDest.lat, geoDest.lon,
        data.route, data.route.traffic, data.transportLines
      );

      setRoutes(optimizedRoutes);
      setSelectedRoute(optimizedRoutes[0]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto">
        <header className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-blue-600 p-3 rounded-xl">
              <Bus className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Transport Optimizer</h1>
              <p className="text-gray-500">Carte interactive OpenStreetMap avec routing réel</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="relative">
              <MapPin className="absolute left-3 top-3.5 w-5 h-5 text-green-500" />
              <input
                className="border-2 border-gray-200 p-3 pl-10 rounded-xl w-full focus:outline-none focus:border-blue-500"
                placeholder="Origine (ex: Casa Port, Casablanca)"
                value={origin}
                onChange={e => setOrigin(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <div className="relative">
              <MapPin className="absolute left-3 top-3.5 w-5 h-5 text-red-500" />
              <input
                className="border-2 border-gray-200 p-3 pl-10 rounded-xl w-full focus:outline-none focus:border-blue-500"
                placeholder="Destination (ex: Morocco Mall, Casablanca)"
                value={destination}
                onChange={e => setDestination(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
          </div>

          <button
            onClick={handleSearch}
            disabled={loading}
            className="w-full bg-blue-600 text-white p-4 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Calcul de l'itinéraire...
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Optimiser l'itinéraire
              </>
            )}
          </button>

          {error && (
            <div className="mt-4 bg-red-50 border-l-4 border-red-500 p-4 rounded">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <span className="text-red-700">{error}</span>
              </div>
            </div>
          )}
        </header>

        {routes.length > 0 && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="space-y-4">
              {routes.map(route => (
                <RouteCardModern
                  key={route.id}
                  route={route}
                  selected={selectedRoute?.id === route.id}
                  onClick={() => setSelectedRoute(route)}
                />
              ))}
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-2xl p-4 shadow-lg" style={{height: '500px'}}>
                <LeafletMap route={selectedRoute} allRoutes={routes} />
              </div>
              {selectedRoute && <DetailsPanel route={selectedRoute} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}