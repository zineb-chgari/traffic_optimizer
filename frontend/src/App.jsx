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

  static generateBestRoute(originLat, originLon, destLat, destLon, baseRoute, trafficData, transportLines) {
    const distance = baseRoute.distance;
    const baseDuration = baseRoute.duration;
    const realTraffic = trafficData.averageCongestion;
    const avgDensity = (this.calculateUrbanDensity(originLat, originLon) + this.calculateUrbanDensity(destLat, destLon)) / 2;

    const busLines = [transportLines.bus[0].id, transportLines.bus[1].id];
    const route = {
      id: 1,
      name: "Itinéraire optimal",
      subtitle: "Meilleur trajet disponible",
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
    };

    return route;
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
}

function LeafletMap({ route }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!mapRef.current) return;

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

    const defaultCenter = [33.5731, -7.5898];
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

    markersRef.current.forEach(layer => map.removeLayer(layer));
    markersRef.current = [];

    const allCoords = route.coordinates.map(c => [c[0], c[1]]);
    
    const shadowLine = window.L.polyline(allCoords, {
      color: '#000000',
      weight: 10,
      opacity: 0.2,
      smoothFactor: 1,
      offset: 2
    }).addTo(map);
    markersRef.current.push(shadowLine);

    const mainLine = window.L.polyline(allCoords, {
      color: '#FF8C00',
      weight: 8,
      opacity: 0.9,
      smoothFactor: 1,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    markersRef.current.push(mainLine);

    const startIcon = window.L.divIcon({
      className: 'custom-marker',
      html: `
        <div style="position: relative;">
          <div style="background-color: #FF8C00; width: 40px; height: 40px; border-radius: 50%; border: 4px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M5 11l1.5-4.5h11L19 11m-1.5 5a1.5 1.5 0 0 1-1.5-1.5a1.5 1.5 0 0 1 1.5-1.5a1.5 1.5 0 0 1 1.5 1.5a1.5 1.5 0 0 1-1.5 1.5m-11 0A1.5 1.5 0 0 1 5 14.5A1.5 1.5 0 0 1 6.5 13A1.5 1.5 0 0 1 8 14.5A1.5 1.5 0 0 1 6.5 16M18.92 6c-.2-.58-.76-1-1.42-1h-11c-.66 0-1.22.42-1.42 1L3 12v8a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-8z"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const startMarker = window.L.marker([route.coordinates[0][0], route.coordinates[0][1]], { 
      icon: startIcon,
      zIndexOffset: 1000 
    }).addTo(map);

    const startPopup = window.L.popup({
      closeButton: false,
      className: 'custom-popup',
      offset: [0, -20]
    }).setContent(`
      <div style="padding: 8px 12px; font-family: Arial, sans-serif;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF8C00">
            <path d="M5 11l1.5-4.5h11L19 11m-1.5 5a1.5 1.5 0 0 1-1.5-1.5a1.5 1.5 0 0 1 1.5-1.5a1.5 1.5 0 0 1 1.5 1.5a1.5 1.5 0 0 1-1.5 1.5m-11 0A1.5 1.5 0 0 1 5 14.5A1.5 1.5 0 0 1 6.5 13A1.5 1.5 0 0 1 8 14.5A1.5 1.5 0 0 1 6.5 16M18.92 6c-.2-.58-.76-1-1.42-1h-11c-.66 0-1.22.42-1.42 1L3 12v8a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-8z"/>
          </svg>
          <strong style="font-size: 14px;">Départ</strong>
        </div>
        <div style="font-size: 12px; color: #666;">${route.duration} min</div>
      </div>
    `);

    startMarker.bindPopup(startPopup).openPopup();
    markersRef.current.push(startMarker);

    const endIcon = window.L.divIcon({
      className: 'custom-marker',
      html: `
        <div style="position: relative;">
          <div style="background-color: #E91E63; width: 40px; height: 40px; border-radius: 50%; border: 4px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 40]
    });

    const endMarker = window.L.marker([
      route.coordinates[route.coordinates.length - 1][0], 
      route.coordinates[route.coordinates.length - 1][1]
    ], { 
      icon: endIcon,
      zIndexOffset: 1000 
    }).addTo(map);

    const endPopup = window.L.popup({
      closeButton: false,
      className: 'custom-popup',
      offset: [0, -45]
    }).setContent(`
      <div style="padding: 8px 12px; font-family: Arial, sans-serif;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#E91E63">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
          </svg>
          <strong style="font-size: 14px;">Arrivée</strong>
        </div>
      </div>
    `);

    endMarker.bindPopup(endPopup);
    markersRef.current.push(endMarker);

    const bounds = window.L.latLngBounds(allCoords);
    map.fitBounds(bounds, { padding: [80, 80] });
  };

  if (!route) {
    return (
      <div className="h-full bg-gradient-to-br from-blue-100 via-blue-50 to-indigo-100 rounded-lg flex items-center justify-center">
        <p className="text-gray-400 font-medium">Recherchez un itinéraire pour voir la carte</p>
      </div>
    );
  }

  return (
    <div className="relative h-full rounded-lg overflow-hidden shadow-lg">
      <div ref={mapRef} className="w-full h-full"></div>
      
      <style jsx>{`
        .custom-popup .leaflet-popup-content-wrapper {
          padding: 0;
          border-radius: 8px;
          box-shadow: 0 3px 14px rgba(0,0,0,0.3);
        }
        .custom-popup .leaflet-popup-content {
          margin: 0;
        }
        .custom-popup .leaflet-popup-tip {
          background: white;
        }
      `}</style>
    </div>
  );
}

function RouteSummaryCard({ route }) {
  const getTrafficColor = () => {
    if (route.congestion < 40) return "bg-green-500";
    if (route.congestion < 70) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getTrafficText = () => {
    if (route.congestion < 40) return "Fluide";
    if (route.congestion < 70) return "Modéré";
    return "Dense";
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">{route.name}</h3>
          <p className="text-sm text-gray-500 mt-1">{route.subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-5xl font-bold text-blue-600">{route.score}</div>
          <div className="text-xs text-gray-500">score</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="text-center p-4 bg-blue-50 rounded-xl">
          <Clock className="w-6 h-6 mx-auto text-blue-600 mb-2" />
          <div className="text-2xl font-bold text-gray-800">{route.duration}min</div>
          <div className="text-xs text-gray-500 mt-1">Durée totale</div>
        </div>
        <div className="text-center p-4 bg-purple-50 rounded-xl">
          <Bus className="w-6 h-6 mx-auto text-purple-600 mb-2" />
          <div className="text-2xl font-bold text-gray-800">{route.transfers}</div>
          <div className="text-xs text-gray-500 mt-1">Correspondance(s)</div>
        </div>
        <div className="text-center p-4 bg-green-50 rounded-xl">
          <Navigation className="w-6 h-6 mx-auto text-green-600 mb-2" />
          <div className="text-2xl font-bold text-gray-800">{route.walkingDistance}m</div>
          <div className="text-xs text-gray-500 mt-1">Marche à pied</div>
        </div>
      </div>

      <div className="border-t pt-4 mb-4">
        <div className="text-sm text-gray-600 mb-3">
          Lignes utilisées:
        </div>
        <div className="flex gap-2 flex-wrap mb-4">
          {route.lineDetails.map((line, i) => (
            <div 
              key={i} 
              className="px-4 py-2 rounded-full text-white text-sm font-semibold shadow-md"
              style={{ backgroundColor: line.color }}
            >
              {line.id} - {line.name}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-600">État du trafic:</span>
          <div className={`w-3 h-3 rounded-full ${getTrafficColor()}`}></div>
          <span className="font-semibold">{getTrafficText()}</span>
          <span className="text-gray-400">({route.trafficSpeed} km/h)</span>
        </div>
      </div>

      {route.alerts.length > 0 && (
        <div className="border-t pt-4 bg-red-50 p-4 rounded-xl">
          <div className="font-bold text-sm text-red-800 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Alertes en temps réel
          </div>
          <div className="space-y-2">
            {route.alerts.map((alert, i) => (
              <div key={i} className={`flex items-center gap-2 text-sm ${alert.type === 'alert' ? 'text-red-600' : 'text-orange-600'}`}>
                <span className="font-bold">•</span>
                <span>{alert.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailsPanel({ route }) {
  if (!route) return null;

  const generateDetailedSteps = () => {
    const steps = [];
    let accumulatedTime = 0;
    
    const WALKING_SPEED = 80;
    const TRANSFER_TIME = 3;
    
    const totalWalkingDistance = route.walkingDistance;
    const walkToFirstStop = Math.round(totalWalkingDistance * 0.4);
    const walkToDestination = totalWalkingDistance - walkToFirstStop;
    
    const totalTransferTime = route.transfers * TRANSFER_TIME;
    const initialWalkTime = Math.round(walkToFirstStop / WALKING_SPEED);
    const finalWalkTime = Math.round(walkToDestination / WALKING_SPEED);
    const transportTime = route.duration - totalTransferTime - initialWalkTime - finalWalkTime;
    
    if (walkToFirstStop > 0) {
      steps.push({
        type: 'walk',
        duration: initialWalkTime,
        distance: walkToFirstStop,
        description: "Marchez jusqu'à l'arrêt",
        icon: 'walk',
        time: `0 min`
      });
      accumulatedTime += initialWalkTime;
    }

    const segmentDuration = Math.round(transportTime / route.segments.length);
    
    route.segments.forEach((segment, idx) => {
      const coordinateCount = segment.coordinates.length;
      const estimatedStops = Math.max(2, Math.round(coordinateCount / 8));
      
      steps.push({
        type: 'transport',
        line: segment.lineId,
        lineName: segment.lineName,
        lineColor: segment.lineColor,
        duration: segmentDuration,
        stops: estimatedStops,
        description: `Prenez ${segment.lineName}`,
        icon: segment.lineName.includes('Tramway') ? 'tram' : 'bus',
        departureTime: `${accumulatedTime} min`,
        arrivalTime: `${accumulatedTime + segmentDuration} min`
      });
      accumulatedTime += segmentDuration;

      if (idx < route.segments.length - 1) {
        steps.push({
          type: 'transfer',
          duration: TRANSFER_TIME,
          description: `Correspondance - Changez vers ${route.segments[idx + 1].lineName}`,
          icon: 'transfer',
          time: `${accumulatedTime} min`
        });
        accumulatedTime += TRANSFER_TIME;
      }
    });

    if (walkToDestination > 0) {
      steps.push({
        type: 'walk',
        duration: finalWalkTime,
        distance: walkToDestination,
        description: "Marchez jusqu'à la destination",
        icon: 'walk',
        time: `${accumulatedTime} min`
      });
      accumulatedTime += finalWalkTime;
    }

    return steps;
  };

  const steps = generateDetailedSteps();

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b">
        <div className="bg-blue-600 p-3 rounded-lg">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-800">
            Itinéraire détaillé étape par étape
          </h2>
          <p className="text-sm text-gray-500">Suivez ces instructions pour votre trajet</p>
        </div>
      </div>

      <div className="space-y-4">
        {steps.map((step, idx) => (
          <div key={idx} className="flex gap-4">
            <div className="flex flex-col items-center">
              {step.type === 'walk' && (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <Navigation className="w-6 h-6 text-gray-600" />
                </div>
              )}
              {step.type === 'transport' && (
                <div 
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                  style={{ backgroundColor: step.lineColor }}
                >
                  {step.icon === 'tram' ? (
                    <Activity className="w-6 h-6" />
                  ) : (
                    <Bus className="w-6 h-6" />
                  )}
                </div>
              )}
              {step.type === 'transfer' && (
                <div className="w-12 h-12 rounded-full bg-orange-200 flex items-center justify-center flex-shrink-0">
                  <Activity className="w-6 h-6 text-orange-600" />
                </div>
              )}
              
              {idx < steps.length - 1 && (
                <div 
                  className={`w-1 flex-1 my-2 ${
                    step.type === 'walk' ? 'border-l-2 border-dashed border-gray-300' : 'bg-gray-300'
                  }`}
                  style={{ 
                    minHeight: '50px',
                    backgroundColor: step.type === 'transport' ? step.lineColor : undefined 
                  }}
                ></div>
              )}
            </div>

            <div className="flex-1 pb-6">
              <div className="font-semibold text-gray-800 text-lg mb-2">{step.description}</div>
              
              {step.type === 'walk' && (
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-sm text-gray-700 font-medium">
                    Marche à pied • {step.duration} min • {step.distance}m
                  </div>
                  {step.time && <div className="text-xs text-gray-500 mt-1">Heure de départ: {step.time}</div>}
                </div>
              )}
              
              {step.type === 'transport' && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="flex items-center gap-3 mb-3">
                    <div 
                      className="px-3 py-1 rounded-lg text-sm font-bold text-white"
                      style={{ backgroundColor: step.lineColor }}
                    >
                      {step.line}
                    </div>
                    <span className="text-sm font-medium text-gray-700">{step.stops} arrêts</span>
                  </div>
                  <div className="space-y-2 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span className="font-medium">{step.duration} min de trajet</span>
                    </div>
                    {step.departureTime && (
                      <div className="text-xs text-gray-600">
                        Départ: {step.departureTime} → Arrivée: {step.arrivalTime}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {step.type === 'transfer' && (
                <div className="bg-orange-50 p-3 rounded-lg">
                  <div className="text-sm text-orange-700 flex items-center gap-2 font-medium">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Temps de correspondance: {step.duration} min</span>
                  </div>
                  {step.time && <div className="text-xs text-gray-600 mt-1">Heure: {step.time}</div>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TransportOptimizerApp() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!origin || !destination) {
      setError("Veuillez saisir l'origine et la destination");
      return;
    }

    setLoading(true);
    setError("");
    setRoute(null);

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
      const bestRoute = TransportOptimizer.generateBestRoute(
        geoOrigin.lat, geoOrigin.lon, geoDest.lat, geoDest.lon,
        data.route, data.route.traffic, data.transportLines
      );

      setRoute(bestRoute);
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
              <p className="text-gray-500">Meilleur itinéraire optimisé pour votre trajet</p>
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
            className="w-full bg-blue-600 text-white p-4 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Recherche du meilleur itinéraire...
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Trouver le meilleur itinéraire
              </>
            )}
          </button>

          {error && (
            <div className="mt-4 bg-red-50 border-l-4 border-red-500 p-4 rounded">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <span className="text-red-700 font-medium">{error}</span>
              </div>
            </div>
          )}
        </header>

        {route && (
          <div className="space-y-6">
            <RouteSummaryCard route={route} />
            
            <div className="bg-white rounded-2xl p-4 shadow-lg" style={{height: '500px'}}>
              <LeafletMap route={route} />
            </div>
            
            <DetailsPanel route={route} />
          </div>
        )}
      </div>
    </div>
  );
}