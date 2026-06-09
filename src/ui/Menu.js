import {
  PLANE_TYPES,
  DEFAULT_PLANE_TYPE,
  BODY_COLORS,
  DEFAULT_BODY_COLOR,
  TIME_PRESETS,
  DEFAULT_TIME_PRESET,
  GRAPHICS_PRESETS,
  VIEW_DISTANCE_PRESETS,
  CHANGELOG,
  GAME_VERSION,
  GAME_CODENAME,
  GAME_CHANNEL,
} from '../config.js';
import { PlanePreview } from './PlanePreview.js';
import { gfx, view } from './GraphicsSettings.js';
import { getWorldSeed, DEFAULT_WORLD_SEED } from '../world/WorldSeed.js';

const STORAGE_KEY = 'mbp:loadout';
const MODES = ['singleplayer', 'multiplayer'];
const DEFAULT_MODE = 'singleplayer';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!PLANE_TYPES[j.type]) return null;
    const timePreset = TIME_PRESETS[j.timePreset] ? j.timePreset : DEFAULT_TIME_PRESET;
    const mode = MODES.includes(j.mode) ? j.mode : DEFAULT_MODE;
    return { type: j.type, color: j.color, timePreset, mode };
  } catch {
    return null;
  }
}
function save(loadout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout)); } catch {}
}

// Main menu now has three screens:
//   - main (START / CONTINUE / PLANES / SETTINGS buttons)
//   - planes (aircraft picker + body color — no time/graphics clutter)
//   - settings (time of day + graphics quality)
// The planes and settings pages are exposed on their own so players can
// fiddle with either without resetting their flight.
export class Menu {
  constructor() {
    this.root = document.getElementById('menu');
    this.main = document.getElementById('menu-main');
    this.planesScreen = document.getElementById('menu-planes');
    this.settingsScreen = document.getElementById('menu-settings');
    this.notesScreen = document.getElementById('menu-notes');
    this.planeList = document.getElementById('plane-list');
    this.colorList = document.getElementById('color-list');
    this.timeList = document.getElementById('time-list');
    this.gfxList = document.getElementById('gfx-list');
    this.viewList = document.getElementById('view-list');

    const saved = loadSaved();
    this.selectedType = saved?.type || DEFAULT_PLANE_TYPE;
    this.selectedColor = saved?.color ?? DEFAULT_BODY_COLOR;
    this.selectedTimePreset = saved?.timePreset || DEFAULT_TIME_PRESET;
    this.selectedMode = saved?.mode || DEFAULT_MODE;
    this.modeToggle = document.getElementById('mode-toggle');
    this.timeMpNote = document.getElementById('time-mp-note');
    this.seedRow = document.getElementById('seed-row');
    this.seedCurrentEl = document.getElementById('seed-current');
    this.btnRegen = document.getElementById('btn-regen-seed');
    this.seedMpNote = document.getElementById('seed-mp-note');

    this.previews = [];
    this._previewsInitialized = false;
    this._rafId = null;
    this._lastRaf = 0;
    this._continueAvailable = false;

    this._renderPlaneCards();
    this._renderColors();
    this._renderTimePresets();
    this._renderGfxPresets();
    this._renderViewPresets();
    this._renderVersion();
    this._renderNotes();
    this._renderSeed();
    this._wireButtons();
    this._wireModeToggle();
    this._refreshModeUI();
    this.onStart = null;
    this.onContinue = null;
    this.onChange = null;
    this.onTimeChange = null;
    this.onModeChange = null;
    this.onRegenerate = null;

    document.body.classList.add('menu-open');
    this._refreshMainButtons();
  }

  getSelection() {
    return {
      type: this.selectedType,
      color: this.selectedColor,
      timePreset: this.selectedTimePreset,
      mode: this.selectedMode,
    };
  }

  isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open() {
    this.root.classList.remove('hidden');
    document.body.classList.add('menu-open');
    this._showMain();
  }

  hide() {
    this.root.classList.add('hidden');
    document.body.classList.remove('menu-open');
    this._stopRaf();
  }

  setContinueAvailable(on) {
    this._continueAvailable = !!on;
    this._refreshMainButtons();
  }

  _refreshMainButtons() {
    const cont = document.getElementById('btn-continue');
    if (cont) cont.hidden = !this._continueAvailable;
  }

  _showMain() {
    this.main.classList.remove('hidden');
    this.planesScreen.classList.add('hidden');
    this.settingsScreen.classList.add('hidden');
    if (this.notesScreen) this.notesScreen.classList.add('hidden');
    this._stopRaf();
  }
  _showPlanes() {
    this.main.classList.add('hidden');
    this.planesScreen.classList.remove('hidden');
    this.settingsScreen.classList.add('hidden');
    if (this.notesScreen) this.notesScreen.classList.add('hidden');
    this._ensurePreviews();
    this._startRaf();
  }
  _showSettings() {
    this.main.classList.add('hidden');
    this.planesScreen.classList.add('hidden');
    this.settingsScreen.classList.remove('hidden');
    if (this.notesScreen) this.notesScreen.classList.add('hidden');
    this._stopRaf();
  }
  _showNotes() {
    this.main.classList.add('hidden');
    this.planesScreen.classList.add('hidden');
    this.settingsScreen.classList.add('hidden');
    if (this.notesScreen) this.notesScreen.classList.remove('hidden');
    this._stopRaf();
  }

  _renderVersion() {
    const el = document.getElementById('menu-version');
    if (el) el.textContent = `v${GAME_VERSION} “${GAME_CODENAME}” · ${GAME_CHANNEL}`;
  }

  _renderSeed() {
    if (!this.seedCurrentEl) return;
    const s = getWorldSeed();
    this.seedCurrentEl.textContent = s === DEFAULT_WORLD_SEED ? 'default' : s;
  }

  _renderNotes() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    list.innerHTML = (CHANGELOG || []).map((r) => {
      const items = (r.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
      return `<div class="note-release">
        <div class="note-head">
          <span class="note-ver">v${esc(r.version)} <span class="nv-code">“${esc(r.codename)}”</span></span>
          ${r.channel ? `<span class="note-badge">${esc(r.channel)}</span>` : ''}
          ${r.date ? `<span class="note-date">${esc(r.date)}</span>` : ''}
        </div>
        <ul class="note-list">${items}</ul>
      </div>`;
    }).join('');
  }

  _renderPlaneCards() {
    this.planeList.innerHTML = '';
    for (const key of Object.keys(PLANE_TYPES)) {
      const t = PLANE_TYPES[key];
      const card = document.createElement('div');
      card.className = 'plane-card' + (key === this.selectedType ? ' selected' : '');
      card.dataset.type = key;

      const canvas = document.createElement('canvas');
      canvas.className = 'pc-canvas';
      canvas.width = 220;
      canvas.height = 130;
      card.appendChild(canvas);

      const name = document.createElement('div');
      name.className = 'pc-name';
      name.textContent = t.name.toUpperCase();
      card.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'pc-desc';
      desc.textContent = t.description;
      card.appendChild(desc);

      if (t.tagline) {
        const tag = document.createElement('div');
        tag.className = 'pc-tagline';
        tag.textContent = `"${t.tagline}"`;
        card.appendChild(tag);
      }

      card.addEventListener('click', () => {
        this.selectedType = key;
        this._updatePlaneCards();
        this._emitChange();
      });
      this.planeList.appendChild(card);
    }
  }

  _updatePlaneCards() {
    for (const card of this.planeList.querySelectorAll('.plane-card')) {
      card.classList.toggle('selected', card.dataset.type === this.selectedType);
    }
  }

  _ensurePreviews() {
    if (this._previewsInitialized) return;
    const cards = this.planeList.querySelectorAll('.plane-card');
    cards.forEach((card) => {
      const canvas = card.querySelector('.pc-canvas');
      const type = card.dataset.type;
      const preview = new PlanePreview(canvas, type, this.selectedColor);
      this.previews.push({ type, preview });
    });
    this._previewsInitialized = true;
  }

  _startRaf() {
    if (this._rafId != null) return;
    this._lastRaf = performance.now();
    const loop = () => {
      if (!this.isOpen() || this.planesScreen.classList.contains('hidden')) {
        this._rafId = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.1, (now - this._lastRaf) / 1000);
      this._lastRaf = now;
      for (const { preview } of this.previews) preview.animate(dt);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopRaf() {
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _renderColors() {
    this.colorList.innerHTML = '';
    for (const c of BODY_COLORS) {
      const s = document.createElement('div');
      s.className = 'color-swatch' + (c.hex === this.selectedColor ? ' selected' : '');
      s.dataset.hex = String(c.hex);
      s.style.background = `#${c.hex.toString(16).padStart(6, '0')}`;
      s.title = c.name;
      s.addEventListener('click', () => {
        this.selectedColor = c.hex;
        this._updateColors();
        this._emitChange();
      });
      this.colorList.appendChild(s);
    }
  }
  _updateColors() {
    for (const s of this.colorList.querySelectorAll('.color-swatch')) {
      s.classList.toggle('selected', Number(s.dataset.hex) === this.selectedColor);
    }
  }

  _renderTimePresets() {
    if (!this.timeList) return;
    this.timeList.innerHTML = '';
    for (const key of Object.keys(TIME_PRESETS)) {
      const p = TIME_PRESETS[key];
      const btn = document.createElement('button');
      btn.className = 'time-btn' + (key === this.selectedTimePreset ? ' selected' : '');
      btn.dataset.preset = key;
      btn.textContent = p.label.toUpperCase();
      btn.addEventListener('click', () => {
        this.selectedTimePreset = key;
        this._updateTimePresets();
        save({
          type: this.selectedType,
          color: this.selectedColor,
          timePreset: this.selectedTimePreset,
          mode: this.selectedMode,
        });
        if (this.onTimeChange) this.onTimeChange(key);
      });
      this.timeList.appendChild(btn);
    }
  }
  _updateTimePresets() {
    if (!this.timeList) return;
    for (const b of this.timeList.querySelectorAll('.time-btn')) {
      b.classList.toggle('selected', b.dataset.preset === this.selectedTimePreset);
    }
  }

  _renderGfxPresets() {
    if (!this.gfxList) return;
    this.gfxList.innerHTML = '';
    const current = gfx.preset;
    for (const key of Object.keys(GRAPHICS_PRESETS)) {
      const p = GRAPHICS_PRESETS[key];
      const btn = document.createElement('button');
      btn.className = 'time-btn' + (key === current ? ' selected' : '');
      btn.dataset.gfx = key;
      btn.textContent = p.label.toUpperCase();
      btn.addEventListener('click', () => {
        gfx.set(key);
        this._updateGfxPresets();
      });
      this.gfxList.appendChild(btn);
    }
  }
  _updateGfxPresets() {
    if (!this.gfxList) return;
    for (const b of this.gfxList.querySelectorAll('.time-btn')) {
      b.classList.toggle('selected', b.dataset.gfx === gfx.preset);
    }
  }

  _renderViewPresets() {
    if (!this.viewList) return;
    this.viewList.innerHTML = '';
    const current = view.preset;
    for (const key of Object.keys(VIEW_DISTANCE_PRESETS)) {
      const p = VIEW_DISTANCE_PRESETS[key];
      const btn = document.createElement('button');
      btn.className = 'time-btn' + (key === current ? ' selected' : '');
      btn.dataset.view = key;
      btn.textContent = p.label.toUpperCase();
      btn.addEventListener('click', () => {
        view.set(key);
        this._updateViewPresets();
      });
      this.viewList.appendChild(btn);
    }
  }
  _updateViewPresets() {
    if (!this.viewList) return;
    for (const b of this.viewList.querySelectorAll('.time-btn')) {
      b.classList.toggle('selected', b.dataset.view === view.preset);
    }
  }

  _emitChange() {
    save({
      type: this.selectedType,
      color: this.selectedColor,
      timePreset: this.selectedTimePreset,
      mode: this.selectedMode,
    });
    for (const { preview } of this.previews) preview.setColor(this.selectedColor);
    if (this.onChange) this.onChange(this.getSelection());
  }

  // Mode toggle: SINGLEPLAYER vs MULTIPLAYER. In MP the time-of-day picker
  // is disabled (time syncs across all clients off the wall clock) and a
  // note appears in the settings screen.
  _wireModeToggle() {
    if (!this.modeToggle) return;
    for (const btn of this.modeToggle.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        const m = btn.dataset.mode;
        if (!MODES.includes(m) || m === this.selectedMode) return;
        this.selectedMode = m;
        this._refreshModeUI();
        save({
          type: this.selectedType,
          color: this.selectedColor,
          timePreset: this.selectedTimePreset,
          mode: this.selectedMode,
        });
        if (this.onModeChange) this.onModeChange(m);
      });
    }
  }

  _refreshModeUI() {
    if (this.modeToggle) {
      for (const b of this.modeToggle.querySelectorAll('.mode-btn')) {
        b.classList.toggle('selected', b.dataset.mode === this.selectedMode);
      }
    }
    // When MP, disable the time picker (visually grey and ignore clicks)
    // and reveal the explanatory note. Time picker stays in the DOM so the
    // settings layout doesn't reflow when switching modes.
    const mp = this.selectedMode === 'multiplayer';
    if (this.timeList) {
      this.timeList.style.opacity = mp ? '0.4' : '1';
      this.timeList.style.pointerEvents = mp ? 'none' : 'auto';
    }
    if (this.timeMpNote) {
      this.timeMpNote.style.display = mp ? 'block' : 'none';
    }
    // World-seed regeneration is singleplayer-only — MP shares one world.
    if (this.seedRow) this.seedRow.style.display = mp ? 'none' : 'flex';
    if (this.seedMpNote) this.seedMpNote.style.display = mp ? 'block' : 'none';
  }

  _wireButtons() {
    const persist = () => save({
      type: this.selectedType,
      color: this.selectedColor,
      timePreset: this.selectedTimePreset,
      mode: this.selectedMode,
    });
    document.getElementById('btn-start').addEventListener('click', () => {
      persist();
      this.hide();
      if (this.onStart) this.onStart(this.getSelection());
    });
    const cont = document.getElementById('btn-continue');
    if (cont) {
      cont.addEventListener('click', () => {
        if (!this._continueAvailable) return;
        this.hide();
        if (this.onContinue) this.onContinue();
      });
    }
    document.getElementById('btn-planes').addEventListener('click', () => this._showPlanes());
    document.getElementById('btn-settings').addEventListener('click', () => this._showSettings());
    const notesBtn = document.getElementById('btn-notes');
    if (notesBtn) notesBtn.addEventListener('click', () => this._showNotes());
    document.getElementById('btn-back-planes').addEventListener('click', () => this._showMain());
    document.getElementById('btn-back-settings').addEventListener('click', () => this._showMain());
    const backNotes = document.getElementById('btn-back-notes');
    if (backNotes) backNotes.addEventListener('click', () => this._showMain());
    if (this.btnRegen) {
      this.btnRegen.addEventListener('click', () => { if (this.onRegenerate) this.onRegenerate(); });
    }
  }
}
