import fs from 'node:fs';
import { EmbedBuilder, ButtonBuilder, Message } from 'discord.js';
import { DATA_DIR, ALIAS_FILE, TAG_FILE, SETTINGS_FILE, AFK_FILE } from './config';

// ── Types ─────────────────────────────────────────────────────────────────────
export type TextStore      = Record<string, string>;
export type GuildTextStore = Record<string, TextStore>;
export type PrefixStore    = Record<string, string>;
export type AfkStore       = Record<string, { reason: string; time: number }>;
export type ActiveChat     = { history: { role: 'user'|'assistant'; content: string }[]; lastActivity: number };
export type ControllerStore = Record<string, string[]>; // guildId -> roleIds[]
export type GiveawayEntry  = {
  messageId: string; guildId: string; channelId: string; title: string;
  hostName: string; winnersCount: number; endAt: number;
  participants: Set<string>; ended: boolean;
};

// ── Mutable globals (exported as let so utils.ts can reassign via setters) ────
export let DEFAULT_PREFIXES: string[]              = ['> ', '>', 'ds-', "'", ':)'];
export let GLOBAL_ALIASES:   Record<string, string> = {
  '?ds':                "Yes Sir! I am working! I am here!",
  'chal raha mera bot?':"Ha, bilkul",
  'soja ds':            "Ok, bye! Good night! Badh mein ata hu!",
  'kuchi kuchi':        "https://tenor.com/view/cute-cat-cute-kuchi-k-kuchi-puchi-kuchi-gif-4714708621124139871",
  'bhoot':              "░░░░░░░░░░░░░░░░░░░░\n░░░░░▐▀█▀▌░░░░▀█▄░░░ \n░░░░░▐█▄█▌░░░░░░▀█▄░░ \n░░░░░░▀▄▀░░░▄▄▄▄▄▀▀░░ \n░░░░▄▄▄██▀▀▀▀░░░░░░░ \n░░░█▀▄▄▄█░▀▀░░ \n░░░▌░▄▄▄▐▌▀▀▀░░ \n▄░▐░░░▄▄░█░▀▀ ░░ \n▀█▌░░░▄░▀█▀░▀ ░░ \n░░░░░░░▄▄▐▌▄▄░░░ \n░░░░░░░▀███▀█░▄░░ \n░░░░░░▐▌▀▄▀▄▀▐▄░░ \n░░░░░░▐▀░░░░░░▐▌░░ \n░░░░░░█░░░░░░░░█░░░░░░░\n░░░░░░█░░░░░░░░█░░░░░░░\n░░░░░░█░░░░░░░░█░░░░░░░\n░░░░▄██▄░░░░░▄██▄░░░",
  'gm ds':              "Good Morning Sir!",
  'i love you ds':      "I love you too ! muummaa",
};

/** Setter so utils.ts can mutate DEFAULT_PREFIXES without illegal import reassignment */
export function setDefaultPrefixes(arr: string[]) { DEFAULT_PREFIXES = arr; }
export function setGlobalAliases(obj: Record<string, string>) { GLOBAL_ALIASES = obj; }

// ── Persistence helpers ───────────────────────────────────────────────────────
export function ensureStore(filePath: string): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '{}', 'utf8');
}

export function loadGuildTextStore(filePath: string): GuildTextStore {
  ensureStore(filePath);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (typeof parsed !== 'object' || !parsed) return {};
    const result: GuildTextStore = {};
    for (const [gId, bucket] of Object.entries(parsed)) {
      if (typeof bucket !== 'object' || !bucket) continue;
      result[gId] = {};
      for (const [k, v] of Object.entries(bucket as Record<string, unknown>))
        if (typeof v === 'string') result[gId][k] = v;
    }
    return result;
  } catch { return {}; }
}

export function loadPrefixStore(filePath: string): PrefixStore {
  ensureStore(filePath);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (typeof parsed !== 'object' || !parsed) return {};
    const result: PrefixStore = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k === '_global_prefixes' && Array.isArray(v))
        DEFAULT_PREFIXES = v.filter(p => typeof p === 'string' && p.trim());
      else if (k === '_global_aliases' && typeof v === 'object' && v)
        GLOBAL_ALIASES = { ...GLOBAL_ALIASES, ...(v as Record<string, string>) };
      else if (typeof v === 'string' && v.trim())
        result[k] = v.trim();
    }
    return result;
  } catch { return {}; }
}

export function loadAfkStore(filePath: string): AfkStore {
  ensureStore(filePath);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as AfkStore; } catch { return {}; }
}

export function loadControllerStore(filePath: string): ControllerStore {
  ensureStore(filePath);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (typeof parsed !== 'object' || !parsed) return {};
    const result: ControllerStore = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) result[k] = v.filter(id => typeof id === 'string' && id.trim());
    }
    return result;
  } catch { return {}; }
}

export function saveStore(filePath: string, store: any): void {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}
export function savePrefixStore(filePath: string, store: PrefixStore): void {
  fs.writeFileSync(filePath, JSON.stringify({ ...store, _global_prefixes: DEFAULT_PREFIXES, _global_aliases: GLOBAL_ALIASES }, null, 2), 'utf8');
}
export function ensureGuildBucket(store: GuildTextStore, guildId: string): TextStore {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}

// ── Singleton stores ──────────────────────────────────────────────────────────
export const aliases              = loadGuildTextStore(ALIAS_FILE);
export const tags                 = loadGuildTextStore(TAG_FILE);
export const prefixes             = loadPrefixStore(SETTINGS_FILE);
export const afks                 = loadAfkStore(AFK_FILE);
export const controllers          = new Map<string, string[]>(); // guildId -> roleIds[]
export const giveaways            = new Map<string, GiveawayEntry>();
export const activeEmbedBuilders  = new Map<string, {
  embed: EmbedBuilder; buttons: ButtonBuilder[]; botMsg: Message;
  awaiting: string | null; editTarget?: Message;
}>();
/** Per-user AI chat sessions: userId -> conversation history + timestamp */
export const activeChatSessions   = new Map<string, ActiveChat>();
