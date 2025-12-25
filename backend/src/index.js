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
  tomtomApiKey: process.env.TOMTOM_API_KEY || 'YOUR_TOMTOM_API_KEY_HERE',
  maxWalkingDistance: 800,
  transferPenalty: 180,
  walkingSpeed: 1.4
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

/* ==================== TOMTOM GEOCODING ==================== */
class TomTomGeocodingService {
  static async geocode(address) {
    const cacheKey = `geocode:tomtom:${address}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(
        `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json`,
        {
          params: {
            key: config.tomtomApiKey,
            limit: 1
          },
          timeout: 10000
        }
      );

      if (!res.data?.results?.[0]) return null;

      const result = res.data.results[0];
      const geo = {
        lat: result.position.lat,
        lon: result.position.lon,
        display_name: result.address.freeformAddress,
        country: result.address.country,
        city: result.address.municipality
      };

      await CacheService.set(cacheKey, geo, 3600);
      return geo;
    } catch (err) {
      logger.error('TomTom Geocoding error:', err.message);
      return null;
    }
  }
}

/* ==================== TOMTOM ROUTING ==================== */
class TomTomRoutingService {
  static async getRoute(oLat, oLon, dLat, dLon, travelMode = 'car') {
    const cacheKey = `tomtom:route:${oLat}:${oLon}:${dLat}:${dLon}:${travelMode}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(
        `https://api.tomtom.com/routing/1/calculateRoute/${oLat},${oLon}:${dLat},${dLon}/json`,
        {
          params: {
            key: config.tomtomApiKey,
            travelMode: travelMode,
            traffic: true,
            routeType: 'fastest',
            instructionsType: 'text'
          },
          timeout: 10000
        }
      );

      const route = res.data?.routes?.[0];
      if (!route) throw new Error('No route found');

      const data = {
        coordinates: route.legs[0].points.map(p => [p.latitude, p.longitude]),
        distance: route.summary.lengthInMeters,
        duration: route.summary.travelTimeInSeconds,
        trafficDelay: route.summary.trafficDelayInSeconds || 0,
        steps: route.guidance?.instructions || [],
        source: 'tomtom'
      };

      await CacheService.set(cacheKey, data, 1800);
      return data;
    } catch (err) {
      logger.error(`TomTom Routing error: ${err.message}`);
      throw new Error('Routing service unavailable');
    }
  }

  static async getWalkingRoute(oLat, oLon, dLat, dLon) {
    return await this.getRoute(oLat, oLon, dLat, dLon, 'pedestrian');
  }
}

/* ==================== TOMTOM TRANSIT SEARCH ==================== */
class TomTomTransitService {
  static async getTransitStopsNearby(lat, lon, radius = 1000) {
    const cacheKey = `tomtom:transit:${lat}:${lon}:${radius}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      // TomTom Search API pour les arrêts de transport
      const res = await axios.get(
        `https://api.tomtom.com/search/2/nearbySearch/.json`,
        {
          params: {
            key: config.tomtomApiKey,
            lat: lat,
            lon: lon,
            radius: radius,
            categorySet: '9361,9362,9363,9364', // Transit stops categories
            limit: 100
          },
          timeout: 15000
        }
      );

      const results = res.data?.results || [];
      logger.info(`TomTom returned ${results.length} transit stops for lat=${lat}, lon=${lon}`);

      const stops = results.map((stop, idx) => ({
        id: stop.id || `tomtom_${idx}`,
        lat: stop.position.lat,
        lon: stop.position.lon,
        name: stop.poi?.name || stop.address?.freeformAddress || `Stop ${idx + 1}`,
        type: stop.poi?.categories?.[0] || 'transit_stop',
        distance: stop.dist || 0,
        address: stop.address?.freeformAddress,
        routes: this.extractRoutesFromStop(stop)
      }));

      const result = {
        stops,
        count: stops.length,
        source: 'tomtom',
        searchRadius: radius
      };

      await CacheService.set(cacheKey, result, 3600);
      return result;
    } catch (err) {
      logger.error(`TomTom Transit error: ${err.message}`);
      return {
        stops: [],
        count: 0,
        source: 'tomtom-error',
        searchRadius: radius,
        error: err.message
      };
    }
  }

  static extractRoutesFromStop(stop) {
    // Extraction basique des lignes de transport depuis les données TomTom
    const routes = [];
    if (stop.poi?.name) {
      const matches = stop.poi.name.match(/\b[A-Z]?\d+[A-Z]?\b/g);
      if (matches) {
        routes.push(...matches);
      }
    }
    // Par défaut, retourner des lignes génériques si aucune trouvée
    return routes.length > 0 ? routes : ['L1', 'L2'];
  }

  static async findAccessibleStops(originLat, originLon, stops) {
    const accessibleStops = [];

    for (const stop of stops) {
      try {
        const walkingRoute = await TomTomRoutingService.getWalkingRoute(
          originLat, originLon, stop.lat, stop.lon
        );

        if (walkingRoute.distance <= config.maxWalkingDistance) {
          accessibleStops.push({
            ...stop,
            walkingDistance: Math.round(walkingRoute.distance),
            walkingDuration: Math.round(walkingRoute.duration),
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

/* ==================== TOMTOM TRAFFIC API ==================== */
class TomTomTrafficService {
  static async getTrafficInfo(lat, lon, radius = 1000) {
    const cacheKey = `tomtom:traffic:${lat}:${lon}:${radius}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(
        `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`,
        {
          params: {
            key: config.tomtomApiKey,
            point: `${lat},${lon}`
          },
          timeout: 10000
        }
      );

      const data = res.data?.flowSegmentData;
      const trafficInfo = {
        currentSpeed: data?.currentSpeed || 0,
        freeFlowSpeed: data?.freeFlowSpeed || 0,
        confidence: data?.confidence || 0,
        roadClosure: data?.roadClosure || false,
        source: 'tomtom-traffic'
      };

      await CacheService.set(cacheKey, trafficInfo, 300);
      return trafficInfo;
    } catch (err) {
      logger.error(`TomTom Traffic error: ${err.message}`);
      return null;
    }
  }
}

/* ==================== ROUTE OPTIMIZATION ==================== */
class RouteOptimizer {
  static async optimizeRoute(origin, destination) {
    const warnings = [];

    logger.info(`Finding transit stops near origin (${origin.lat}, ${origin.lon})`);
    const originTransit = await TomTomTransitService.getTransitStopsNearby(
      origin.lat, origin.lon, 2000
    );
    let originStops = originTransit.stops;

    if (originStops.length === 0) {
      const originTransitLarge = await TomTomTransitService.getTransitStopsNearby(
        origin.lat, origin.lon, 5000
      );
      originStops = originTransitLarge.stops;

      if (originStops.length === 0) {
        throw new Error('Aucun arrêt de transport trouvé près de l\'origine. Essayez une autre adresse.');
      }
    }

    logger.info(`Finding transit stops near destination (${destination.lat}, ${destination.lon})`);
    const destTransit = await TomTomTransitService.getTransitStopsNearby(
      destination.lat, destination.lon, 2000
    );
    let destStops = destTransit.stops;

    if (destStops.length === 0) {
      const destTransitLarge = await TomTomTransitService.getTransitStopsNearby(
        destination.lat, destination.lon, 5000
      );
      destStops = destTransitLarge.stops;

      if (destStops.length === 0) {
        throw new Error('Aucun arrêt de transport trouvé près de la destination. Essayez une autre adresse.');
      }
    }

    logger.info('Calculating walking distances to accessible stops...');
    const accessibleOriginStops = await TomTomTransitService.findAccessibleStops(
      origin.lat, origin.lon, originStops.slice(0, 10)
    );

    const accessibleDestStops = await TomTomTransitService.findAccessibleStops(
      destination.lat, destination.lon, destStops.slice(0, 10)
    );

    if (accessibleOriginStops.length === 0) {
      warnings.push({
        type: 'NO_ACCESSIBLE_STOPS_ORIGIN',
        message: `Tous les arrêts d'origine dépassent la distance de marche maximale.`
      });
    }

    if (accessibleDestStops.length === 0) {
      warnings.push({
        type: 'NO_ACCESSIBLE_STOPS_DEST',
        message: `Tous les arrêts de destination dépassent la distance de marche maximale.`
      });
    }

    logger.info('Getting traffic information...');
    const originTraffic = await TomTomTrafficService.getTrafficInfo(origin.lat, origin.lon);
    const destTraffic = await TomTomTrafficService.getTrafficInfo(destination.lat, destination.lon);

    logger.info('Finding optimal transit routes...');
    const routes = [];

    const stopsToCheck = Math.min(accessibleOriginStops.length, 5);
    for (let i = 0; i < stopsToCheck; i++) {
      const originStop = accessibleOriginStops[i];
      
      for (let j = 0; j < Math.min(accessibleDestStops.length, 5); j++) {
        const destStop = accessibleDestStops[j];

        try {
          const transitRoute = await TomTomRoutingService.getRoute(
            originStop.lat, originStop.lon,
            destStop.lat, destStop.lon,
            'car'
          );

          const totalWalkDuration = originStop.walkingDuration + destStop.walkingDuration;
          const totalDuration = transitRoute.duration + totalWalkDuration + transitRoute.trafficDelay;

          routes.push({
            type: 'DIRECT',
            routeId: `${originStop.routes[0]}-${destStop.routes[0]}`,
            originStop,
            destStop,
            transitDistance: Math.round(transitRoute.distance),
            transitDuration: Math.round(transitRoute.duration),
            trafficDelay: Math.round(transitRoute.trafficDelay),
            totalWalkingDistance: originStop.walkingDistance + destStop.walkingDistance,
            totalWalkingDuration: totalWalkDuration,
            transfers: 0,
            totalDuration: Math.round(totalDuration),
            coordinates: [
              ...originStop.walkingRoute,
              ...transitRoute.coordinates,
              ...destStop.walkingRoute
            ],
            source: 'tomtom-real-data'
          });
        } catch (err) {
          logger.warn(`Route calculation failed: ${err.message}`);
        }
      }
    }

    routes.sort((a, b) => a.totalDuration - b.totalDuration);

    const scoredRoutes = routes.map(route => ({
      ...route,
      score: this.calculateScore(route, originTraffic, destTraffic)
    }));

    return {
      routes: scoredRoutes.slice(0, 5),
      origin: {
        ...origin,
        traffic: originTraffic,
        nearbyStops: originStops.length,
        accessibleStops: accessibleOriginStops.length
      },
      destination: {
        ...destination,
        traffic: destTraffic,
        nearbyStops: destStops.length,
        accessibleStops: accessibleDestStops.length
      },
      warnings,
      metadata: {
        totalStopsFound: originStops.length + destStops.length,
        accessibleOriginStops: accessibleOriginStops.length,
        accessibleDestStops: accessibleDestStops.length,
        routesCalculated: routes.length,
        dataSource: 'TomTom Real-Time Data',
        timestamp: new Date().toISOString()
      }
    };
  }

  static calculateScore(route, originTraffic, destTraffic) {
    let score = 100;
    score -= (route.totalDuration / 60) * 0.5;
    score -= (route.totalWalkingDistance / 100) * 1.5;
    score -= route.transfers * 10;
    score -= (route.trafficDelay / 60) * 2;

    if (originTraffic?.confidence > 0.7) score += 3;
    if (destTraffic?.confidence > 0.7) score += 3;

    return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  }
}

/* ==================== ROUTES ==================== */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    redis: redisClient?.isOpen || false,
    tomtom: config.tomtomApiKey !== 'YOUR_TOMTOM_API_KEY_HERE',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/routes/optimize', async (req, res) => {
  try {
    const { origin, destination } = req.body;
    if (!origin || !destination) {
      return res.status(400).json({ error: 'origin et destination requis' });
    }

    const o = origin.address
      ? await TomTomGeocodingService.geocode(origin.address)
      : origin;
    const d = destination.address
      ? await TomTomGeocodingService.geocode(destination.address)
      : destination;

    if (!o || !d) {
      return res.status(404).json({ error: 'Adresse introuvable' });
    }

    const result = await RouteOptimizer.optimizeRoute(o, d);
    res.json(result);
  } catch (err) {
    logger.error('Optimization error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Route non trouvée' }));

/* ==================== SERVER ==================== */
app.listen(config.port, () => {
  logger.info(`🚀 Backend démarré sur le port ${config.port}`);
  logger.info('📊 Mode: DONNÉES RÉELLES TOMTOM');
  logger.info(`🔑 TomTom API: ${config.tomtomApiKey !== 'YOUR_TOMTOM_API_KEY_HERE' ? 'Configurée' : 'NON CONFIGURÉE'}`);
});

process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  process.exit(0);
});