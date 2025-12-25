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
  openRouteServiceKey: process.env.ORS_API_KEY || '5b3ce3597851110001cf6248YOUR_KEY_HERE',
  tomtomApiKey: process.env.TOMTOM_API_KEY || 'YOUR_TOMTOM_API_KEY',
  transitlandApiKey: process.env.TRANSITLAND_API_KEY || 'YOUR_TRANSITLAND_KEY',
  maxWalkingDistance: 800, // Maximum acceptable walking distance in meters
  transferPenalty: 300, // Seconds penalty per transfer
  walkingSpeed: 1.4 // m/s (avg walking speed)
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
          headers: { 'User-Agent': 'TransportOptimizer/2.0' },
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

/* ==================== OPENROUTESERVICE - ROUTING RÉEL ==================== */
class OpenRouteService {
  static async getRoute(oLat, oLon, dLat, dLon, profile = 'driving-car') {
    const cacheKey = `ors:${oLat}:${oLon}:${dLat}:${dLon}:${profile}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.post(
        `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
        {
          coordinates: [[oLon, oLat], [dLon, dLat]],
          elevation: false,
          instructions: true
        },
        {
          headers: {
            'Authorization': config.openRouteServiceKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const route = res.data?.features?.[0];
      if (!route) throw new Error('No route found');

      const data = {
        coordinates: route.geometry.coordinates.map(c => [c[1], c[0]]),
        distance: route.properties.segments[0].distance,
        duration: route.properties.segments[0].duration,
        steps: route.properties.segments[0].steps || [],
        source: 'openrouteservice'
      };

      await CacheService.set(cacheKey, data, 3600);
      return data;
    } catch (err) {
      logger.error(`OpenRouteService error: ${err.message}`);
      throw new Error('Routing service unavailable - cannot calculate route');
    }
  }

  // Calculate real walking distance between two points
  static async getWalkingRoute(oLat, oLon, dLat, dLon) {
    return await this.getRoute(oLat, oLon, dLat, dLon, 'foot-walking');
  }
}

/* ==================== URBAN DENSITY - DONNÉES RÉELLES VIA OVERPASS API ==================== */
class UrbanDensityService {
  static async calculateRealDensity(lat, lon, radius = 500) {
    const cacheKey = `density:${lat}:${lon}:${radius}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      // Query Overpass API for buildings and amenities
      const query = `
        [out:json][timeout:10];
        (
          way(around:${radius},${lat},${lon})["building"];
          node(around:${radius},${lat},${lon})["amenity"];
          node(around:${radius},${lat},${lon})["shop"];
        );
        out count;
      `;

      const res = await axios.post(
        'https://overpass-api.de/api/interpreter',
        query,
        {
          headers: { 'Content-Type': 'text/plain' },
          timeout: 15000
        }
      );

      const elements = res.data?.elements || [];
      const buildings = elements.filter(e => e.tags?.building).length;
      const amenities = elements.filter(e => e.tags?.amenity).length;
      const shops = elements.filter(e => e.tags?.shop).length;

      // Calculate density score based on real data
      const totalFeatures = buildings + amenities + shops;
      const densityScore = Math.min(100, Math.round((totalFeatures / 100) * 100));

      const density = {
        buildings,
        amenities,
        shops,
        totalFeatures,
        densityScore,
        radius,
        source: 'overpass-api',
        interpretation: densityScore > 70 ? 'high' : densityScore > 40 ? 'medium' : 'low'
      };

      await CacheService.set(cacheKey, density, 7200);
      return density;
    } catch (err) {
      logger.error(`Urban density calculation error: ${err.message}`);
      throw new Error('Urban density data unavailable');
    }
  }
}

/* ==================== GTFS/TRANSPORT PUBLIC - DONNÉES RÉELLES ==================== */
class PublicTransportService {
  // Get real transit lines near a location using Overpass API
  static async getTransitLinesNearby(lat, lon, radius = 1000) {
    const cacheKey = `transit:${lat}:${lon}:${radius}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      // Query for public transport routes and stops
      const query = `
        [out:json][timeout:15];
        (
          node(around:${radius},${lat},${lon})["public_transport"="stop_position"];
          node(around:${radius},${lat},${lon})["highway"="bus_stop"];
          node(around:${radius},${lat},${lon})["railway"="tram_stop"];
        );
        out body;
        >;
        out skel qt;
      `;

      const res = await axios.post(
        'https://overpass-api.de/api/interpreter',
        query,
        {
          headers: { 'Content-Type': 'text/plain' },
          timeout: 20000
        }
      );

      const stops = (res.data?.elements || []).map(stop => ({
        id: stop.id,
        lat: stop.lat,
        lon: stop.lon,
        name: stop.tags?.name || 'Unknown Stop',
        type: stop.tags?.public_transport || stop.tags?.highway || stop.tags?.railway,
        routes: stop.tags?.route_ref ? stop.tags.route_ref.split(';') : [],
        operator: stop.tags?.operator || 'Unknown'
      }));

      const result = {
        stops,
        count: stops.length,
        source: 'overpass-api',
        searchRadius: radius
      };

      await CacheService.set(cacheKey, result, 3600);
      return result;
    } catch (err) {
      logger.error(`Transit data error: ${err.message}`);
      throw new Error('Transit data unavailable');
    }
  }

  // Calculate real walking distance to nearest stops
  static async findAccessibleStops(originLat, originLon, stops) {
    const accessibleStops = [];

    for (const stop of stops) {
      try {
        const walkingRoute = await OpenRouteService.getWalkingRoute(
          originLat, originLon, stop.lat, stop.lon
        );

        if (walkingRoute.distance <= config.maxWalkingDistance) {
          accessibleStops.push({
            ...stop,
            walkingDistance: walkingRoute.distance,
            walkingDuration: walkingRoute.duration,
            walkingRoute: walkingRoute.coordinates,
            accessible: true
          });
        }
      } catch (err) {
        logger.warn(`Could not calculate walk to stop ${stop.id}: ${err.message}`);
      }
    }

    return accessibleStops.sort((a, b) => a.walkingDistance - b.walkingDistance);
  }
}

/* ==================== ROUTE OPTIMIZATION - ALGORITHME AVEC DONNÉES RÉELLES ==================== */
class RouteOptimizer {
  static async optimizeRoute(origin, destination) {
    const anomalies = [];
    const warnings = [];

    // Step 1: Get transit stops near origin
    logger.info(`Finding transit stops near origin (${origin.lat}, ${origin.lon})`);
    let originStops;
    try {
      const originTransit = await PublicTransportService.getTransitLinesNearby(
        origin.lat, origin.lon, 1000
      );
      originStops = originTransit.stops;
      
      if (originStops.length === 0) {
        anomalies.push({
          type: 'NO_TRANSIT_ORIGIN',
          severity: 'critical',
          message: `No public transit stops found within 1km of origin`
        });
      }
    } catch (err) {
      anomalies.push({
        type: 'TRANSIT_DATA_ERROR',
        severity: 'critical',
        message: `Could not fetch transit data: ${err.message}`
      });
      throw new Error('Cannot proceed without transit data');
    }

    // Step 2: Get transit stops near destination
    logger.info(`Finding transit stops near destination (${destination.lat}, ${destination.lon})`);
    let destStops;
    try {
      const destTransit = await PublicTransportService.getTransitLinesNearby(
        destination.lat, destination.lon, 1000
      );
      destStops = destTransit.stops;
      
      if (destStops.length === 0) {
        anomalies.push({
          type: 'NO_TRANSIT_DEST',
          severity: 'critical',
          message: `No public transit stops found within 1km of destination`
        });
      }
    } catch (err) {
      anomalies.push({
        type: 'TRANSIT_DATA_ERROR',
        severity: 'critical',
        message: `Could not fetch transit data: ${err.message}`
      });
      throw new Error('Cannot proceed without transit data');
    }

    // Step 3: Calculate real walking distances to accessible stops
    logger.info('Calculating walking distances to accessible stops...');
    const accessibleOriginStops = await PublicTransportService.findAccessibleStops(
      origin.lat, origin.lon, originStops
    );
    
    const accessibleDestStops = await PublicTransportService.findAccessibleStops(
      destination.lat, destination.lon, destStops
    );

    if (accessibleOriginStops.length === 0) {
      anomalies.push({
        type: 'NO_ACCESSIBLE_STOPS_ORIGIN',
        severity: 'critical',
        message: `All origin stops are beyond maximum walking distance (${config.maxWalkingDistance}m)`
      });
    }

    if (accessibleDestStops.length === 0) {
      anomalies.push({
        type: 'NO_ACCESSIBLE_STOPS_DEST',
        severity: 'critical',
        message: `All destination stops are beyond maximum walking distance (${config.maxWalkingDistance}m)`
      });
    }

    // Step 4: Calculate urban density at both points
    logger.info('Analyzing urban density...');
    const originDensity = await UrbanDensityService.calculateRealDensity(origin.lat, origin.lon);
    const destDensity = await UrbanDensityService.calculateRealDensity(destination.lat, destination.lon);

    // Step 5: Find common routes between stops
    logger.info('Finding common transit routes...');
    const routes = [];
    
    for (const originStop of accessibleOriginStops.slice(0, 5)) {
      for (const destStop of accessibleDestStops.slice(0, 5)) {
        const commonRoutes = originStop.routes.filter(r => 
          destStop.routes.includes(r)
        );

        if (commonRoutes.length > 0) {
          // Direct route found
          for (const routeId of commonRoutes) {
            try {
              const transitRoute = await OpenRouteService.getRoute(
                originStop.lat, originStop.lon,
                destStop.lat, destStop.lon,
                'driving-car' // Approximation for transit path
              );

              routes.push({
                type: 'DIRECT',
                routeId,
                originStop,
                destStop,
                transitDistance: transitRoute.distance,
                transitDuration: transitRoute.duration,
                totalWalkingDistance: originStop.walkingDistance + destStop.walkingDistance,
                totalWalkingDuration: originStop.walkingDuration + destStop.walkingDuration,
                transfers: 0,
                totalDuration: transitRoute.duration + originStop.walkingDuration + destStop.walkingDuration,
                coordinates: [
                  ...originStop.walkingRoute,
                  ...transitRoute.coordinates,
                  ...destStop.walkingRoute
                ],
                source: 'real-data'
              });
            } catch (err) {
              warnings.push({
                type: 'ROUTE_CALCULATION_FAILED',
                message: `Could not calculate route between stops: ${err.message}`
              });
            }
          }
        }
      }
    }

    // Sort routes by total duration
    routes.sort((a, b) => a.totalDuration - b.totalDuration);

    // Step 6: Calculate scores based on real data
    const scoredRoutes = routes.map(route => ({
      ...route,
      score: this.calculateRealScore(route, originDensity, destDensity)
    }));

    return {
      routes: scoredRoutes.slice(0, 3),
      origin: {
        ...origin,
        density: originDensity,
        nearbyStops: accessibleOriginStops.length,
        closestStop: accessibleOriginStops[0]
      },
      destination: {
        ...destination,
        density: destDensity,
        nearbyStops: accessibleDestStops.length,
        closestStop: accessibleDestStops[0]
      },
      anomalies,
      warnings,
      metadata: {
        totalStopsFound: originStops.length + destStops.length,
        accessibleOriginStops: accessibleOriginStops.length,
        accessibleDestStops: accessibleDestStops.length,
        routesCalculated: routes.length,
        dataSource: 'OpenStreetMap + OpenRouteService',
        timestamp: new Date().toISOString()
      }
    };
  }

  static calculateRealScore(route, originDensity, destDensity) {
    let score = 100;

    // Penalize long total duration (weight: high)
    score -= (route.totalDuration / 60) * 0.5; // -0.5 per minute

    // Penalize long walking distances (weight: medium)
    score -= (route.totalWalkingDistance / 100) * 1.5; // -1.5 per 100m

    // Penalize transfers (weight: high)
    score -= route.transfers * 10;

    // Bonus for high-density areas (better connectivity expected)
    const avgDensity = (originDensity.densityScore + destDensity.densityScore) / 2;
    if (avgDensity > 70) score += 5;

    return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  }
}

/* ==================== ROUTES ==================== */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    redis: redisClient?.isOpen || false,
    apis: {
      openrouteservice: config.openRouteServiceKey !== '5b3ce3597851110001cf6248YOUR_KEY_HERE',
      tomtom: config.tomtomApiKey !== 'YOUR_TOMTOM_API_KEY',
      transitland: config.transitlandApiKey !== 'YOUR_TRANSITLAND_KEY'
    },
    config: {
      maxWalkingDistance: config.maxWalkingDistance,
      walkingSpeed: config.walkingSpeed
    },
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

app.get('/api/density', async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'Paramètres lat et lon requis' });
    }

    const density = await UrbanDensityService.calculateRealDensity(
      parseFloat(lat),
      parseFloat(lon),
      radius ? parseInt(radius) : 500
    );

    res.json(density);
  } catch (err) {
    logger.error('Density error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transit/nearby', async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'Paramètres lat et lon requis' });
    }

    const transit = await PublicTransportService.getTransitLinesNearby(
      parseFloat(lat),
      parseFloat(lon),
      radius ? parseInt(radius) : 1000
    );

    res.json(transit);
  } catch (err) {
    logger.error('Transit error:', err.message);
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

    const result = await RouteOptimizer.optimizeRoute(o, d);

    res.json(result);
  } catch (err) {
    logger.error('Optimization error:', err.message);
    res.status(500).json({ 
      error: err.message,
      type: 'OPTIMIZATION_ERROR'
    });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Route non trouvée' }));

/* ==================== SERVER ==================== */
app.listen(config.port, () => {
  logger.info(`🚀 Backend démarré sur le port ${config.port}`);
  logger.info('📊 Mode: DONNÉES RÉELLES UNIQUEMENT');
  logger.info('📍 Sources: OpenStreetMap, OpenRouteService, Overpass API');
  
  if (config.openRouteServiceKey === '5b3ce3597851110001cf6248YOUR_KEY_HERE') {
    logger.error('❌ Clé API OpenRouteService REQUISE');
    logger.info('📝 Obtenez une clé gratuite sur https://openrouteservice.org/dev/#/signup');
  }
});

process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  process.exit(0);
});