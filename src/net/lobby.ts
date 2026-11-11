/**
 * The Hive-Mind panel: open a squad, share its code or invite link, join one, pick a side, see who is in.
 * Sits in the corner of the Hive menu. Colours and type are the UI theme's CSS variables (src/ui/theme.ts), so
 * palette.ts stays the only source of colour; the UI department can restyle it freely.
 */
import { CLASSES } from '../../data';
import type { ClassId } from '../../data';
import type { NetSession } from './session';
import { inviteLink, parseCode } from './protocol';

const CSS = `
#hivemind { --u:min(1vw, 1.7778vh); position:fixed; left:calc(var(--u) * 2.4); bottom:calc(var(--u) * 2.6); z-index:6; width:calc(var(--u) * 19);
  font-family:var(--ui); color:var(--bone); font-size:max(11px, calc(var(--u) * .78)); letter-spacing:.02em; user-select:none; }
#hivemind.hidden { display:none; }
#hivemind .hm-card { background:color-mix(in srgb, var(--background) 78%, transparent); backdrop-filter:blur(10px);
  border:1px solid color-mix(in srgb, var(--bone) 18%, transparent); border-radius:22px 6px 22px 6px; padding:calc(var(--u) * 1) calc(var(--u) * 1.2); }
#hivemind .hm-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; cursor:pointer; }
#hivemind.collapsed { width:auto; }
#hivemind.collapsed .hm-card { border-radius:999px; padding:calc(var(--u) * .45) calc(var(--u) * 1.2); }
#hivemind.collapsed h3 { font-size:1.25em; }
#hivemind .hm-head .hm-toggle { font-size:.72em; letter-spacing:.3em; text-transform:uppercase; color:var(--amber); }
#hivemind h3 { margin:0; font-family:var(--display); font-weight:600; font-size:1.7em; letter-spacing:.02em; }
#hivemind .hm-sub { font-size:.72em; letter-spacing:.3em; text-transform:uppercase; opacity:.6; }
#hivemind p { margin:8px 0 0; line-height:1.45; opacity:.85; }
#hivemind .hm-row { display:flex; gap:8px; margin-top:10px; align-items:center; }
#hivemind button { font:inherit; font-size:.82em; letter-spacing:.18em; text-transform:uppercase; color:var(--bone); cursor:pointer;
  background:color-mix(in srgb, var(--panel) 70%, transparent); border:1px solid color-mix(in srgb, var(--bone) 30%, transparent);
  border-radius:999px; padding:.6em 1.1em; transition:transform .12s, background .12s, border-color .12s; }
#hivemind button:hover { transform:translateY(-1px); border-color:var(--amber); background:color-mix(in srgb, var(--amber) 18%, var(--panel)); }
#hivemind button:active { transform:translateY(1px); }
#hivemind button.primary { border-color:var(--amber); color:var(--amber); }
#hivemind input { font:inherit; font-size:1.15em; letter-spacing:.3em; text-transform:uppercase; width:7.5em; color:var(--bone);
  background:transparent; border:none; border-bottom:1px solid color-mix(in srgb, var(--bone) 40%, transparent); padding:6px 2px; outline:none; }
#hivemind input:focus { border-color:var(--amber); }
#hivemind input.name { letter-spacing:.06em; text-transform:none; width:10em; font-size:1em; }
#hivemind .hm-code { font-family:var(--display); font-size:2.6em; letter-spacing:.22em; color:var(--amber); line-height:1; margin-top:8px; }
#hivemind ul { list-style:none; margin:10px 0 0; padding:0; }
#hivemind li { display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-top:1px solid color-mix(in srgb, var(--bone) 10%, transparent); }
#hivemind li small { opacity:.55; letter-spacing:.12em; text-transform:uppercase; font-size:.68em; margin-left:6px; }
#hivemind .side { font-size:.68em; letter-spacing:.22em; text-transform:uppercase; padding:2px 8px; border-radius:999px; border:1px solid currentColor; }
#hivemind .side.s0 { color:var(--bone); }
#hivemind .side.s1 { color:var(--danger); }
#hivemind .hm-err { color:var(--danger); }
#hivemind a { color:var(--amber); }
#hivemind .hm-status { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--acid); margin-right:6px; vertical-align:middle; opacity:.85; }
`;

const NAME_KEY = 'biophage.callsign';

export function savedName(): string {
  try { const n = localStorage.getItem(NAME_KEY); if (n) return n; } catch { /* storage blocked */ }
  const n = `Host-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  try { localStorage.setItem(NAME_KEY, n); } catch { /* storage blocked */ }
  return n;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class HiveMindPanel {
  readonly root = document.createElement('div');
  private shownKey = '';
  private expanded = false;

  constructor(private s: NetSession, private opts: { blockedReason: string | null; onlineHome: string; say(text: string): void }) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'hivemind';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.click(e));
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a code must not trigger the Hive's keyboard shortcuts
      if (e.key === 'Enter') (e.target as HTMLElement).closest('.hm-row')?.querySelector<HTMLButtonElement>('button')?.click();
    });
    this.render();
  }

  set visible(v: boolean) { this.root.classList.toggle('hidden', !v); }

  /** Re-renders when anything shown changed (cheap to call every frame). */
  update(): void {
    const s = this.s;
    const key = JSON.stringify([s.state, s.code, s.message, s.members, s.leader, this.expanded]);
    if (key !== this.shownKey) this.render();
  }

  private render(): void {
    const s = this.s;
    this.shownKey = JSON.stringify([s.state, s.code, s.message, s.members, s.leader, this.expanded]);
    // Folded into a small pill until the player opens it or a session is running.
    const open = this.expanded || s.state !== 'off';
    this.root.classList.toggle('collapsed', !open);
    const head = `<div class="hm-head" data-act="fold"><h3>Hive-Mind</h3><span class="${open ? 'hm-sub' : 'hm-toggle'}">${open ? 'online squads' : 'play online'}</span></div>`;
    if (!open) { this.root.innerHTML = `<div class="hm-card">${head}</div>`; return; }
    let body = '';
    if (this.opts.blockedReason && s.state === 'off') {
      body = `<p>${esc(this.opts.blockedReason)}</p><div class="hm-row"><a href="${esc(this.opts.onlineHome)}" target="_blank" rel="noopener">Open the online build ↗</a></div>`;
    } else if (s.state === 'off') {
      body = `<p>Raid with friends over the internet. One of you opens a squad and shares the code.</p>
        <div class="hm-row"><span>Name</span><input class="name" data-name maxlength="18" value="${esc(s.me.name)}"></div>
        <div class="hm-row"><button class="primary" data-act="host">Open a squad</button></div>
        <div class="hm-row"><input data-code placeholder="CODE" maxlength="80" autocomplete="off" spellcheck="false"><button data-act="join">Join</button></div>`;
    } else if (s.state === 'opening') {
      body = `<p>${esc(s.message)}</p><div class="hm-row"><button data-act="leave">Cancel</button></div>`;
    } else if (s.state === 'error') {
      body = `<p class="hm-err">${esc(s.message)}</p><div class="hm-row"><button data-act="back">Back</button></div>`;
    } else {
      const me = s.me;
      const list = s.members.map((m) => {
        const cls = (CLASSES[m.cls as ClassId]?.label ?? m.cls).replace(/^The /, '');
        const lead = m.id === s.leaderId ? '<small>leader</small>' : '';
        return `<li><span>${m.id === me.id ? '<span class="hm-status"></span>' : ''}${esc(m.name)}${lead}<small>${esc(cls)}</small></span><span class="side s${m.squad}">${m.squad === me.squad ? 'squad' : 'rival'}</span></li>`;
      }).join('');
      const wait = s.state === 'lobby'
        ? (s.leader ? 'Press Deploy when everyone is in. The whole squad drops together.' : 'Waiting for the leader to deploy. Pick your host and loadout meanwhile.')
        : (s.message || 'In the raid.');
      body = `<div class="hm-code" title="Squad code">${esc(s.code ?? '')}</div>
        <div class="hm-row"><button data-act="copy">Copy invite link</button><button data-act="side">${me.squad === 0 ? 'Go rival' : 'Join squad'}</button></div>
        <ul>${list}</ul><p>${esc(wait)}</p>
        <div class="hm-row"><button data-act="leave">Leave</button></div>`;
    }
    this.root.innerHTML = `<div class="hm-card">${head}${body}</div>`;
  }

  private click(e: Event): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    const s = this.s;
    const name = this.root.querySelector<HTMLInputElement>('[data-name]')?.value.trim();
    if (name) { try { localStorage.setItem(NAME_KEY, name.slice(0, 18)); } catch { /* storage blocked */ } s.setName(name); }
    switch (act) {
      case 'fold': if (s.state === 'off') this.expanded = !this.expanded; break;
      case 'host': s.host(); break;
      case 'join': {
        const raw = this.root.querySelector<HTMLInputElement>('[data-code]')?.value ?? '';
        const code = parseCode(raw);
        if (!code) { this.opts.say('That is not a squad code: five letters and numbers, or the whole invite link.'); return; }
        s.join(code);
        break;
      }
      case 'copy': {
        const link = inviteLink(location.href, s.code ?? '');
        void navigator.clipboard?.writeText(link).then(() => this.opts.say('Invite link copied. Send it to your squad.'), () => this.opts.say(`Invite link: ${link}`));
        break;
      }
      case 'side': s.setSquad(s.me.squad === 0 ? 1 : 0); break;
      case 'leave': s.leave(); break;
      case 'back': s.leave(); break;
    }
    this.render();
  }
}
