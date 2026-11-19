import dotenv from 'dotenv';

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  // Supabase — server-side ONLY. Never expose to frontend.
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  // Daily Stock Scanner Scheduler
  SCANNER_CRON_SECRET: process.env.SCANNER_CRON_SECRET || '',
  ENABLE_AUTOMATIC_DAILY_SCAN: process.env.ENABLE_AUTOMATIC_DAILY_SCAN !== 'false',
  // OpenAI Integration — server-side ONLY. Never expose to frontend.
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MODEL_DEEP: process.env.OPENAI_MODEL_DEEP || '',
  OPENAI_MODEL_BALANCED: process.env.OPENAI_MODEL_BALANCED || '',
  OPENAI_MODEL_FAST: process.env.OPENAI_MODEL_FAST || '',
  AI_REASONING_EFFORT: process.env.AI_REASONING_EFFORT || 'medium',
  AI_MAX_TOOL_CALLS: parseInt(process.env.AI_MAX_TOOL_CALLS || '5', 10),
  AI_REQUEST_TIMEOUT_MS: parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '30000', 10),
};
