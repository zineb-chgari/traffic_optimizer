import React, { useState, useEffect, useRef } from "react";
import {
  Bus,
  MapPin,
  Search,
  AlertTriangle,
  Clock,
  Navigation,
  Activity,
  CheckCircle,
  Info,
  Footprints,
  RefreshCw,
  Zap,
  Users,
  Building2
} from "lucide-react";

const API_URL = "http://localhost:3000";
const TOMTOM_API_KEY = "YOUR_API_KEY_HERE"; // À remplacer par variable d'environnement

function TomTomMap({ route, origin, destination }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!document.getElementById('tomtom-sdk-css')) {
      const link = document.createElement('link');
      link.id = 'tomtom-sdk-css';
      link.rel = 'stylesheet';
      link.href = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css';
      document.head.appendChild(link);
    }

    if (!window.tt) {
      const script = document.createElement('script');
      script.src = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js';
      script.onload = () => initMap();
      document.body.appendChild(script);
    } else {
      initMap();
    }
  }, []);

  useEffect(() => {
    if (window.tt && mapInstanceRef.current && route) {
      updateMap();
    }
  }, [route, origin, destination]);

  const initMap = () => {
    if (!window.tt || !mapRef.current || mapInstanceRef.current) return;

    const defaultCenter = origin ? [origin.lon, origin.lat] : [-7.5898, 33.5731];
    
    const map = window.tt.map({
      key: TOMTOM_API_KEY,
      container: mapRef.current,
      center: defaultCenter,
      zoom: 13,
      style: 'https://api.tomtom.com/style/2/custom/style/dG9tdG9tQEBAeW91cl9rZXk7Y3VzdG9tX3N0eWxl.json?key=' + TOMTOM_API_KEY
    });

    mapInstanceRef.current = map;

    if (route) {
      updateMap();
    }
  };

  const updateMap = () => {
    const map = mapInstanceRef.current;
    if (!map || !route) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    const coordinates = route.coordinates.map(c => [c[1], c[0]]);
    
    const geojson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coordinates
        },
        properties: {}
      }]
    };

    if (map.getLayer('route-line')) {
      map.removeLayer('route-line');
      map.removeSource('route-data');
    }

    map.addSource('route-data', {
      type: 'geojson',
      data: geojson
    });

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route-data',
      paint: {
        'line-color': '#3B82F6',
        'line-width': 6,
        'line-opacity': 0.9
      }
    });

    const startMarker = new window.tt.Marker({
      color: '#10B981',
      draggable: false
    })
      .setLngLat([route.coordinates[0][1], route.coordinates[0][0]])
      .addTo(map);
    markersRef.current.push(startMarker);

    const endMarker = new window.tt.Marker({
      color: '#EF4444',
      draggable: false
    })
      .setLngLat([
        route.coordinates[route.coordinates.length - 1][1],
        route.coordinates[route.coordinates.length - 1][0]
      ])
      .addTo(map);
    markersRef.current.push(endMarker);

    if (route.originStop) {
      const originStopMarker = new window.tt.Marker({
        color: '#8B5CF6',
        draggable: false
      })
        .setLngLat([route.originStop.lon, route.originStop.lat])
        .setPopup(new window.tt.Popup().setHTML(`<strong>${route.originStop.name}</strong><br/>Arrêt de départ`))
        .addTo(map);
      markersRef.current.push(originStopMarker);
    }

    if (route.destStop) {
      const destStopMarker = new window.tt.Marker({
        color: '#8B5CF6',
        draggable: false
      })
        .setLngLat([route.destStop.lon, route.destStop.lat])
        .setPopup(new window.tt.Popup().setHTML(`<strong>${route.destStop.name}</strong><br/>Arrêt d'arrivée`))
        .addTo(map);
      markersRef.current.push(destStopMarker);
    }

    const bounds = new window.tt.LngLatBounds();
    coordinates.forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, { padding: 60 });
  };

  return (
    <div className="relative h-full rounded-lg overflow-hidden shadow-lg">
      <div ref={mapRef} className="w-full h-full"></div>
      <div className="absolute top-4 right-4 bg-white px-3 py-1 rounded shadow text-xs font-semibold text-gray-700">
        Powered by TomTom
      </div>
    </div>
  );
}

function DensityIndicator({ density }) {
  if (!density) return null;

  const getColor = (type) => {
    const colors = {
      'urban': 'text-red-600 bg-red-50',
      'suburban': 'text-orange-600 bg-orange-50',
      'rural': 'text-green-600 bg-green-50'
    };
    return colors[type] || 'text-gray-600 bg-gray-50';
  };

  const getIcon = (type) => {
    return type === 'urban' ? <Building2 className="w-4 h-4" /> : <Users className="w-4 h-4" />;
  };

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${getColor(density.zoneType)}`}>
      {getIcon(density.zoneType)}
      <span>Densité: {density.urbanScore}/100</span>
    </div>
  );
}

function RouteSteps({ route }) {
  if (!route) return null;

  const steps = [];

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

  if (route.routeSegments && route.routeSegments.length > 0) {
    route.routeSegments.forEach((segment, idx) => {
      steps.push({
        type: 'transit',
        icon: <Bus className="w-5 h-5 text-white" />,
        title: `Prenez ${segment.line}`,
        subtitle: `${Math.round(segment.duration / 60)} min de trajet`,
        details: `De ${segment.from} à ${segment.to}`,
        duration: segment.duration,
        color: "bg-blue-500 text-white",
        lineColor: "border-blue-500",
        badgeText: segment.line
      });

      if (idx < route.routeSegments.length - 1) {
        steps.push({
          type: 'transfer',
          icon: <RefreshCw className="w-5 h-5 text-orange-600" />,
          title: "Correspondance",
          subtitle: `Changez de ligne (3 min)`,
          details: `Vers ${route.routeSegments[idx + 1].line}`,
          duration: 180,
          color: "bg-orange-50 border-orange-300"
        });
      }
    });
  } else {
    const transitLines = route.routeId.split('-');
    transitLines.forEach((line, idx) => {
      steps.push({
        type: 'transit',
        icon: <Bus className="w-5 h-5 text-white" />,
        title: `Prenez ${line}`,
        subtitle: `${Math.round(route.transitDuration / 60)} min de trajet`,
        details: `De ${idx === 0 ? route.originStop.name : 'Arrêt de correspondance'} à ${idx === transitLines.length - 1 ? route.destStop.name : 'Arrêt de correspondance'}`,
        duration: route.transitDuration / transitLines.length,
        color: "bg-blue-500 text-white",
        lineColor: "border-blue-500",
        badgeText: line
      });

      if (idx < transitLines.length - 1) {
        steps.push({
          type: 'transfer',
          icon: <RefreshCw className="w-5 h-5 text-orange-600" />,
          title: "Correspondance",
          subtitle: `Changez de ligne (3 min)`,
          details: `Vers ${transitLines[idx + 1]}`,
          duration: 180,
          color: "bg-orange-50 border-orange-300"
        });
      }
    });
  }

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
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step.color} ${step.lineColor ? 'border-2 ' + step.lineColor : 'border-2'} shadow-sm`}>
                {step.icon}
              </div>
              {index < steps.length - 1 && (
                <div className={`w-0.5 h-12 ${step.type === 'transit' ? 'bg-blue-300' : 'bg-gray-300'} my-1`}></div>
              )}
            </div>

            <div className="flex-1 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-bold text-gray-800 flex items-center gap-2">
                    {step.title}
                    {step.badgeText && (
                      <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded">
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

      <div className="mt-6 pt-4 border-t grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-blue-600">{Math.round(route.totalDuration / 60)}</div>
          <div className="text-xs text-gray-600">minutes</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-600">{route.transfers}</div>
          <div className="text-xs text-gray-600">correspondance(s)</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-purple-600">{route.totalWalkingDistance}m</div>
          <div className="text-xs text-gray-600">marche</div>
        </div>
      </div>

      {route.trafficDelay > 0 && (
        <div className="mt-4 bg-orange-50 border-l-4 border-orange-500 p-3 rounded">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-600" />
            <span className="text-sm text-orange-700">
              Retard dû au trafic: {Math.round(route.trafficDelay / 60)} min
            </span>
          </div>
        </div>
      )}
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
          <h3 className="text-base font-bold text-gray-800">{route.type}</h3>
          <p className="text-xs text-gray-500">Ligne {route.routeId}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-blue-600">{route.score}</div>
          <div className="text-xs text-gray-500">score</div>
        </div>
      </div>

      {route.densityAnalysis && (
        <div className="mb-3">
          <DensityIndicator density={route.densityAnalysis} />
        </div>
      )}

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
          <span>Distance: {Math.round(route.transitDistance / 1000 * 10) / 10}km</span>
        </div>
        {route.trafficDelay > 0 && (
          <div className="flex items-center gap-1 text-orange-600">
            <Zap className="w-3 h-3" />
            <span>Retard trafic: +{Math.round(route.trafficDelay / 60)}min</span>
          </div>
        )}
        <div className="flex items-center gap-1 text-gray-600">
          <Activity className="w-3 h-3 text-blue-500" />
          <span>Optimisé selon densité urbaine</span>
        </div>
      </div>
    </div>
  );
}

function TrafficInfo({ traffic, label, density }) {
  if (!traffic) return null;

  return (
    <div className="bg-white rounded-lg p-4 shadow">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-5 h-5 text-orange-600" />
        <h3 className="font-bold text-gray-800">Trafic - {label}</h3>
      </div>
      
      {density && (
        <div className="mb-3">
          <DensityIndicator density={density} />
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-gray-600">Vitesse actuelle</div>
          <div className="text-2xl font-bold text-orange-600">{traffic.currentSpeed} km/h</div>
        </div>
        <div>
          <div className="text-gray-600">Vitesse libre</div>
          <div className="text-2xl font-bold text-green-600">{traffic.freeFlowSpeed} km/h</div>
        </div>
        <div>
          <div className="text-gray-600">Fiabilité</div>
          <div className="font-bold">{Math.round(traffic.confidence * 100)}%</div>
        </div>
        <div>
          <div className="text-gray-600">Route fermée</div>
          <div className="font-bold">{traffic.roadClosure ? 'Oui' : 'Non'}</div>
        </div>
      </div>
    </div>
  );
}

function WarningsPanel({ warnings }) {
  if (!warnings?.length) return null;

  return (
    <div className="bg-white rounded-lg p-4 shadow space-y-3">
      <h3 className="font-bold text-gray-800 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-orange-500" />
        Avertissements
      </h3>

      <div className="space-y-2">
        {warnings.map((warning, i) => (
          <div key={i} className="flex gap-2 text-sm bg-orange-50 p-2 rounded">
            <Info className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
            <div className="text-orange-700">{warning.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetadataPanel({ metadata }) {
  if (!metadata) return null;

  return (
    <div className="bg-white rounded-lg p-4 shadow">
      <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
        <Activity className="w-5 h-5 text-blue-500" />
        Statistiques
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
          <div className="text-xs text-gray-500">{metadata.dataSource}</div>
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
      } else {
        setError("Aucun itinéraire trouvé. Essayez des adresses différentes.");
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
              <p className="text-sm text-gray-600">Optimisation basée sur densité urbaine & trafic temps réel</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-5 h-5 text-green-500" />
              <input
                className="border-2 border-gray-200 p-2.5 pl-10 rounded-lg w-full focus:outline-none focus:border-blue-500 text-sm"
                placeholder="Origine (ex: Casa Voyageurs, Casablanca)"
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
                Analyse de densité urbaine en cours...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Calculer l'itinéraire optimal
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
                    <span className="text-sm text-yellow-700">Aucun itinéraire disponible</span>
                  </div>
                </div>
              )}

              <WarningsPanel warnings={result.warnings} />
              <MetadataPanel metadata={result.metadata} />
            </div>

            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-xl p-4 shadow-lg" style={{height: '450px'}}>
                <TomTomMap 
                  route={selectedRoute} 
                  origin={result.origin}
                  destination={result.destination}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <TrafficInfo 
                  traffic={result.origin?.traffic} 
                  label="Origine" 
                  density={result.origin?.density}
                />
                <TrafficInfo 
                  traffic={result.destination?.traffic} 
                  label="Destination"
                  density={result.destination?.density}
                />
              </div>

              {selectedRoute && <RouteSteps route={selectedRoute} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}