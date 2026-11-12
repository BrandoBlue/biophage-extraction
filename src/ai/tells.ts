/**
 * What a brain is thinking, turned into body language (Creature's drive.mind, docs/gdd/11-creature-minds.md rule 2:
 * "you can watch them think"). Pure functions so the mapping is tested headless; the Abomination eases the levels
 * and fires the pulses.
 */
import { AI } from '../../data';
import type { AIEvent, Intent } from './types';

/** The eased levels of Creature's MindTells (0..1; eyes 1 = open). */
export interface MindLevels { tilt: number; brace: number; still: number; dark: number; recoil: number; grieve: number; eyes: number }

export interface ThinkingView {
  kind: string;
  intent: Intent;
  windup: number;
  phase: string;
  /** Holding still because the host is looking at it (a stalker). */
  frozen: boolean;
}

/** Target body-language levels for what the creature is thinking right now. */
export function mindLevels(b: ThinkingView): MindLevels {
  const m: MindLevels = { tilt: 0, brace: 0, still: 0, dark: 0, recoil: 0, grieve: 0, eyes: 1 };
  const arch = AI.archetypes[b.kind] ?? 'swarm';
  switch (b.intent) {
    case 'wary': m.tilt = 0.55; break; // weighing up a noise
    case 'stare': m.tilt = 0.85; m.still = 0.7; break; // it has seen you and is deciding
    case 'lure': m.still = 0.35; break; // standing in plain view, wanting to be seen
    case 'falter': m.recoil = 0.7; m.grieve = 0.6; break; // a packmate just fell
    case 'evade': m.recoil = 0.35; break;
    case 'flee': m.recoil = 0.85; m.dark = 0.4; break;
    case 'reel': m.recoil = 0.5; break;
    case 'search': m.tilt = 0.3; break;
    case 'idle':
      // Oculimoth drift half asleep; their eyes snap open when they see you.
      if (arch === 'flyer') m.eyes = 0.15;
      break;
    default: break;
  }
  // Every committed attack braces first: feet planted, head down.
  if (b.windup > 0.05 && b.intent === 'attack') m.brace = Math.min(1, b.windup * 1.4);
  // A stalker caught in your gaze stops dead; you hear it stop.
  if (b.frozen) { m.still = 1; m.tilt = Math.max(m.tilt, 0.4); }
  return m;
}

/** The pulse an event fires, if any: `call` (chirp, hum, the pack being called) or `glint` (eyes catch the light). */
export function mindPulse(e: AIEvent): 'call' | 'glint' | null {
  switch (e.type) {
    case 'alert': case 'alarm': case 'screech': case 'rally': return 'call';
    case 'charge': return 'glint';
    case 'tactic':
      if (e.what === 'press' || e.what === 'spring' || e.what === 'rout') return 'call';
      if (e.what === 'lure' || e.what === 'adapt' || e.what === 'evade') return 'glint';
      return null;
    default: return null;
  }
}
