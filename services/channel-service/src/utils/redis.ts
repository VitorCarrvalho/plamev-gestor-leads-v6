import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { config } from 'dotenv';

config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis connection for deduplication and general use
export const redisClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

// Redis connection for BullMQ
export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

// BullMQ Queue for incoming messages
export const messageQueue = new Queue('incoming-messages', { connection });

export async function isDuplicate(msgId: string, channel: string): Promise<boolean> {
  const key = `dedup:${channel}:${msgId}`;
  const exists = await redisClient.get(key);
  if (exists) {
    return true;
  }
  // Set with 24h expiration
  await redisClient.setex(key, 86400, '1');
  return false;
}
