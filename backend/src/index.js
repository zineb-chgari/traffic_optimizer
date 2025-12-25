import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from 'redis';
import axios from 'axios';
import winston from 'winston';
import dotenv from 'dotenv';

dotenv.config();

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
  tomtomApiKey: process.env.TOMTOM_API_KEY,
  maxWalkingDistance: 800,
  transferPenalty: 180,
  walkingSpeed: 1.4,
  requestTimeout: 20000
};

// Validation de l'API key
if (!config.tomtomApiKey || config.tomtomApiKey === 'YOUR_TOMTOM_API_KEY_HERE') {
  logger.error('❌ TOMTOM_API_KEY non configurée dans .env');
  process.exit(1);
}

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
    logger.info(`🔍 Geocoding: ${address}`);
    
    const cacheKey = `geocode:tomtom:${address}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) {
      logger.info('✅ Cache hit for geocoding');
      return cached;
    }

    try {
      const res = await axios.get(
        `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json`,
        {
          params: {
            key: config.tomtomApiKey,
            limit: 1,
            countrySet: 'MA'
          },
          timeout: config.requestTimeout
        }
      );

      if (!res.data?.results?.[0]) {
        logger.warn(`⚠️ Pas de résultat pour: ${address}`);
        return null;
      }

      const result = res.data.results[0];
      const geo = {
        lat: result.position.lat,
        lon: result.position.lon,
        display_name: result.address.freeformAddress,
        country: result.address.country,
        city: result.address.municipality || result.address.localName
      };

      logger.info(`✅ Géocodé: ${geo.display_name}`);
      await CacheService.set(cacheKey, geo, 3600);
      
      return geo;
    } catch (err) {
      logger.error(`❌ Geocoding error: ${err.message}`);
      if (err.response) {
        logger.error(`Response: ${JSON.stringify(err.response.data)}`);
      }
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
          timeout: config.requestTimeout
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
      logger.error(`Routing error: ${err.message}`);
      throw new Error('Routing service unavailable');
    }
  }

  static async getWalkingRoute(oLat, oLon, dLat, dLon) {
    return await this.getRoute(oLat, oLon, dLat, dLon, 'pedestrian');
  }
}

/* ==================== URBAN DENSITY ANALYZER ==================== */
class UrbanDensityAnalyzer {
  static async analyzeZone(lat, lon, radius = 500) {
    const cacheKey = `density:${lat}:${lon}:${radius}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      logger.info(`📊 Analyzing urban density for (${lat}, ${lon})`);

      // 1. Récupérer les POIs (indicateur de densité)
      const pois = await this.getPOIsInZone(lat, lon, radius);
      
      // 2. Récupérer le trafic (indicateur d'activité)
      const traffic = await TomTomTrafficService.getTrafficInfo(lat, lon);

      // 3. Calculer le score de densité
      const analysis = {
        poiCount: pois.length,
        trafficDensity: this.calculateTrafficDensity(traffic),
        urbanScore: this.calculateUrbanScore(pois, traffic),
        zoneType: this.classifyZone(pois, traffic),
        confidence: traffic?.confidence || 0.5
      };

      await CacheService.set(cacheKey, analysis, 1800);
      logger.info(`✅ Densité calculée: ${analysis.zoneType} (score: ${analysis.urbanScore})`);
      
      return analysis;
    } catch (err) {
      logger.error(`Density analysis error: ${err.message}`);
      return {
        poiCount: 0,
        trafficDensity: 0,
        urbanScore: 50,
        zoneType: 'unknown',
        confidence: 0
      };
    }
  }

  static async getPOIsInZone(lat, lon, radius) {
    try {
      const res = await axios.get(
        `https://api.tomtom.com/search/2/nearbySearch/.json`,
        {
          params: {
            key: config.tomtomApiKey,
            lat: lat,
            lon: lon,
            radius: radius,
            limit: 100
          },
          timeout: config.requestTimeout
        }
      );
      return res.data?.results || [];
    } catch (err) {
      logger.error('POI search error:', err.message);
      return [];
    }
  }

  static calculateTrafficDensity(traffic) {
    if (!traffic || !traffic.freeFlowSpeed) return 0;
    
    // Ratio vitesse actuelle / vitesse libre (0-100)
    const ratio = traffic.currentSpeed / traffic.freeFlowSpeed;
    
    // Plus le ratio est bas, plus la densité est élevée
    return Math.round((1 - ratio) * 100);
  }

  static calculateUrbanScore(pois, traffic) {
    // Score basé sur 3 facteurs:
    // 1. Nombre de POIs (0-50 points)
    const poiScore = Math.min(50, pois.length);
    
    // 2. Densité du trafic (0-30 points)
    const trafficScore = this.calculateTrafficDensity(traffic) * 0.3;
    
    // 3. Confiance des données (0-20 points)
    const confidenceScore = (traffic?.confidence || 0.5) * 20;
    
    return Math.round(poiScore + trafficScore + confidenceScore);
  }

  static classifyZone(pois, traffic) {
    const score = this.calculateUrbanScore(pois, traffic);
    
    if (score >= 70) return 'urban';      // Zone urbaine dense
    if (score >= 40) return 'suburban';   // Zone suburbaine
    return 'rural';                        // Zone rurale/périphérique
  }

  static adjustRouteScore(route, originDensity, destDensity) {
    let adjustment = 0;

    // Bonus pour zones urbaines denses (meilleure desserte)
    if (originDensity.zoneType === 'urban') adjustment += 5;
    if (destDensity.zoneType === 'urban') adjustment += 5;

    // Pénalité pour zones rurales (desserte moins fréquente)
    if (originDensity.zoneType === 'rural') adjustment -= 8;
    if (destDensity.zoneType === 'rural') adjustment -= 8;

    // Bonus si les deux zones sont du même type (cohérence)
    if (originDensity.zoneType === destDensity.zoneType) adjustment += 3;

    return adjustment;
  }
}

/* ==================== TOMTOM TRANSIT SEARCH ==================== */
class TomTomTransitService {
  static async getTransitStopsNearby(lat, lon, radius = 1000) {
    const cacheKey = `tomtom:transit:${lat}:${lon}:${radius}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
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
          timeout: config.requestTimeout
        }
      );

      const results = res.data?.results || [];
      logger.info(`Found ${results.length} transit stops near (${lat}, ${lon})`);

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
      logger.error(`Transit search error: ${err.message}`);
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
    
    // Retourner un tableau vide si aucune route trouvée (pas de fallback)
    return routes;
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
      logger.error(`Traffic info error: ${err.message}`);
      return null;
    }
  }
}

/* ==================== ROUTE OPTIMIZATION ==================== */
class RouteOptimizer {
  static async optimizeRoute(origin, destination) {
    const warnings = [];

    // 1. Analyser la densité urbaine des zones
    logger.info('📊 Analyzing urban density...');
    const [originDensity, destDensity] = await Promise.all([
      UrbanDensityAnalyzer.analyzeZone(origin.lat, origin.lon),
      UrbanDensityAnalyzer.analyzeZone(destination.lat, destination.lon)
    ]);

    // 2. Ajuster le rayon de recherche selon la densité
    const originRadius = originDensity.zoneType === 'urban' ? 1000 : 2000;
    const destRadius = destDensity.zoneType === 'urban' ? 1000 : 2000;

    logger.info(`Finding stops: origin radius=${originRadius}m, dest radius=${destRadius}m`);

    // 3. Rechercher les arrêts
    const originTransit = await TomTomTransitService.getTransitStopsNearby(
      origin.lat, origin.lon, originRadius
    );
    let originStops = originTransit.stops;

    const destTransit = await TomTomTransitService.getTransitStopsNearby(
      destination.lat, destination.lon, destRadius
    );
    let destStops = destTransit.stops;

    // 4. Validation des arrêts
    if (originStops.length === 0) {
      throw new Error('Aucun arrêt de transport trouvé près de l\'origine.');
    }

    if (destStops.length === 0) {
      throw new Error('Aucun arrêt de transport trouvé près de la destination.');
    }

    // 5. Calculer les arrêts accessibles
    logger.info('Calculating accessible stops...');
    const accessibleOriginStops = await TomTomTransitService.findAccessibleStops(
      origin.lat, origin.lon, originStops.slice(0, 10)
    );

    const accessibleDestStops = await TomTomTransitService.findAccessibleStops(
      destination.lat, destination.lon, destStops.slice(0, 10)
    );

    if (accessibleOriginStops.length === 0) {
      warnings.push({
        type: 'NO_ACCESSIBLE_STOPS_ORIGIN',
        message: `Tous les arrêts d'origine dépassent la distance de marche maximale (${config.maxWalkingDistance}m).`
      });
    }

    if (accessibleDestStops.length === 0) {
      warnings.push({
        type: 'NO_ACCESSIBLE_STOPS_DEST',
        message: `Tous les arrêts de destination dépassent la distance de marche maximale (${config.maxWalkingDistance}m).`
      });
    }

    // 6. Récupérer les infos de trafic
    logger.info('Getting traffic info...');
    const [originTraffic, destTraffic] = await Promise.all([
      TomTomTrafficService.getTrafficInfo(origin.lat, origin.lon),
      TomTomTrafficService.getTrafficInfo(destination.lat, destination.lon)
    ]);

    // 7. Calculer les routes optimales
    logger.info('Calculating optimal routes...');
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

          // Vérifier si les arrêts ont des lignes valides
          const hasValidRoutes = originStop.routes.length > 0 && destStop.routes.length > 0;

          routes.push({
            type: 'DIRECT',
            routeId: hasValidRoutes 
              ? `${originStop.routes[0]}-${destStop.routes[0]}`
              : `Route ${i + 1}`,
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
            source: 'tomtom-real-data',
            densityAnalysis: {
              origin: originDensity,
              destination: destDensity
            }
          });
        } catch (err) {
          logger.warn(`Route calculation failed: ${err.message}`);
        }
      }
    }

    // 8. Trier et scorer les routes
    routes.sort((a, b) => a.totalDuration - b.totalDuration);

    const scoredRoutes = routes.map(route => {
      const baseScore = this.calculateBaseScore(route, originTraffic, destTraffic);
      const densityAdjustment = UrbanDensityAnalyzer.adjustRouteScore(
        route, 
        originDensity, 
        destDensity
      );
      
      return {
        ...route,
        score: Math.max(0, Math.min(100, baseScore + densityAdjustment)),
        densityAdjustment
      };
    });

    // Re-trier par score final
    scoredRoutes.sort((a, b) => b.score - a.score);

    return {
      routes: scoredRoutes.slice(0, 5),
      origin: {
        ...origin,
        traffic: originTraffic,
        density: originDensity,
        nearbyStops: originStops.length,
        accessibleStops: accessibleOriginStops.length
      },
      destination: {
        ...destination,
        traffic: destTraffic,
        density: destDensity,
        nearbyStops: destStops.length,
        accessibleStops: accessibleDestStops.length
      },
      warnings,
      metadata: {
        totalStopsFound: originStops.length + destStops.length,
        accessibleOriginStops: accessibleOriginStops.length,
        accessibleDestStops: accessibleDestStops.length,
        routesCalculated: routes.length,
        densityAnalysisApplied: true,
        originDensityType: originDensity.zoneType,
        destDensityType: destDensity.zoneType,
        dataSource: 'TomTom Real-Time + Urban Density Analysis',
        timestamp: new Date().toISOString()
      }
    };
  }

  static calculateBaseScore(route, originTraffic, destTraffic) {
    let score = 100;
    
    // Pénalités pour durée, marche, correspondances
    score -= (route.totalDuration / 60) * 0.5;
    score -= (route.totalWalkingDistance / 100) * 1.5;
    score -= route.transfers * 10;
    score -= (route.trafficDelay / 60) * 2;

    // Bonus pour confiance des données de trafic
    if (originTraffic?.confidence > 0.7) score += 3;
    if (destTraffic?.confidence > 0.7) score += 3;

    return Math.round(score * 10) / 10;
  }
}

/* ==================== ROUTES ==================== */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    redis: redisClient?.isOpen || false,
    tomtom: !!config.tomtomApiKey,
    features: {
      urbanDensityAnalysis: true,
      realTimeTraffic: true,
      transitOptimization: true
    },
    timestamp: new Date().toISOString()
  });
});

app.post('/api/routes/optimize', async (req, res) => {
  try {
    logger.info('🚀 New optimization request');
    
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
      return res.status(404).json({ 
        error: 'Adresse introuvable',
        details: {
          origin: o ? 'OK' : 'NOT_FOUND',
          destination: d ? 'OK' : 'NOT_FOUND'
        }
      });
    }

    const result = await RouteOptimizer.optimizeRoute(o, d);
    
    logger.info(`✅ Optimization complete: ${result.routes.length} routes found`);
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
  logger.info('📊 Mode: DONNÉES RÉELLES + ANALYSE DENSITÉ URBAINE');
  logger.info(`🔑 TomTom API: ${config.tomtomApiKey ? 'Configurée ✅' : 'NON CONFIGURÉE ❌'}`);
  console.log('\n✅ Server ready with urban density analysis');
});

process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  process.exit(0);
});