/**
 * In-raid HUD (Larva): the UI department's organic HUD (src/ui/raid/hud.ts, reference 04) on #hud, plus the
 * click-to-enter prompt with the full control list. Reads Raid.hud() each frame and listens to gameplay events;
 * never touches game objects. The raid debrief lives in the Hive (HiveMenu.showResults).
 */
import type { EventBus, GameEvents } from '../game/events';
import type { HudState } from '../game/raid';
import { CONTROLS, OrganicHud } from './raid/hud';

export class RaidHud {
  readonly hud: OrganicHud;
  private prompt = document.querySelector<HTMLElement>('#prompt')!;
  private lastPhase = '';

  constructor(bus: EventBus<GameEvents>) {
    this.hud = new OrganicHud(document.querySelector<HTMLElement>('#hud')!, bus as unknown as ConstructorParameters<typeof OrganicHud>[1]);
    this.prompt.innerHTML = `CLICK TO DROP INTO ZONE 7${CONTROLS}`;
  }

  update(dt: number, s: HudState): void {
    this.hud.update(dt, s);
    if (s.phase !== this.lastPhase) {
      this.lastPhase = s.phase;
      if (s.phase === 'raid') this.prompt.innerHTML = `CLICK TO TAKE CONTROL · THE RAID KEEPS RUNNING${CONTROLS}`;
      // The debrief owns the screen once the raid ends: never show the enter prompt behind it.
      this.prompt.classList.toggle('ended', s.phase === 'extracted' || s.phase === 'lost');
    }
  }
}
