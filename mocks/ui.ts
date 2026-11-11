/**
 * Look-review mocks: every Hive screen with fixture data, no game running.
 *   npm run dev → http://localhost:5173/mocks/ui.html?screen=menu|host|stash|raid|settings|won|lost
 *   npm run mocks → screenshots of each into tests/out/ui/
 */
import { HiveUI } from '../src/ui/hive/hive-ui';
import type { Tab } from '../src/ui/hive/hive-ui';
import { fixtureActions, fixtureProfile } from './fixtures';

const p = fixtureProfile();
const ui = new HiveUI(document.querySelector<HTMLElement>('#hive')!, () => p, fixtureActions(p, () => ui.notice('DEPLOYING · (mock)')), {
  pickHost: (id) => { p.host = id; },
});
const screen = new URLSearchParams(location.search).get('screen') ?? 'menu';
if (screen === 'won') {
  ui.showResults({ result: 'extracted', items: [{ item: 'glitchingHeart', count: 1 }, { item: 'mournbackMarrow', count: 1 }, { item: 'plagueStalkerStrain', count: 1 }, { item: 'needlemawGland', count: 3 }, { item: 'clotGel', count: 1 }], dna: 85, value: 905, kills: 11, time: 412 });
} else if (screen === 'lost') {
  ui.showResults({ result: 'lost', items: [{ item: 'synapseLens', count: 1 }, { item: 'adrenalineVirus', count: 1 }, { item: 'oculimothEye', count: 2 }], dna: 40, value: 310, kills: 4, time: 288, cause: 'Mournback horn charge', kept: [{ item: 'dnaStrand', count: 4 }] });
} else {
  ui.show(screen as Tab);
}
(window as unknown as { __mock: object }).__mock = { ready: true, ui, profile: p };
