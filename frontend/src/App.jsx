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
        <p className="text-gray-400 font-medium">Sélectionnez un itinéraire pour voir la carte</p>
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

function RouteCardModern({ route, selected, onClick }) {
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
        <div className="text-xs text-gray-600 mb-2">
          Ligne: <span className="font-semibold">{route.busLines.join(", ")}</span>
        </div>
        <div className="flex items-center gap-2 text-xs mb-2">
          <span className="text-gray-600">Trafic:</span>
          <div className={`w-2 h-2 rounded-full ${getTrafficColor()}`}></div>
          <span className="font-semibold">{getTrafficText()}</span>
          <span className="text-gray-400">({route.trafficSpeed} km/h)</span>
        </div>
      </div>

      {route.alerts.length > 0 && (
        <div className="border-t pt-3 space-y-1">
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

  // ✅ LOGIQUE CORRIGÉE : Génération réaliste des étapes
  const generateDetailedSteps = () => {
    const steps = [];
    let accumulatedTime = 0;
    
    // Constantes réalistes
    const WALKING_SPEED = 80; // 80 mètres par minute (4.8 km/h)
    const TRANSFER_TIME = 3; // 3 minutes de correspondance
    
    // Calculer les distances réelles
    const totalWalkingDistance = route.walkingDistance;
    const walkToFirstStop = Math.round(totalWalkingDistance * 0.4); // 40% au début
    const walkToDestination = totalWalkingDistance - walkToFirstStop; // 60% à la fin
    
    // Calculer le temps de transport pur
    const totalTransferTime = route.transfers * TRANSFER_TIME;
    const initialWalkTime = Math.round(walkToFirstStop / WALKING_SPEED);
    const finalWalkTime = Math.round(walkToDestination / WALKING_SPEED);
    const transportTime = route.duration - totalTransferTime - initialWalkTime - finalWalkTime;
    
    // ÉTAPE 1: Marche initiale vers le premier arrêt
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

    // ÉTAPES DE TRANSPORT: Répartir le temps entre les segments
    const segmentDuration = Math.round(transportTime / route.segments.length);
    
    route.segments.forEach((segment, idx) => {
      // Nombre d'arrêts réaliste basé sur la longueur du segment
      const coordinateCount = segment.coordinates.length;
      const estimatedStops = Math.max(2, Math.round(coordinateCount / 8)); // ~1 arrêt tous les 8 points
      
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

      // Ajouter une correspondance si ce n'est pas le dernier segment
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

    // ÉTAPE FINALE: Marche vers la destination
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
      {/* Alertes en haut */}
      {route.alerts && route.alerts.length > 0 && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded">
          <div className="font-bold text-sm text-red-800 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            {route.alerts.length} alerte(s)
          </div>
          <div className="space-y-1">
            {route.alerts.map((alert, i) => (
              <div key={i} className={`text-sm flex items-start gap-2 ${alert.type === 'alert' ? 'text-red-600' : 'text-orange-600'}`}>
                <span className="mt-0.5">•</span>
                <span>{alert.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* En-tête principal */}
      <div className="flex items-center gap-3 mb-6 pb-4 border-b">
        <div className="bg-yellow-500 p-3 rounded-lg">
          <Bus className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-800">
            Itinéraire détaillé
          </h2>
          <p className="text-sm text-gray-500">Durée totale: {route.duration} min</p>
        </div>
      </div>

      {/* Métriques principales */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-500" />
          <div>
            <div className="text-lg font-bold">{route.duration} min</div>
            <div className="text-xs text-gray-500">Durée</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-gray-500" />
          <div>
            <div className="text-lg font-bold">{route.congestion}%</div>
            <div className="text-xs text-gray-500">Trafic</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Navigation className="w-5 h-5 text-gray-500" />
          <div>
            <div className="text-lg font-bold">{(route.totalDistance / 1000).toFixed(1)} km</div>
            <div className="text-xs text-gray-500">Distance</div>
          </div>
        </div>
      </div>

      {/* Détails étape par étape - Style Google Maps */}
      <div className="mb-6">
        <h3 className="font-bold text-lg mb-4">Étapes du trajet</h3>
        
        <div className="space-y-4">
          {steps.map((step, idx) => (
            <div key={idx} className="flex gap-3">
              {/* Icône et ligne */}
              <div className="flex flex-col items-center">
                {step.type === 'walk' && (
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <Navigation className="w-5 h-5 text-gray-600" />
                  </div>
                )}
                {step.type === 'transport' && (
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                    style={{ backgroundColor: step.lineColor }}
                  >
                    {step.icon === 'tram' ? (
                      <Activity className="w-5 h-5" />
                    ) : (
                      <Bus className="w-5 h-5" />
                    )}
                  </div>
                )}
                {step.type === 'transfer' && (
                  <div className="w-10 h-10 rounded-full bg-orange-200 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-orange-600" />
                  </div>
                )}
                
                {/* Ligne de connexion */}
                {idx < steps.length - 1 && (
                  <div 
                    className={`w-1 flex-1 my-1 ${
                      step.type === 'walk' ? 'border-l-2 border-dashed border-gray-300' : 'bg-gray-300'
                    }`}
                    style={{ 
                      minHeight: '40px',
                      backgroundColor: step.type === 'transport' ? step.lineColor : undefined 
                    }}
                  ></div>
                )}
              </div>

              {/* Contenu */}
              <div className="flex-1 pb-4">
                <div className="font-semibold text-gray-800">{step.description}</div>
                
                {step.type === 'walk' && (
                  <div className="text-sm text-gray-600 mt-1">
                    <div>Marche à pied • {step.duration} min • {step.distance}m</div>
                    {step.time && <div className="text-xs text-gray-500 mt-1">Heure: {step.time}</div>}
                  </div>
                )}
                
                {step.type === 'transport' && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 mb-2">
                      <div 
                        className="px-2 py-1 rounded text-xs font-bold text-white"
                        style={{ backgroundColor: step.lineColor }}
                      >
                        {step.line}
                      </div>
                      <span className="text-sm text-gray-600">{step.stops} arrêts</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        <span>{step.duration} min de trajet</span>
                      </div>
                      {step.departureTime && (
                        <div className="text-xs text-gray-500 mt-1">
                          Départ: {step.departureTime} → Arrivée: {step.arrivalTime}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {step.type === 'transfer' && (
                  <div className="text-sm text-orange-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Temps de correspondance: {step.duration} min</span>
                    {step.time && <span className="text-xs text-gray-500 ml-2">• {step.time}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Informations supplémentaires */}
      <div className="pt-6 border-t">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-gray-600">Lignes utilisées:</div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {route.lineDetails.map((line, i) => (
                <div 
                  key={i} 
                  className="px-3 py-1 rounded-full text-white text-xs font-semibold"
                  style={{ backgroundColor: line.color }}
                >
                  {line.id}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-gray-600 mb-2">Résumé:</div>
            <div className="text-sm space-y-1">
              <div>• Correspondances: <span className="font-semibold">{route.transfers}</span></div>
              <div>• Marche totale: <span className="font-semibold">{route.walkingDistance}m</span></div>
              <div>• Score: <span className="font-semibold text-blue-600">{route.score}/100</span></div>
            </div>
          </div>
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
              <p className="text-gray-500">Itinéraires optimisés avec calcul réaliste</p>
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