// Flight onboarding guide: a small stack of cards that explain takeoff,
// steering, gear, landing, extras and racing. Shown automatically the first time
// someone opens the game, and replayable any time from Settings.
//
// It lives over the MENU (never during flight), so it can own the keyboard while
// open without fighting the flight controls.

import { t, onLangChange } from './I18n.js';
import { GUIDE_STEPS } from './strings.js';

const SEEN_KEY = 'mbp:guideSeen';

function seen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
}

export class Guide {
  constructor() {
    this.root = document.getElementById('guide');
    this.titleEl = document.getElementById('guide-title');
    this.stepEl = document.getElementById('guide-step');
    this.bodyEl = document.getElementById('guide-body');
    this.keysEl = document.getElementById('guide-keys');
    this.dotsEl = document.getElementById('guide-dots');
    this.prevBtn = document.getElementById('guide-prev');
    this.nextBtn = document.getElementById('guide-next');
    this.skipBtn = document.getElementById('guide-skip');

    this.i = 0;
    this.open = false;

    if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.go(-1));
    if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.go(1));
    if (this.skipBtn) this.skipBtn.addEventListener('click', () => this.close());
    // Click the backdrop (but not the card) to dismiss.
    if (this.root) {
      this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
    }
    // Own the keyboard while open: Esc closes, arrows page through. Stop
    // propagation so these keys never reach the flight Input listener.
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.stopPropagation(); this.go(1); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); this.go(-1); }
    }, true);

    // Re-render in place when the language changes mid-guide.
    onLangChange(() => { if (this.open) this._render(); });
  }

  // Show the guide on a first-ever visit. Returns true if it opened.
  maybeShowFirstRun() {
    if (seen()) return false;
    this.show();
    return true;
  }

  show(step = 0) {
    if (!this.root) return;
    this.i = Math.max(0, Math.min(GUIDE_STEPS - 1, step));
    this.open = true;
    this.root.classList.remove('hidden');
    document.body.classList.add('guide-open');
    this._render();
  }

  close() {
    if (!this.root) return;
    this.open = false;
    this.root.classList.add('hidden');
    document.body.classList.remove('guide-open');
    markSeen(); // seeing it once (even partly) is enough — it's replayable
  }

  go(delta) {
    const next = this.i + delta;
    if (next < 0) return;
    if (next >= GUIDE_STEPS) { this.close(); return; }
    this.i = next;
    this._render();
  }

  _render() {
    const n = this.i + 1;
    const key = `guide.s${n}`;
    if (this.titleEl) this.titleEl.textContent = t(`${key}.title`);
    if (this.stepEl) this.stepEl.textContent = t('guide.step', { n, total: GUIDE_STEPS });
    if (this.bodyEl) this.bodyEl.textContent = t(`${key}.body`);

    // Not every step has a key list (e.g. the intro) — hide the chip when absent.
    if (this.keysEl) {
      const keysKey = `${key}.keys`;
      const keys = t(keysKey);
      const hasKeys = keys !== keysKey;
      this.keysEl.textContent = hasKeys ? keys : '';
      this.keysEl.style.display = hasKeys ? 'block' : 'none';
    }

    if (this.dotsEl) {
      this.dotsEl.innerHTML = '';
      for (let s = 0; s < GUIDE_STEPS; s++) {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'guide-dot' + (s === this.i ? ' on' : '');
        d.addEventListener('click', () => { this.i = s; this._render(); });
        this.dotsEl.appendChild(d);
      }
    }

    const last = this.i === GUIDE_STEPS - 1;
    if (this.prevBtn) {
      this.prevBtn.textContent = t('guide.prev');
      this.prevBtn.style.visibility = this.i === 0 ? 'hidden' : 'visible';
    }
    if (this.nextBtn) this.nextBtn.textContent = last ? t('guide.done') : t('guide.next');
    if (this.skipBtn) {
      this.skipBtn.textContent = t('guide.skip');
      this.skipBtn.style.visibility = last ? 'hidden' : 'visible';
    }
  }
}
