import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from 'redis';
import axios from 'axios';
import winston from 'winston';

/* ==================== LOGGER ==================== */
const logger = winston.createLogger({
  level: 'debug', // Changé à 'debug' pour plus de détails
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

/* ==================== CONFIG ==================== */
const config = {
  port: process.env.PORT || 3000,
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  cacheTTL: 300,
  tomtomApiKey: process.env.TOMTOM_API_KEY || 'Cjx7i2N9ESmF9Sq8Bw6QtZ4FRJkCQMLy',
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

// Logger middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { body: req.body });
  next();
});

/* ==================== REDIS ==================== */
let redisClient = null;

(async () => {
  try {
    redisClient = createClient({ url: config.redisUrl });
    redisClient.on('error', err => logger.warn('Redis error', { error: err.message }));
    await redisClient.connect();
    logger.info('✅ Redis connecté');
  } catch (err) {
    logger.warn('⚠️ Redis indisponible, cache désactivé', { error: err.message });
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
    if (cached) {
      logger.debug('📦 Cache hit pour géocodage', { address, cached });
      return cached;
    }

    try {
      logger.info('🔍 Géocodage de l\'adresse', { address });
      
      const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json`;
      logger.debug('📡 Requête TomTom', { url, key: config.tomtomApiKey.substring(0, 10) + '...' });
      
      const res = await axios.get(url, {
        params: {
          key: config.tomtomApiKey,
          limit: 1,
          countrySet: 'MA'
        },
        timeout: 10000
      });

      logger.debug('📥 Réponse TomTom géocodage', { 
        status: res.status,
        resultsCount: res.data?.results?.length || 0,
        firstResult: res.data?.results?.[0]?.address?.freeformAddress
      });

      if (!res.data?.results?.[0]) {
        logger.warn('❌ Aucun résultat de géocodage', { address });
        return null;
      }

      const result = res.data.results[0];
      const geo = {
        lat: result.position.lat,
        lon: result.position.lon,
        display_name: result.address.freeformAddress,
        country: result.address.country,
        city: result.address.municipality
      };

      logger.info('✅ Géocodage réussi', { 
        address, 
        result: `${geo.display_name} (${geo.lat}, ${geo.lon})` 
      });
      
      await CacheService.set(cacheKey, geo, 3600);
      return geo;
    } catch (err) {
      logger.error('❌ Erreur de géocodage TomTom', { 
        address,
        error: err.message,
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data
      });
      return null;
    }
  }
}

/* ==================== TOMTOM ROUTING ==================== */
class TomTomRoutingService {
  static async getRoute(oLat, oLon, dLat, dLon, travelMode = 'car') {
    const cacheKey = `tomtom:route:${oLat}:${oLon}:${dLat}:${dLon}:${travelMode}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) {
      logger.debug('📦 Cache hit pour routing', { cacheKey });
      return cached;
    }

    try {
      logger.info('🚗 Calcul d\'itinéraire', { oLat, oLon, dLat, dLon, travelMode });
      
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

      logger.debug('📥 Réponse TomTom routing', { 
        status: res.status,
        routesCount: res.data?.routes?.length || 0
      });

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

      logger.info('✅ Itinéraire calculé', { 
        distance: `${Math.round(data.distance / 1000)}km`,
        duration: `${Math.round(data.duration / 60)}min`
      });

      await CacheService.set(cacheKey, data, 1800);
      return data;
    } catch (err) {
      logger.error('❌ Erreur de routing TomTom', { 
        error: err.message,
        status: err.response?.status,
        data: err.response?.data
      });
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
    if (cached) {
      logger.debug('📦 Cache hit pour transit stops', { lat, lon, radius });
      return cached;
    }

    try {
      logger.info('🚏 Recherche d\'arrêts de transport', { lat, lon, radius });
      
      const res = await axios.get(
        `https://api.tomtom.com/search/2/nearbySearch/.json`,
        {
          params: {
            key: config.tomtomApiKey,
            lat: lat,
            lon: lon,
            radius: radius,
            categorySet: '9361,9362,9363,9364',
            limit: 100
          },
          timeout: 15000
        }
      );

      const results = res.data?.results || [];
      logger.info(`✅ ${results.length} arrêts trouvés`, { lat, lon, radius });

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
      logger.error('❌ Erreur recherche transit stops', { 
        error: err.message,
        status: err.response?.status,
        data: err.response?.data
      });
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
    const routes = [];
    if (stop.poi?.name) {
      const matches = stop.poi.name.match(/\b[A-Z]?\d+[A-Z]?\b/g);
      if (matches) {
        routes.push(...matches);
      }
    }
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
        logger.warn(`⚠️ Impossible de calculer la marche vers l'arrêt ${stop.id}`, { error: err.message });
      }
    }

    logger.info(`✅ ${accessibleStops.length} arrêts accessibles trouvés`);
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
      logger.info('🚦 Récupération info trafic', { lat, lon });
      
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

      logger.info('✅ Info trafic récupérée', trafficInfo);
      await CacheService.set(cacheKey, trafficInfo, 300);
      return trafficInfo;
    } catch (err) {
      logger.warn('⚠️ Erreur info trafic', { error: err.message });
      return null;
    }
  }
}

/* ==================== ROUTE OPTIMIZATION ==================== */
class RouteOptimizer {
  static async optimizeRoute(origin, destination) {
    const warnings = [];

    logger.info('🎯 Optimisation d\'itinéraire', { origin, destination });

    const originTransit = await TomTomTransitService.getTransitStopsNearby(
      origin.lat, origin.lon, 2000
    );
    let originStops = originTransit.stops;

    if (originStops.length === 0) {
      logger.warn('⚠️ Aucun arrêt trouvé dans un rayon de 2km, élargissement à 5km');
      const originTransitLarge = await TomTomTransitService.getTransitStopsNearby(
        origin.lat, origin.lon, 5000
      );
      originStops = originTransitLarge.stops;

      if (originStops.length === 0) {
        throw new Error('Aucun arrêt de transport trouvé près de l\'origine. Essayez une autre adresse.');
      }
    }

    const destTransit = await TomTomTransitService.getTransitStopsNearby(
      destination.lat, destination.lon, 2000
    );
    let destStops = destTransit.stops;

    if (destStops.length === 0) {
      logger.warn('⚠️ Aucun arrêt trouvé dans un rayon de 2km, élargissement à 5km');
      const destTransitLarge = await TomTomTransitService.getTransitStopsNearby(
        destination.lat, destination.lon, 5000
      );
      destStops = destTransitLarge.stops;

      if (destStops.length === 0) {
        throw new Error('Aucun arrêt de transport trouvé près de la destination. Essayez une autre adresse.');
      }
    }

    logger.info('📊 Calcul des distances de marche...');
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

    logger.info('🚦 Récupération des infos trafic...');
    const originTraffic = await TomTomTrafficService.getTrafficInfo(origin.lat, origin.lon);
    const destTraffic = await TomTomTrafficService.getTrafficInfo(destination.lat, destination.lon);

    logger.info('🔀 Calcul des itinéraires optimaux...');
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
          logger.warn('⚠️ Échec calcul d\'itinéraire', { error: err.message });
        }
      }
    }

    routes.sort((a, b) => a.totalDuration - b.totalDuration);

    const scoredRoutes = routes.map(route => ({
      ...route,
      score: this.calculateScore(route, originTraffic, destTraffic)
    }));

    logger.info(`✅ ${scoredRoutes.length} itinéraires calculés avec succès`);

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
  const health = {
    status: 'ok',
    redis: redisClient?.isOpen || false,
    tomtom: config.tomtomApiKey !== 'YOUR_TOMTOM_API_KEY_HERE',
    timestamp: new Date().toISOString()
  };
  logger.info('💚 Health check', health);
  res.json(health);
});

app.post('/api/routes/optimize', async (req, res) => {
  try {
    const { origin, destination } = req.body;
    
    logger.info('📨 Requête d\'optimisation reçue', { origin, destination });
    
    if (!origin || !destination) {
      logger.warn('❌ Origine ou destination manquante');
      return res.status(400).json({ error: 'origin et destination requis' });
    }

    const o = origin.address
      ? await TomTomGeocodingService.geocode(origin.address)
      : origin;
    const d = destination.address
      ? await TomTomGeocodingService.geocode(destination.address)
      : destination;

    if (!o || !d) {
      logger.error('❌ Géocodage échoué', { 
        originGeocoded: !!o, 
        destinationGeocoded: !!d 
      });
      return res.status(404).json({ error: 'Adresse introuvable' });
    }

    logger.info('✅ Géocodage réussi', { origin: o, destination: d });

    const result = await RouteOptimizer.optimizeRoute(o, d);
    
    logger.info('🎉 Optimisation terminée avec succès', { 
      routesCount: result.routes.length 
    });
    
    res.json(result);
  } catch (err) {
    logger.error('💥 Erreur d\'optimisation', { 
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => {
  logger.warn('❌ Route non trouvée', { path: req.path });
  res.status(404).json({ error: 'Route non trouvée' });
});

/* ==================== SERVER ==================== */
app.listen(config.port, () => {
  console.log('\n'.repeat(2));
  logger.info('='.repeat(60));
  logger.info(`🚀 Backend démarré sur le port ${config.port}`);
  logger.info('📊 Mode: DONNÉES RÉELLES TOMTOM');
  logger.info(`🔑 TomTom API: ${config.tomtomApiKey !== 'YOUR_TOMTOM_API_KEY_HERE' ? 'Configurée ✅' : 'NON CONFIGURÉE ❌'}`);
  logger.info(`🔑 Clé API: ${config.tomtomApiKey.substring(0, 15)}...`);
  logger.info('='.repeat(60));
  console.log('\n');
});

process.on('SIGTERM', async () => {
  logger.info('⚠️ Signal SIGTERM reçu, fermeture...');
  if (redisClient?.isOpen) await redisClient.quit();
  process.exit(0);
});