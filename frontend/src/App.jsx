import React, { useState, useEffect } from "react";
import {
  Bus,
  MapPin,
  Search,
  AlertTriangle,
  Clock,
  Navigation,
  TrendingUp,
  Users,
  Activity,
  Zap,
  Info
} from "lucide-react";

const API_URL = "http://localhost:3000";

// ==================== SERVICE D'OPTIMISATION ====================
class TransportOptimizer {
  // Simule la densité urbaine basée sur les coordonnées
  static calculateUrbanDensity(lat, lon) {
    // Zones à haute densité à Casablanca (centres urbains)
    const highDensityZones = [
      { lat: 33.5731, lon: -7.5898, radius: 0.02, name: "Centre-ville" },
      { lat: 33.5892, lon: -7.6039, radius: 0.015, name: "Maarif" },
      { lat: 33.6016, lon: -7.6322, radius: 0.012, name: "Ain Diab" }
    ];

    let density = 30; // Densité de base
    
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

  // Simule le trafic en fonction de l'heure et de la zone
  static calculateTraffic(lat, lon) {
    const hour = new Date().getHours();
    let traffic = 20; // Trafic de base

    // Heures de pointe
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      traffic += 50;
    } else if (hour >= 12 && hour <= 14) {
      traffic += 30;
    }

    // Zones à fort trafic
    const density = this.calculateUrbanDensity(lat, lon);
    traffic += density * 0.3;

    return Math.min(100, Math.round(traffic));
  }

  // Génère des itinéraires de transport public optimisés
  static generateTransportRoutes(originLat, originLon, destLat, destLon, baseRoute) {
    const routes = [];
    const distance = baseRoute.distance;
    const baseDuration = baseRoute.duration;

    // Densité et trafic moyens sur l'itinéraire
    const avgDensity = (
      this.calculateUrbanDensity(originLat, originLon) +
      this.calculateUrbanDensity(destLat, destLon)
    ) / 2;

    const avgTraffic = (
      this.calculateTraffic(originLat, originLon) +
      this.calculateTraffic(destLat, destLon)
    ) / 2;

    // Route 1: Bus direct (rapide mais peut être bondé)
    routes.push({
      id: 1,
      name: "Bus Direct",
      type: "BUS_DIRECT",
      coordinates: baseRoute.coordinates,
      duration: Math.round(baseDuration / 60 * 1.3), // +30% car arrêts
      transfers: 0,
      walkingDistance: Math.round(distance * 0.05), // 5% à pied
      totalDistance: Math.round(distance),
      busLines: ["M1", "L20"],
      crowdLevel: Math.min(100, avgDensity + avgTraffic * 0.3),
      trafficImpact: avgTraffic,
      urbanDensity: avgDensity,
      score: this.calculateScore(baseDuration / 60 * 1.3, 0, distance * 0.05, avgDensity, avgTraffic),
      advantages: ["Pas de correspondance", "Itinéraire direct"],
      disadvantages: avgTraffic > 60 ? ["Trafic élevé aux heures de pointe"] : []
    });

    // Route 2: Tramway + Bus (plus fiable) - itinéraire légèrement différent
    const tramRoute = this.generateAlternativeRoute(baseRoute.coordinates, 0.08);
    routes.push({
      id: 2,
      name: "Tramway + Bus",
      type: "TRAM_BUS",
      coordinates: tramRoute,
      duration: Math.round(baseDuration / 60 * 1.5),
      transfers: 1,
      walkingDistance: Math.round(distance * 0.08),
      totalDistance: Math.round(distance * 1.1), // 10% plus long
      busLines: ["T1", "M3"],
      crowdLevel: Math.min(100, avgDensity * 0.8),
      trafficImpact: Math.round(avgTraffic * 0.7), // Tramway moins affecté
      urbanDensity: avgDensity,
      score: this.calculateScore(baseDuration / 60 * 1.5, 1, distance * 0.08, avgDensity, avgTraffic * 0.7),
      advantages: ["Moins affecté par le trafic", "Plus confortable"],
      disadvantages: ["Une correspondance"]
    });

    // Route 3: Multi-bus (économique) - itinéraire plus indirect
    const multiRoute = this.generateAlternativeRoute(baseRoute.coordinates, 0.12);
    routes.push({
      id: 3,
      name: "Multi-Bus Économique",
      type: "MULTI_BUS",
      coordinates: multiRoute,
      duration: Math.round(baseDuration / 60 * 1.8),
      transfers: 2,
      walkingDistance: Math.round(distance * 0.12),
      totalDistance: Math.round(distance * 1.2), // 20% plus long
      busLines: ["L10", "M5", "L32"],
      crowdLevel: Math.min(100, avgDensity * 0.6),
      trafficImpact: avgTraffic,
      urbanDensity: avgDensity,
      score: this.calculateScore(baseDuration / 60 * 1.8, 2, distance * 0.12, avgDensity * 0.6, avgTraffic),
      advantages: ["Tarif réduit", "Moins de monde"],
      disadvantages: ["Plusieurs correspondances", "Plus long"]
    });

    return routes.sort((a, b) => b.score - a.score);
  }

  static calculateScore(duration, transfers, walking, density, traffic) {
    let score = 100;
    score -= duration * 0.8; // Pénalité durée
    score -= transfers * 8; // Pénalité correspondances
    score -= (walking / 100) * 2; // Pénalité marche
    score -= (density / 100) * 5; // Pénalité densité
    score -= (traffic / 100) * 10; // Pénalité trafic
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  static generateAlternativeRoute(baseCoords, deviation) {
    const newCoords = [];
    
    for (let i = 0; i < baseCoords.length; i++) {
      const coord = baseCoords[i];
      
      if (i === 0 || i === baseCoords.length - 1) {
        // Garder les points de départ et d'arrivée identiques
        newCoords.push(coord);
      } else {
        // Ajouter une déviation contrôlée pour les points intermédiaires
        const ratio = i / (baseCoords.length - 1);
        const devFactor = Math.sin(ratio * Math.PI) * deviation;
        
        // Alterner la direction de déviation pour créer un tracé réaliste
        const direction = i % 2 === 0 ? 1 : -1;
        
        newCoords.push([
          coord[0] + direction * devFactor * 0.8,
          coord[1] + direction * devFactor
        ]);
      }
    }
    
    return newCoords;
  }
}

// ==================== CARTE AMÉLIORÉE ====================
function EnhancedMap({ route, allRoutes, selectedRouteId }) {
  if (!route) {
    return (
      <div className="h-96 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg flex items-center justify-center border-2 border-dashed border-blue-200">
        <div className="text-center">
          <MapPin className="w-16 h-16 mx-auto text-blue-300 mb-3" />
          <p className="text-gray-500 font-medium">Aucun itinéraire sélectionné</p>
          <p className="text-sm text-gray-400 mt-1">Lancez une recherche pour voir les options</p>
        </div>
      </div>
    );
  }

  const width = 800;
  const height = 500;
  const padding = 60;

  const allCoords = allRoutes.flatMap(r => r.coordinates);
  const lats = allCoords.map(c => c[0]);
  const lons = allCoords.map(c => c[1]);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const latRange = maxLat - minLat || 0.01;
  const lonRange = maxLon - minLon || 0.01;

  const toPixel = (lat, lon) => ({
    x: padding + ((lon - minLon) / lonRange) * (width - 2 * padding),
    y: padding + ((maxLat - lat) / latRange) * (height - 2 * padding)
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg shadow-inner">
      {/* Grille de fond */}
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e0e7ff" strokeWidth="0.5"/>
        </pattern>
      </defs>
      <rect width={width} height={height} fill="url(#grid)" />

      {/* Toutes les routes en arrière-plan */}
      {allRoutes.map((r, idx) => {
        const points = r.coordinates.map(c => {
          const p = toPixel(c[0], c[1]);
          return `${p.x},${p.y}`;
        }).join(" ");

        const isSelected = r.id === selectedRouteId;
        
        return (
          <polyline
            key={idx}
            points={points}
            fill="none"
            stroke={isSelected ? "#2563eb" : "#cbd5e1"}
            strokeWidth={isSelected ? "6" : "3"}
            opacity={isSelected ? "1" : "0.3"}
            strokeLinecap="round"
          />
        );
      })}

      {/* Points de départ et arrivée */}
      {route.coordinates.length > 0 && (
        <>
          <circle
            {...toPixel(route.coordinates[0][0], route.coordinates[0][1])}
            r="12"
            fill="#16a34a"
            stroke="white"
            strokeWidth="3"
          />
          <circle
            {...toPixel(
              route.coordinates[route.coordinates.length - 1][0],
              route.coordinates[route.coordinates.length - 1][1]
            )}
            r="12"
            fill="#dc2626"
            stroke="white"
            strokeWidth="3"
          />
        </>
      )}

      {/* Légende */}
      <g transform="translate(20, 20)">
        <rect width="160" height="70" fill="white" rx="8" opacity="0.95" />
        <circle cx="20" cy="20" r="6" fill="#16a34a" />
        <text x="35" y="25" fontSize="12" fill="#374151">Origine</text>
        <circle cx="20" cy="45" r="6" fill="#dc2626" />
        <text x="35" y="50" fontSize="12" fill="#374151">Destination</text>
      </g>
    </svg>
  );
}

// ==================== CARTE ITINÉRAIRE AMÉLIORÉE ====================
function RouteCard({ route, selected, onClick }) {
  const getCrowdColor = (level) => {
    if (level < 40) return "text-green-600 bg-green-50";
    if (level < 70) return "text-orange-600 bg-orange-50";
    return "text-red-600 bg-red-50";
  };

  const getTrafficColor = (level) => {
    if (level < 40) return "text-green-600";
    if (level < 70) return "text-orange-600";
    return "text-red-600";
  };

  return (
    <div
      onClick={onClick}
      className={`border-2 rounded-xl p-5 cursor-pointer transition-all transform hover:scale-105 ${
        selected 
          ? "border-blue-600 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-lg" 
          : "border-gray-200 bg-white hover:border-blue-300 shadow"
      }`}
    >
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-bold text-lg">{route.name}</h3>
          <div className="flex gap-1 mt-1">
            {route.busLines.map((line, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-semibold">
                {line}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-blue-600">{route.score}</div>
          <div className="text-xs text-gray-500">Score</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center">
          <Clock className="mx-auto w-5 h-5 text-gray-600 mb-1" />
          <div className="text-lg font-bold">{route.duration} min</div>
          <div className="text-xs text-gray-500">Durée</div>
        </div>
        <div className="text-center">
          <Bus className="mx-auto w-5 h-5 text-gray-600 mb-1" />
          <div className="text-lg font-bold">{route.transfers}</div>
          <div className="text-xs text-gray-500">Corresp.</div>
        </div>
        <div className="text-center">
          <Navigation className="mx-auto w-5 h-5 text-gray-600 mb-1" />
          <div className="text-lg font-bold">{route.walkingDistance}m</div>
          <div className="text-xs text-gray-500">À pied</div>
        </div>
      </div>

      {/* Indicateurs intelligents */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600 flex items-center gap-1">
            <Users className="w-4 h-4" /> Affluence
          </span>
          <span className={`font-semibold px-2 py-1 rounded ${getCrowdColor(route.crowdLevel)}`}>
            {route.crowdLevel < 40 ? "Faible" : route.crowdLevel < 70 ? "Moyenne" : "Élevée"}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600 flex items-center gap-1">
            <Activity className="w-4 h-4" /> Trafic
          </span>
          <span className={`font-semibold ${getTrafficColor(route.trafficImpact)}`}>
            {route.trafficImpact < 40 ? "Fluide" : route.trafficImpact < 70 ? "Modéré" : "Dense"}
          </span>
        </div>
      </div>

      {/* Avantages/Inconvénients */}
      <div className="border-t pt-3 space-y-2">
        {route.advantages.map((adv, i) => (
          <div key={i} className="text-xs text-green-700 flex items-start gap-1">
            <span className="text-green-500">✓</span> {adv}
          </div>
        ))}
        {route.disadvantages.map((dis, i) => (
          <div key={i} className="text-xs text-orange-700 flex items-start gap-1">
            <span className="text-orange-500">⚠</span> {dis}
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== COMPOSANT PRINCIPAL ====================
export default function TransportOptimizerApp() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const handleSearch = async () => {
    if (!origin || !destination) {
      setError("Veuillez saisir l'origine et la destination");
      return;
    }

    setLoading(true);
    setAnalyzing(true);
    setError("");
    setRoutes([]);
    setSelectedRoute(null);

    try {
      const geoOrigin = await fetch(
        `${API_URL}/api/geocode?address=${encodeURIComponent(origin)}`
      ).then(r => {
        if (!r.ok) throw new Error('Adresse d\'origine introuvable');
        return r.json();
      });

      const geoDest = await fetch(
        `${API_URL}/api/geocode?address=${encodeURIComponent(destination)}`
      ).then(r => {
        if (!r.ok) throw new Error('Adresse de destination introuvable');
        return r.json();
      });

      // Simulation d'analyse (pour le feedback visuel)
      await new Promise(resolve => setTimeout(resolve, 1000));

      const optimizeResponse = await fetch(`${API_URL}/api/routes/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: geoOrigin.lat, lon: geoOrigin.lon },
          destination: { lat: geoDest.lat, lon: geoDest.lon }
        })
      });

      if (!optimizeResponse.ok) {
        throw new Error('Erreur lors de l\'optimisation');
      }

      const data = await optimizeResponse.json();

      // Génère les itinéraires optimisés
      const optimizedRoutes = TransportOptimizer.generateTransportRoutes(
        geoOrigin.lat,
        geoOrigin.lon,
        geoDest.lat,
        geoDest.lon,
        data.route
      );

      setRoutes(optimizedRoutes);
      setSelectedRoute(optimizedRoutes[0]);
    } catch (err) {
      setError(err.message);
      console.error('Erreur:', err);
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* HEADER */}
      <header className="bg-white shadow-md p-4 border-b-2 border-blue-500">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Bus className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Transport Optimizer</h1>
              <p className="text-sm text-gray-500">Optimisation intelligente du transport public</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Zap className="w-4 h-4 text-yellow-500" />
            <span>Analyse en temps réel</span>
          </div>
        </div>
      </header>

      {/* FORMULAIRE */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6 border border-gray-200">
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="relative">
              <MapPin className="absolute left-3 top-3.5 w-5 h-5 text-green-500" />
              <input
                className="border-2 p-3 pl-10 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Origine (ex: Casa Port, Casablanca)"
                value={origin}
                onChange={e => setOrigin(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <div className="relative">
              <MapPin className="absolute left-3 top-3.5 w-5 h-5 text-red-500" />
              <input
                className="border-2 p-3 pl-10 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-lg flex justify-center items-center gap-2 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 transition-all font-semibold shadow-md"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                {analyzing ? "Analyse du trafic et de la densité..." : "Recherche en cours..."}
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Optimiser l'itinéraire
              </>
            )}
          </button>

          {error && (
            <div className="mt-4 bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Erreur</div>
                <div className="text-sm">{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* RÉSULTATS */}
        {routes.length > 0 && (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* CARTES D'ITINÉRAIRES */}
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-white rounded-xl p-4 shadow-md border border-gray-200">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  Itinéraires optimisés
                </h2>
                <p className="text-sm text-gray-600 mb-4 flex items-start gap-2">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>Basés sur la densité urbaine et le trafic en temps réel</span>
                </p>
              </div>
              
              {routes.map(route => (
                <RouteCard
                  key={route.id}
                  route={route}
                  selected={selectedRoute?.id === route.id}
                  onClick={() => setSelectedRoute(route)}
                />
              ))}
            </div>

            {/* CARTE */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-blue-600" />
                  Visualisation de l'itinéraire
                  {selectedRoute && (
                    <span className="text-sm font-normal text-gray-600 ml-2">
                      - {selectedRoute.name}
                    </span>
                  )}
                </h2>
              </div>
              <div className="p-4 h-[600px]">
                <EnhancedMap 
                  route={selectedRoute} 
                  allRoutes={routes}
                  selectedRouteId={selectedRoute?.id}
                />
              </div>
              
              {selectedRoute && (
                <div className="p-4 border-t bg-gray-50 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-blue-600">
                      {Math.round(selectedRoute.duration)}min
                    </div>
                    <div className="text-xs text-gray-600">Durée totale</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">
                      {(selectedRoute.totalDistance / 1000).toFixed(1)}km
                    </div>
                    <div className="text-xs text-gray-600">Distance totale</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-purple-600">
                      {selectedRoute.score}/100
                    </div>
                    <div className="text-xs text-gray-600">Score d'optimisation</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}