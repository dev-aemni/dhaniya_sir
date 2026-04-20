import 'dotenv/config';
import path from 'node:path';

export const TOKEN           = process.env.TOKEN;
export const CLIENT_ID       = process.env.CLIENT_ID;
export const GUILD_ID        = process.env.GUILD_ID;
export const PORT            = Number(process.env.PORT || 0);
export const BOT_START_TIME  = Date.now();
export const MAX_TIMEOUT_MS  = 28 * 24 * 60 * 60 * 1000;

// ── Security ──────────────────────────────────────────────────────────────────
/** The one user who can run owner-only secret commands */
export const OWNER_ID = '1336387088320565360';

// ── AI / OpenRouter ───────────────────────────────────────────────────────────
export const OPENROUTER_API_KEY = process.env.openrouter_api || process.env.opentrouter_api || '';
export const SYSTEM_PROMPT      = process.env.system_prompt  || 'You are Dhaniya Sir, a helpful Discord bot.';
export const SYSTEM_AI_PROVIDER = process.env.system_AI  || 'google/gemini-2.0-flash-001';

if (!TOKEN) throw new Error('Missing TOKEN in .env');

// ── Data paths ────────────────────────────────────────────────────────────────
export const DATA_DIR        = process.env.RENDER_DISK_MOUNT_PATH || path.join(process.cwd(), 'data');
export const ALIAS_FILE      = path.join(DATA_DIR, 'aliases.json');
export const TAG_FILE        = path.join(DATA_DIR, 'tags.json');
export const SETTINGS_FILE   = path.join(DATA_DIR, 'settings.json');
export const AFK_FILE        = path.join(DATA_DIR, 'afk.json');
export const CONTROLLER_FILE = path.join(DATA_DIR, 'controllers.json');
