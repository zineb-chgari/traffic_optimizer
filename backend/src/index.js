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
  tomtomKey: process.env.TOMTOM_API_KEY || 'YOUR_TOMTOM_KEY'
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

/* ==================== CACHE ==================== */
class CacheService {
  static async get(key) {
    if (!redisClient?.isOpen) return null;
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch { return null; }
  }

  static async set(key, value, ttl = config.cacheTTL) {
    if (!redisClient?.isOpen) return;
    try { await redisClient.setEx(key, ttl, JSON.stringify(value)); } catch {}
  }
}

/* ==================== TOMTOM ROUTING ==================== */
class TomTomService {
  static async getRoute(oLat, oLon, dLat, dLon, travelMode = 'car') {
    const cacheKey = `tomtom:${oLat}:${oLon}:${dLat}:${dLon}:${travelMode}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const url = `https://api.tomtom.com/routing/1/calculateRoute/${oLat},${oLon}:${dLat},${dLon}/json`;
      const res = await axios.get(url, {
        params: {
          key: config.tomtomKey,
          travelMode,
          traffic: true,
          routeRepresentation: 'polyline',
          instructionsType: 'text'
        },
        timeout: 10000
      });

      const route = res.data.routes?.[0];
      if (!route) throw new Error('No route found');

      const leg = route.legs[0];
      const data = {
        distance: leg.summary.lengthInMeters,
        duration: leg.summary.travelTimeInSeconds,
        trafficDelay: leg.summary.trafficDelayInSeconds,
        departureTime: leg.summary.departureTime,
        arrivalTime: leg.summary.arrivalTime,
        coordinates: leg.points.map(p => [p.latitude, p.longitude]),
        source: 'tomtom'
      };

      await CacheService.set(cacheKey, data, 3600);
      return data;
    } catch (err) {
      logger.error(`TomTom routing error: ${err.message}`);
      throw new Error('Routing service unavailable');
    }
  }
}

/* ==================== ROUTES ==================== */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', redis: redisClient?.isOpen || false, timestamp: new Date().toISOString() });
});

app.post('/api/routes/tomtom', async (req, res) => {
  try {
    const { origin, destination, travelMode } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'origin et destination requis' });
    }

    const route = await TomTomService.getRoute(
      origin.lat, origin.lon,
      destination.lat, destination.lon,
      travelMode || 'car'
    );

    res.json(route);
  } catch (err) {
    logger.error('TomTom API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Route non trouvée' }));

/* ==================== SERVER ==================== */
app.listen(config.port, () => {
  logger.info(`🚀 Backend démarré sur le port ${config.port}`);
  logger.info('📊 Trafic réel avec TomTom activé');
});

process.on('SIGTERM', async () => {
  if (redisClient?.isOpen) await redisClient.quit();
  process.exit(0);
});
