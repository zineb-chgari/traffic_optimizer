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
  maxWalkingDistance: 800,
  transferPenalty: 180, // 3 minutes
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
      throw new Error('Routing service unavailable');
    }
  }

  static async getWalkingRoute(oLat, oLon, dLat, dLon) {
    return await this.getRoute(oLat, oLon, dLat, dLon, 'foot-walking');
  }
}

/* ==================== URBAN DENSITY ==================== */
class UrbanDensityService {
  static async calculateRealDensity(lat, lon, radius = 500) {
    const cacheKey = `density:${lat}:${lon}:${radius}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
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
          headers: { 
            'Content-Type': 'text/plain',
            'User-Agent': 'TransportOptimizer/2.0'
          },
          timeout: 15000
        }
      );

      const elements = res.data?.elements || [];
      const buildings = elements.filter(e => e.tags?.building).length;
      const amenities = elements.filter(e => e.tags?.amenity).length;
      const shops = elements.filter(e => e.tags?.shop).length;

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
      logger.error(`Urban density error: ${err.message}`);
      return {
        buildings: 0,
        amenities: 0,
        shops: 0,
        totalFeatures: 0,
        densityScore: 50,
        radius,
        source: 'fallback',
        interpretation: 'unknown'
      };
    }
  }
}

/* ==================== PUBLIC TRANSPORT ==================== */
class PublicTransportService {
  static async getTransitLinesNearby(lat, lon, radius = 1000) {
    const cacheKey = `transit:${lat}:${lon}:${radius}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const query = `
        [out:json][timeout:25];
        (
          node(around:${radius},${lat},${lon})["public_transport"="stop_position"];
          node(around:${radius},${lat},${lon})["public_transport"="platform"];
          node(around:${radius},${lat},${lon})["highway"="bus_stop"];
          node(around:${radius},${lat},${lon})["railway"="tram_stop"];
          node(around:${radius},${lat},${lon})["railway"="station"];
          node(around:${radius},${lat},${lon})["railway"="halt"];
          node(around:${radius},${lat},${lon})["amenity"="bus_station"];
        );
        out body;
      `;

      const res = await axios.post(
        'https://overpass-api.de/api/interpreter',
        query,
        {
          headers: { 
            'Content-Type': 'text/plain',
            'User-Agent': 'TransportOptimizer/2.0'
          },
          timeout: 25000
        }
      );

      const elements = res.data?.elements || [];
      logger.info(`Overpass returned ${elements.length} stops for lat=${lat}, lon=${lon}`);

      const stops = elements
        .filter(e => e.lat && e.lon)
        .map(stop => {
          const routeRef = stop.tags?.route_ref || stop.tags?.ref || stop.tags?.name?.match(/\d+/)?.[0] || 'L1';
          
          return {
            id: stop.id,
            lat: stop.lat,
            lon: stop.lon,
            name: stop.tags?.name || stop.tags?.ref || `Stop ${stop.id}`,
            type: stop.tags?.public_transport || stop.tags?.highway || stop.tags?.railway || stop.tags?.amenity || 'bus_stop',
            routes: routeRef ? routeRef.split(';').map(r => r.trim()) : ['L1', 'L2'],
            operator: stop.tags?.operator || stop.tags?.network || 'Local Transport'
          };
        });

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
      return {
        stops: [],
        count: 0,
        source: 'overpass-api-error',
        searchRadius: radius,
        error: err.message
      };
    }
  }

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

/* ==================== ROUTE OPTIMIZATION ==================== */
class RouteOptimizer {
  static async optimizeRoute(origin, destination) {
    const anomalies = [];
    const warnings = [];

    logger.info(`Finding transit stops near origin (${origin.lat}, ${origin.lon})`);
    const originTransit = await PublicTransportService.getTransitLinesNearby(
      origin.lat, origin.lon, 2000
    );
    let originStops = originTransit.stops;
    
    if (originStops.length === 0) {
      const originTransitLarge = await PublicTransportService.getTransitLinesNearby(
        origin.lat, origin.lon, 5000
      );
      originStops = originTransitLarge.stops;
      
      if (originStops.length === 0) {
        anomalies.push({
          type: 'NO_TRANSIT_ORIGIN',
          severity: 'warning',
          message: `No public transit stops found within 5km of origin. Using simulated data.`
        });
        originStops = this.generateFallbackStops(origin.lat, origin.lon, 'origin');
      }
    }

    logger.info(`Finding transit stops near destination (${destination.lat}, ${destination.lon})`);
    const destTransit = await PublicTransportService.getTransitLinesNearby(
      destination.lat, destination.lon, 2000
    );
    let destStops = destTransit.stops;
    
    if (destStops.length === 0) {
      const destTransitLarge = await PublicTransportService.getTransitLinesNearby(
        destination.lat, destination.lon, 5000
      );
      destStops = destTransitLarge.stops;
      
      if (destStops.length === 0) {
        anomalies.push({
          type: 'NO_TRANSIT_DEST',
          severity: 'warning',
          message: `No public transit stops found within 5km of destination. Using simulated data.`
        });
        destStops = this.generateFallbackStops(destination.lat, destination.lon, 'destination');
      }
    }

    logger.info('Calculating walking distances to accessible stops...');
    const accessibleOriginStops = await PublicTransportService.findAccessibleStops(
      origin.lat, origin.lon, originStops
    );
    
    const accessibleDestStops = await PublicTransportService.findAccessibleStops(
      destination.lat, destination.lon, destStops
    );

    if (accessibleOriginStops.length === 0) {
      warnings.push({
        type: 'NO_ACCESSIBLE_STOPS_ORIGIN',
        message: `All origin stops exceed maximum walking distance. Using nearest stops.`
      });
      
      for (const stop of originStops.slice(0, 3)) {
        try {
          const walkingRoute = await OpenRouteService.getWalkingRoute(
            origin.lat, origin.lon, stop.lat, stop.lon
          );
          accessibleOriginStops.push({
            ...stop,
            walkingDistance: Math.round(walkingRoute.distance),
            walkingDuration: Math.round(walkingRoute.duration),
            walkingRoute: walkingRoute.coordinates,
            accessible: false
          });
        } catch {}
      }
    }

    if (accessibleDestStops.length === 0) {
      warnings.push({
        type: 'NO_ACCESSIBLE_STOPS_DEST',
        message: `All destination stops exceed maximum walking distance. Using nearest stops.`
      });
      
      for (const stop of destStops.slice(0, 3)) {
        try {
          const walkingRoute = await OpenRouteService.getWalkingRoute(
            destination.lat, destination.lon, stop.lat, stop.lon
          );
          accessibleDestStops.push({
            ...stop,
            walkingDistance: Math.round(walkingRoute.distance),
            walkingDuration: Math.round(walkingRoute.duration),
            walkingRoute: walkingRoute.coordinates,
            accessible: false
          });
        } catch {}
      }
    }

    logger.info('Analyzing urban density...');
    const originDensity = await UrbanDensityService.calculateRealDensity(origin.lat, origin.lon);
    const destDensity = await UrbanDensityService.calculateRealDensity(destination.lat, destination.lon);

    logger.info('Finding common transit routes...');
    const routes = [];
    
    for (const originStop of accessibleOriginStops.slice(0, 5)) {
      for (const destStop of accessibleDestStops.slice(0, 5)) {
        const commonRoutes = originStop.routes.filter(r => 
          destStop.routes.includes(r)
        );

        if (commonRoutes.length > 0) {
          for (const routeId of commonRoutes) {
            try {
              const transitRoute = await OpenRouteService.getRoute(
                originStop.lat, originStop.lon,
                destStop.lat, destStop.lon,
                'driving-car'
              );

              const totalWalkDuration = originStop.walkingDuration + destStop.walkingDuration;
              const totalDuration = transitRoute.duration + totalWalkDuration;

              routes.push({
                type: 'DIRECT',
                routeId,
                originStop,
                destStop,
                transitDistance: Math.round(transitRoute.distance),
                transitDuration: Math.round(transitRoute.duration),
                totalWalkingDistance: originStop.walkingDistance + destStop.walkingDistance,
                totalWalkingDuration: totalWalkDuration,
                transfers: 0,
                totalDuration: Math.round(totalDuration),
                coordinates: [
                  ...originStop.walkingRoute,
                  ...transitRoute.coordinates,
                  ...destStop.walkingRoute
                ],
                source: originStop.isFallback || destStop.isFallback ? 'simulated-data' : 'real-data'
              });
            } catch (err) {
              logger.warn(`Route calculation failed: ${err.message}`);
            }
          }
        }
      }
    }

    // Fallback: create route with nearest stops
    if (routes.length === 0 && accessibleOriginStops.length > 0 && accessibleDestStops.length > 0) {
      warnings.push({
        type: 'NO_DIRECT_ROUTES',
        message: 'No common routes found. Creating best-effort route.'
      });

      try {
        const originStop = accessibleOriginStops[0];
        const destStop = accessibleDestStops[0];
        
        const transitRoute = await OpenRouteService.getRoute(
          originStop.lat, originStop.lon,
          destStop.lat, destStop.lon,
          'driving-car'
        );

        const totalWalkDuration = originStop.walkingDuration + destStop.walkingDuration;
        const totalDuration = transitRoute.duration + totalWalkDuration + config.transferPenalty;

        routes.push({
          type: 'TRANSFER',
          routeId: `${originStop.routes[0]}-${destStop.routes[0]}`,
          originStop,
          destStop,
          transitDistance: Math.round(transitRoute.distance),
          transitDuration: Math.round(transitRoute.duration),
          totalWalkingDistance: originStop.walkingDistance + destStop.walkingDistance,
          totalWalkingDuration: totalWalkDuration,
          transfers: 1,
          totalDuration: Math.round(totalDuration),
          coordinates: [
            ...originStop.walkingRoute,
            ...transitRoute.coordinates,
            ...destStop.walkingRoute
          ],
          source: originStop.isFallback || destStop.isFallback ? 'simulated-data' : 'real-data'
        });
      } catch (err) {
        logger.error(`Fallback route failed: ${err.message}`);
      }
    }

    routes.sort((a, b) => a.totalDuration - b.totalDuration);

    const scoredRoutes = routes.map(route => ({
      ...route,
      score: this.calculateScore(route, originDensity, destDensity)
    }));

    return {
      routes: scoredRoutes.slice(0, 3),
      origin: {
        ...origin,
        density: originDensity,
        nearbyStops: accessibleOriginStops.length
      },
      destination: {
        ...destination,
        density: destDensity,
        nearbyStops: accessibleDestStops.length
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

  static calculateScore(route, originDensity, destDensity) {
    let score = 100;
    score -= (route.totalDuration / 60) * 0.5;
    score -= (route.totalWalkingDistance / 100) * 1.5;
    score -= route.transfers * 10;

    const avgDensity = (originDensity.densityScore + destDensity.densityScore) / 2;
    if (avgDensity > 70) score += 5;

    return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  }

  static generateFallbackStops(lat, lon, label) {
    const stops = [];
    const offsets = [
      { latOffset: 0.003, lonOffset: 0.003 },
      { latOffset: -0.003, lonOffset: 0.003 },
      { latOffset: 0.003, lonOffset: -0.003 }
    ];

    offsets.forEach((offset, idx) => {
      stops.push({
        id: `fallback_${label}_${idx}`,
        lat: lat + offset.latOffset,
        lon: lon + offset.lonOffset,
        name: `${label} Stop ${idx + 1} (Simulated)`,
        type: 'bus_stop',
        routes: [`L${idx + 1}`, `L${idx + 2}`],
        operator: 'Simulated',
        isFallback: true
      });
    });

    return stops;
  }
}

/* ==================== ROUTES ==================== */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    redis: redisClient?.isOpen || false,
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
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Route non trouvée' }));

/* ==================== SERVER ==================== */
app.listen(config.port, () => {
  logger.info(`🚀 Backend démarré sur le port ${config.port}`);
  logger.info('📊 Mode: DONNÉES RÉELLES avec détails des itinéraires');
});

process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  process.exit(0);
});