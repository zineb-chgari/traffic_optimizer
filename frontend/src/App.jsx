import React, { useState, useEffect, useRef } from "react";
import {
  Bus,
  MapPin,
  Search,
  AlertTriangle,
  Clock,
  Navigation,
  Activity,
  TrendingUp,
  CheckCircle,
  XCircle,
  Info,
  Building,
  ArrowRight,
  Footprints,
  RefreshCw
} from "lucide-react";

const API_URL = "http://localhost:3000";

function LeafletMap({ route, origin, destination }) {
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
  }, [route, origin, destination]);

  const initMap = () => {
    if (!window.L || !mapRef.current || mapInstanceRef.current) return;

    const defaultCenter = origin ? [origin.lat, origin.lon] : [33.5731, -7.5898];
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
      smoothFactor: 1
    }).addTo(map);
    markersRef.current.push(shadowLine);

    const mainLine = window.L.polyline(allCoords, {
      color: '#3B82F6',
      weight: 6,
      opacity: 0.9,
      smoothFactor: 1,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    markersRef.current.push(mainLine);

    const startIcon = window.L.divIcon({
      className: 'custom-marker',
      html: `
        <div style="background-color: #10B981; width: 36px; height: 36px; border-radius: 50%; border: 3px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
          <div style="width: 12px; height: 12px; background: white; border-radius: 50%;"></div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const startMarker = window.L.marker([route.coordinates[0][0], route.coordinates[0][1]], { 
      icon: startIcon,
      zIndexOffset: 1000 
    }).addTo(map);
    markersRef.current.push(startMarker);

    const endIcon = window.L.divIcon({
      className: 'custom-marker',
      html: `
        <div style="background-color: #EF4444; width: 36px; height: 36px; border-radius: 50%; border: 3px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
          <div style="width: 12px; height: 12px; background: white; border-radius: 50%;"></div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const endMarker = window.L.marker([
      route.coordinates[route.coordinates.length - 1][0], 
      route.coordinates[route.coordinates.length - 1][1]
    ], { 
      icon: endIcon,
      zIndexOffset: 1000 
    }).addTo(map);
    markersRef.current.push(endMarker);

    if (route.originStop) {
      const stopIcon = window.L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="background-color: #8B5CF6; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const originStopMarker = window.L.marker([route.originStop.lat, route.originStop.lon], { 
        icon: stopIcon 
      }).addTo(map);
      originStopMarker.bindPopup(`<strong>${route.originStop.name}</strong><br/>Arrêt de départ`);
      markersRef.current.push(originStopMarker);
    }

    if (route.destStop) {
      const stopIcon = window.L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="background-color: #8B5CF6; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const destStopMarker = window.L.marker([route.destStop.lat, route.destStop.lon], { 
        icon: stopIcon 
      }).addTo(map);
      destStopMarker.bindPopup(`<strong>${route.destStop.name}</strong><br/>Arrêt d'arrivée`);
      markersRef.current.push(destStopMarker);
    }

    const bounds = window.L.latLngBounds(allCoords);
    map.fitBounds(bounds, { padding: [60, 60] });
  };

  return (
    <div className="relative h-full rounded-lg overflow-hidden shadow-lg">
      <div ref={mapRef} className="w-full h-full"></div>
    </div>
  );
}

function RouteSteps({ route }) {
  if (!route) return null;

  const steps = [];

  // Étape 1: Marche jusqu'à l'arrêt
  steps.push({
    type: 'walk',
    icon: <Footprints className="w-5 h-5 text-gray-600" />,
    title: "Marchez jusqu'à l'arrêt",
    subtitle: `Marche à pied • ${Math.round(route.originStop.walkingDuration / 60)} min (${route.originStop.walkingDistance}m)`,
    details: route.originStop.name,
    duration: route.originStop.walkingDuration,
    distance: route.originStop.walkingDistance,
    color: "bg-gray-50 border-gray-200"
  });

  // Étape 2: Prendre le transport
  const transitLines = route.routeId.split('-');
  transitLines.forEach((line, idx) => {
    steps.push({
      type: 'transit',
      icon: <Bus className="w-5 h-5 text-white" />,
      title: `Prenez ${line}`,
      subtitle: `${route.transfers > 0 && idx < transitLines.length - 1 ? (transitLines.length - idx - 1) + ' arrêt(s)' : Math.round(route.transitDuration / 60) + ' min de trajet'}`,
      details: `De ${idx === 0 ? route.originStop.name : 'Arrêt de correspondance'} à ${idx === transitLines.length - 1 ? route.destStop.name : 'Arrêt de correspondance'}`,
      duration: route.transitDuration / transitLines.length,
      color: "bg-red-500 text-white",
      lineColor: "border-red-500",
      badgeText: line
    });

    // Ajouter correspondance si nécessaire
    if (idx < transitLines.length - 1) {
      steps.push({
        type: 'transfer',
        icon: <RefreshCw className="w-5 h-5 text-orange-600" />,
        title: "Correspondance - Changez de ligne",
        subtitle: `⚠️ Temps de correspondance: 3 min`,
        details: `Changez vers ${transitLines[idx + 1]}`,
        duration: 180,
        color: "bg-orange-50 border-orange-300"
      });
    }
  });

  // Étape finale: Marche jusqu'à la destination
  steps.push({
    type: 'walk',
    icon: <Footprints className="w-5 h-5 text-gray-600" />,
    title: "Marchez jusqu'à la destination",
    subtitle: `Marche à pied • ${Math.round(route.destStop.walkingDuration / 60)} min (${route.destStop.walkingDistance}m)`,
    details: "Arrivée à destination",
    duration: route.destStop.walkingDuration,
    distance: route.destStop.walkingDistance,
    color: "bg-gray-50 border-gray-200"
  });

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
        <Navigation className="w-5 h-5 text-blue-600" />
        Itinéraire détaillé
      </h2>

      <div className="space-y-3">
        {steps.map((step, index) => (
          <div key={index} className="flex gap-3">
            {/* Timeline */}
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step.color} ${step.lineColor ? 'border-2 ' + step.lineColor : 'border-2'} shadow-sm`}>
                {step.icon}
              </div>
              {index < steps.length - 1 && (
                <div className={`w-0.5 h-12 ${step.type === 'transit' ? 'bg-red-300' : 'bg-gray-300'} my-1`}></div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-bold text-gray-800 flex items-center gap-2">
                    {step.title}
                    {step.badgeText && (
                      <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded">
                        {step.badgeText}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5">{step.subtitle}</div>
                  <div className="text-xs text-gray-500 mt-1">{step.details}</div>
                </div>
                
                {step.duration && (
                  <div className="text-right ml-4">
                    <div className="text-sm font-bold text-gray-700">
                      {Math.round(step.duration / 60)} min
                    </div>
                    {step.distance && (
                      <div className="text-xs text-gray-500">{step.distance}m</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Résumé total */}
      <div className="mt-6 pt-4 border-t grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-blue-600">{Math.round(route.totalDuration / 60)}</div>
          <div className="text-xs text-gray-600">minutes total</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-600">{route.transfers}</div>
          <div className="text-xs text-gray-600">correspondance(s)</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-purple-600">{route.totalWalkingDistance}m</div>
          <div className="text-xs text-gray-600">marche total</div>
        </div>
      </div>
    </div>
  );
}

function RouteCard({ route, selected, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl p-4 cursor-pointer transition-all border-2 ${
        selected ? "border-blue-500 shadow-xl" : "border-gray-200 hover:border-blue-300 hover:shadow-lg"
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-base font-bold text-gray-800">{route.type} Route</h3>
          <p className="text-xs text-gray-500">via {route.routeId}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-blue-600">{route.score}</div>
          <div className="text-xs text-gray-500">score</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div>
          <Clock className="w-4 h-4 mx-auto text-gray-400 mb-1" />
          <div className="text-base font-bold">{Math.round(route.totalDuration / 60)}min</div>
          <div className="text-xs text-gray-500">Durée</div>
        </div>
        <div>
          <Bus className="w-4 h-4 mx-auto text-gray-400 mb-1" />
          <div className="text-base font-bold">{route.transfers}</div>
          <div className="text-xs text-gray-500">Corresp.</div>
        </div>
        <div>
          <Navigation className="w-4 h-4 mx-auto text-gray-400 mb-1" />
          <div className="text-base font-bold">{route.totalWalkingDistance}m</div>
          <div className="text-xs text-gray-500">Marche</div>
        </div>
      </div>

      <div className="border-t pt-2 text-xs space-y-1">
        <div className="flex items-center gap-1 text-gray-600">
          <CheckCircle className="w-3 h-3 text-green-500" />
          <span>Transit: {Math.round(route.transitDistance / 1000 * 10) / 10}km</span>
        </div>
        <div className="flex items-center gap-1 text-gray-600">
          <Activity className="w-3 h-3 text-blue-500" />
          <span>Source: {route.source}</span>
        </div>
      </div>
    </div>
  );
}

function DensityInfo({ density, label }) {
  if (!density) return null;

  const getColor = () => {
    if (density.densityScore > 70) return "text-red-600";
    if (density.densityScore > 40) return "text-yellow-600";
    return "text-green-600";
  };

  return (
    <div className="bg-white rounded-lg p-4 shadow">
      <div className="flex items-center gap-2 mb-3">
        <Building className="w-5 h-5 text-gray-600" />
        <h3 className="font-bold text-gray-800">Densité - {label}</h3>
      </div>
      
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-gray-600">Score</div>
          <div className={`text-2xl font-bold ${getColor()}`}>{density.densityScore}/100</div>
        </div>
        <div>
          <div className="text-gray-600">Type</div>
          <div className="font-semibold capitalize">{density.interpretation}</div>
        </div>
        <div>
          <div className="text-gray-600">Bâtiments</div>
          <div className="font-bold">{density.buildings}</div>
        </div>
        <div>
          <div className="text-gray-600">Commodités</div>
          <div className="font-bold">{density.amenities + density.shops}</div>
        </div>
      </div>
      
      <div className="mt-3 text-xs text-gray-500 border-t pt-2">
        Source: {density.source} (rayon: {density.radius}m)
      </div>
    </div>
  );
}

function AnomaliesPanel({ anomalies, warnings }) {
  if (!anomalies?.length && !warnings?.length) return null;

  return (
    <div className="bg-white rounded-lg p-4 shadow space-y-3">
      <h3 className="font-bold text-gray-800 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-orange-500" />
        Détection d'Anomalies
      </h3>

      {anomalies?.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-red-600">Anomalies Critiques:</div>
          {anomalies.map((anomaly, i) => (
            <div key={i} className="flex gap-2 text-sm bg-red-50 p-2 rounded">
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-red-700">{anomaly.type}</div>
                <div className="text-red-600">{anomaly.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {warnings?.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-orange-600">Avertissements:</div>
          {warnings.map((warning, i) => (
            <div key={i} className="flex gap-2 text-sm bg-orange-50 p-2 rounded">
              <Info className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
              <div className="text-orange-700">{warning.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetadataPanel({ metadata }) {
  if (!metadata) return null;

  return (
    <div className="bg-white rounded-lg p-4 shadow">
      <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-blue-500" />
        Métadonnées
      </h3>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Arrêts trouvés:</span>
          <span className="font-bold">{metadata.totalStopsFound}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Arrêts accessibles (origine):</span>
          <span className="font-bold">{metadata.accessibleOriginStops}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Arrêts accessibles (dest.):</span>
          <span className="font-bold">{metadata.accessibleDestStops}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Routes calculées:</span>
          <span className="font-bold">{metadata.routesCalculated}</span>
        </div>
        <div className="border-t pt-2 mt-2">
          <div className="text-xs text-gray-500">Source: {metadata.dataSource}</div>
          <div className="text-xs text-gray-400">{new Date(metadata.timestamp).toLocaleString()}</div>
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
  const [result, setResult] = useState(null);

  const handleSearch = async () => {
    if (!origin || !destination) {
      setError("Veuillez saisir l'origine et la destination");
      return;
    }

    setLoading(true);
    setError("");
    setRoutes([]);
    setSelectedRoute(null);
    setResult(null);

    try {
      const response = await fetch(`${API_URL}/api/routes/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination }
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Erreur lors de l\'optimisation');
      }

      const data = await response.json();
      
      if (data.routes && data.routes.length > 0) {
        setRoutes(data.routes);
        setSelectedRoute(data.routes[0]);
      }
      
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto">
        <header className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-blue-600 p-3 rounded-xl">
              <Bus className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Transport Optimizer</h1>
              <p className="text-sm text-gray-600">Itinéraires en temps réel avec détails</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-5 h-5 text-green-500" />
              <input
                className="border-2 border-gray-200 p-2.5 pl-10 rounded-lg w-full focus:outline-none focus:border-blue-500 text-sm"
                placeholder="Origine (ex: Casa Port, Casablanca)"
                value={origin}
                onChange={e => setOrigin(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-5 h-5 text-red-500" />
              <input
                className="border-2 border-gray-200 p-2.5 pl-10 rounded-lg w-full focus:outline-none focus:border-blue-500 text-sm"
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
            className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2 text-sm"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Calcul en cours...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Calculer l'itinéraire
              </>
            )}
          </button>

          {error && (
            <div className="mt-3 bg-red-50 border-l-4 border-red-500 p-3 rounded">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <span className="text-sm text-red-700">{error}</span>
              </div>
            </div>
          )}
        </header>

        {result && (
          <div className="grid lg:grid-cols-4 gap-4">
            <div className="space-y-4">
              {routes.length > 0 ? (
                routes.map((route, idx) => (
                  <RouteCard
                    key={idx}
                    route={route}
                    selected={selectedRoute === route}
                    onClick={() => setSelectedRoute(route)}
                  />
                ))
              ) : (
                <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-600" />
                    <span className="text-sm text-yellow-700">Aucun itinéraire trouvé</span>
                  </div>
                </div>
              )}

              <AnomaliesPanel 
                anomalies={result.anomalies} 
                warnings={result.warnings} 
              />

              <MetadataPanel metadata={result.metadata} />
            </div>

            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-xl p-4 shadow-lg" style={{height: '450px'}}>
                <LeafletMap 
                  route={selectedRoute} 
                  origin={result.origin}
                  destination={result.destination}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <DensityInfo density={result.origin?.density} label="Origine" />
                <DensityInfo density={result.destination?.density} label="Destination" />
              </div>

              {selectedRoute && <RouteSteps route={selectedRoute} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}