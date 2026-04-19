import {
  PLANE_TYPES,
  DEFAULT_PLANE_TYPE,
  BODY_COLORS,
  DEFAULT_BODY_COLOR,
  TIME_PRESETS,
  DEFAULT_TIME_PRESET,
} from '../config.js';
import { PlanePreview } from './PlanePreview.js';

const STORAGE_KEY = 'mbp:loadout';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!PLANE_TYPES[j.type]) return null;
    const timePreset = TIME_PRESETS[j.timePreset] ? j.timePreset : DEFAULT_TIME_PRESET;
    return { type: j.type, color: j.color, timePreset };
  } catch {
    return null;
  }
}
function save(loadout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout)); } catch {}
}

export class Menu {
  constructor() {
    this.root = document.getElementById('menu');
    this.main = document.getElementById('menu-main');
    this.chooser = document.getElementById('menu-chooser');
    this.planeList = document.getElementById('plane-list');
    this.colorList = document.getElementById('color-list');
    this.timeList = document.getElementById('time-list');

    const saved = loadSaved();
    this.selectedType = saved?.type || DEFAULT_PLANE_TYPE;
    this.selectedColor = saved?.color ?? DEFAULT_BODY_COLOR;
    this.selectedTimePreset = saved?.timePreset || DEFAULT_TIME_PRESET;

    this.previews = [];           // [{ type, preview }]
    this._previewsInitialized = false;
    this._rafId = null;
    this._lastRaf = 0;

    this._renderPlaneCards();
    this._renderColors();
    this._renderTimePresets();
    this._wireButtons();
    this.onStart = null;
    this.onChange = null;
    this.onTimeChange = null;

    document.body.classList.add('menu-open');
  }

  getSelection() {
    return {
      type: this.selectedType,
      color: this.selectedColor,
      timePreset: this.selectedTimePreset,
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

  _showMain() {
    this.main.classList.remove('hidden');
    this.chooser.classList.add('hidden');
    this._stopRaf();
  }
  _showChooser() {
    this.main.classList.add('hidden');
    this.chooser.classList.remove('hidden');
    this._ensurePreviews();
    this._startRaf();
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
      if (!this.isOpen() || this.chooser.classList.contains('hidden')) {
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

  _emitChange() {
    save({
      type: this.selectedType,
      color: this.selectedColor,
      timePreset: this.selectedTimePreset,
    });
    for (const { preview } of this.previews) preview.setColor(this.selectedColor);
    if (this.onChange) this.onChange(this.getSelection());
  }

  _wireButtons() {
    document.getElementById('btn-start').addEventListener('click', () => {
      save({
        type: this.selectedType,
        color: this.selectedColor,
        timePreset: this.selectedTimePreset,
      });
      this.hide();
      if (this.onStart) this.onStart(this.getSelection());
    });
    document.getElementById('btn-choose').addEventListener('click', () => this._showChooser());
    document.getElementById('btn-back').addEventListener('click', () => this._showMain());
  }
}
