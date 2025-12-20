import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from 'redis';
import axios from 'axios';
import winston from 'winston';

/* ==================== LOGGER ==================== */
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

/* ==================== CONFIG ==================== */
const config = {
  port: process.env.PORT || 3000,
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  cacheTTL: 300,
  osrmUrl: 'https://router.project-osrm.org',
  tomtomApiKey: process.env.TOMTOM_API_KEY || 'YOUR_TOMTOM_API_KEY' // Remplacer par votre clé
};

/* ==================== APP ==================== */
const app = express();

app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

/* ==================== REDIS ==================== */
let redisClient = null;

(async () => {
  try {
    redisClient = createClient({ url: config.redisUrl });
    redisClient.on('error', err => logger.warn('Redis error', err));
    await redisClient.connect();
    logger.info('✅ Redis connecté');
  } catch {
    logger.warn('⚠️ Redis indisponible, cache désactivé');
    redisClient = null;
  }
})();

/* ==================== CACHE SERVICE ==================== */
class CacheService {
  static async get(key) {
    if (!redisClient?.isOpen) return null;
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  static async set(key, value, ttl = config.cacheTTL) {
    if (!redisClient?.isOpen) return;
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
    } catch {}
  }
}

/* ==================== GEOCODING ==================== */
class GeocodingService {
  static async geocode(address) {
    const cacheKey = `geocode:${address}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(
        'https://nominatim.openstreetmap.org/search',
        {
          params: { q: address, format: 'json', limit: 1 },
          headers: { 'User-Agent': 'TransportOptimizer/1.0' },
          timeout: 10000
        }
      );

      if (!res.data?.[0]) return null;

      const geo = {
        lat: parseFloat(res.data[0].lat),
        lon: parseFloat(res.data[0].lon),
        display_name: res.data[0].display_name
      };

      await CacheService.set(cacheKey, geo, 3600);
      return geo;
    } catch (err) {
      logger.error('Geocoding error:', err.message);
      return null;
    }
  }
}

/* ==================== TOMTOM TRAFFIC SERVICE ==================== */
class TomTomTrafficService {
  static async getRealTimeTraffic(lat, lon, zoom = 10) {
    const cacheKey = `traffic:${lat}:${lon}:${zoom}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      // API TomTom Traffic Flow
      const res = await axios.get(
        `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/${zoom}/json`,
        {
          params: {
            key: config.tomtomApiKey,
            point: `${lat},${lon}`
          },
          timeout: 5000
        }
      );

      const flowData = res.data?.flowSegmentData;
      if (!flowData) {
        return this.getFallbackTraffic();
      }

      const trafficData = {
        currentSpeed: flowData.currentSpeed || 30,
        freeFlowSpeed: flowData.freeFlowSpeed || 50,
        currentTravelTime: flowData.currentTravelTime || 0,
        freeFlowTravelTime: flowData.freeFlowTravelTime || 0,
        confidence: flowData.confidence || 0.5,
        roadClosure: flowData.roadClosure || false,
        coordinates: flowData.coordinates?.coordinate || [],
        // Calcul du niveau de congestion (0-100)
        congestionLevel: Math.round((1 - (flowData.currentSpeed / flowData.freeFlowSpeed)) * 100)
      };

      await CacheService.set(cacheKey, trafficData, 180); // Cache 3 min
      return trafficData;
    } catch (err) {
      logger.warn(`TomTom Traffic API error: ${err.message}`);
      return this.getFallbackTraffic();
    }
  }

  static getFallbackTraffic() {
    const hour = new Date().getHours();
    let congestionLevel = 20;

    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      congestionLevel = 70;
    } else if (hour >= 12 && hour <= 14) {
      congestionLevel = 45;
    }

    return {
      currentSpeed: 30,
      freeFlowSpeed: 50,
      congestionLevel,
      fallback: true
    };
  }

  // Obtenir le trafic le long d'un itinéraire
  static async getRouteTraffic(coordinates) {
    const trafficData = [];
    
    // Échantillonner tous les 5 points pour ne pas surcharger l'API
    for (let i = 0; i < coordinates.length; i += 5) {
      const coord = coordinates[i];
      const traffic = await this.getRealTimeTraffic(coord[0], coord[1]);
      trafficData.push({
        position: i,
        ...traffic
      });
    }

    // Calculer le niveau de congestion moyen
    const avgCongestion = trafficData.reduce((sum, t) => sum + t.congestionLevel, 0) / trafficData.length;

    return {
      segments: trafficData,
      averageCongestion: Math.round(avgCongestion),
      maxCongestion: Math.max(...trafficData.map(t => t.congestionLevel))
    };
  }
}

/* ==================== ROUTE CALCULATION ==================== */
class RouteService {
  static haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  static generateIntermediatePoints(lat1, lon1, lat2, lon2, numPoints = 10) {
    const points = [[lat1, lon1]];
    
    for (let i = 1; i < numPoints; i++) {
      const ratio = i / numPoints;
      const lat = lat1 + (lat2 - lat1) * ratio;
      const lon = lon1 + (lon2 - lon1) * ratio;
      
      const variation = 0.001;
      const latVar = lat + (Math.random() - 0.5) * variation;
      const lonVar = lon + (Math.random() - 0.5) * variation;
      
      points.push([latVar, lonVar]);
    }
    
    points.push([lat2, lon2]);
    return points;
  }

  static generateFallbackRoute(oLat, oLon, dLat, dLon) {
    const distance = this.haversineDistance(oLat, oLon, dLat, dLon);
    const avgSpeed = 8.33;
    const duration = distance / avgSpeed;
    const coordinates = this.generateIntermediatePoints(oLat, oLon, dLat, dLon, 15);
    
    return {
      coordinates,
      distance,
      duration,
      fallback: true
    };
  }
}

/* ==================== OSRM ==================== */
class OSRMService {
  static async getRoute(oLat, oLon, dLat, dLon) {
    const cacheKey = `osrm:${oLat}:${oLon}:${dLat}:${dLon}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(
        `${config.osrmUrl}/route/v1/driving/${oLon},${oLat};${dLon},${dLat}`,
        { 
          params: { 
            overview: 'full', 
            geometries: 'geojson',
            steps: true // Obtenir les instructions détaillées
          }, 
          timeout: 5000 
        }
      );

      const route = res.data?.routes?.[0];
      if (!route) {
        logger.warn('OSRM: Aucune route trouvée, utilisation du fallback');
        return RouteService.generateFallbackRoute(oLat, oLon, dLat, dLon);
      }

      const data = {
        coordinates: route.geometry.coordinates.map(c => [c[1], c[0]]),
        distance: route.distance,
        duration: route.duration,
        steps: route.legs?.[0]?.steps || [],
        fallback: false
      };

      await CacheService.set(cacheKey, data, 3600);
      return data;
    } catch (err) {
      logger.warn(`OSRM indisponible (${err.message}), utilisation du fallback`);
      return RouteService.generateFallbackRoute(oLat, oLon, dLat, dLon);
    }
  }
}

/* ==================== TRANSPORT PUBLIC SERVICE ==================== */
class PublicTransportService {
  // Simule les lignes de transport public à Casablanca
  static getTransportLines() {
    return {
      tramway: [
        { id: 'T1', name: 'Tramway Ligne 1', color: '#0066cc', stations: 48 },
        { id: 'T2', name: 'Tramway Ligne 2', color: '#00cc66', stations: 28 }
      ],
      bus: [
        { id: 'M1', name: 'Bus M1', type: 'express', color: '#cc0000' },
        { id: 'M3', name: 'Bus M3', type: 'express', color: '#cc0000' },
        { id: 'M5', name: 'Bus M5', type: 'express', color: '#cc0000' },
        { id: 'L10', name: 'Bus L10', type: 'local', color: '#0099cc' },
        { id: 'L20', name: 'Bus L20', type: 'local', color: '#0099cc' },
        { id: 'L32', name: 'Bus L32', type: 'local', color: '#0099cc' }
      ]
    };
  }

  static generateTransportSegments(coordinates, lineIds) {
    const segments = [];
    const segmentLength = Math.floor(coordinates.length / (lineIds.length + 1));

    lineIds.forEach((lineId, index) => {
      const start = index * segmentLength;
      const end = index === lineIds.length - 1 ? coordinates.length : (index + 1) * segmentLength;
      
      segments.push({
        lineId,
        startIndex: start,
        endIndex: end,
        stops: Math.floor((end - start) / 5), // Un arrêt tous les 5 points
        coordinates: coordinates.slice(start, end)
      });
    });

    return segments;
  }
}

/* ==================== ROUTES ==================== */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    redis: redisClient?.isOpen || false,
    tomtom: config.tomtomApiKey !== 'YOUR_TOMTOM_API_KEY',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/geocode', async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) {
      return res.status(400).json({ error: 'Paramètre address requis' });
    }

    const geo = await GeocodingService.geocode(address);
    if (!geo) {
      return res.status(404).json({ error: 'Adresse introuvable' });
    }

    res.json(geo);
  } catch (err) {
    logger.error('Geocode error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/traffic', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'Paramètres lat et lon requis' });
    }

    const traffic = await TomTomTrafficService.getRealTimeTraffic(
      parseFloat(lat),
      parseFloat(lon)
    );

    res.json(traffic);
  } catch (err) {
    logger.error('Traffic error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/routes/optimize', async (req, res) => {
  try {
    const { origin, destination } = req.body;
    if (!origin || !destination) {
      return res.status(400).json({ error: 'origin et destination requis' });
    }

    const o = origin.address
      ? await GeocodingService.geocode(origin.address)
      : origin;
    const d = destination.address
      ? await GeocodingService.geocode(destination.address)
      : destination;

    if (!o || !d) {
      return res.status(404).json({ error: 'Adresse introuvable' });
    }

    // Obtenir l'itinéraire de base
    const route = await OSRMService.getRoute(o.lat, o.lon, d.lat, d.lon);

    // Obtenir le trafic en temps réel sur l'itinéraire
    const routeTraffic = await TomTomTrafficService.getRouteTraffic(route.coordinates);

    // Obtenir les lignes de transport disponibles
    const transportLines = PublicTransportService.getTransportLines();

    res.json({ 
      origin: o, 
      destination: d, 
      route: {
        ...route,
        traffic: routeTraffic
      },
      transportLines,
      message: route.fallback ? 'Itinéraire calculé en mode fallback (OSRM indisponible)' : null
    });
  } catch (err) {
    logger.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Route non trouvée' }));

/* ==================== SERVER ==================== */
app.listen(config.port, () => {
  logger.info(`🚀 Backend démarré sur le port ${config.port}`);
  if (config.tomtomApiKey === 'YOUR_TOMTOM_API_KEY') {
    logger.warn('⚠️ Clé API TomTom non configurée - utilisera le mode fallback');
  }
});

process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  process.exit(0);
});