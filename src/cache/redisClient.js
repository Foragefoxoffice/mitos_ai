const Redis = require("ioredis");
const logger = require("../utils/logger");

// lazyConnect: don't connect until the first command is actually issued —
// otherwise requiring this module alone would start an immediate connection
// attempt that retries forever if Redis isn't reachable yet, hanging the
// process. maxRetriesPerRequest caps how long a single command will retry
// before failing instead of retrying indefinitely.
const redis = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

redis.on("error", (err) => {
  logger.error("[redis] connection error:", err.message);
});

const getJSON = async (key) => {
  const value = await redis.get(key);
  return value ? JSON.parse(value) : null;
};

const setJSON = async (key, value, ttlSeconds) => {
  const payload = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.set(key, payload, "EX", ttlSeconds);
  } else {
    await redis.set(key, payload);
  }
};

module.exports = { redis, getJSON, setJSON };
