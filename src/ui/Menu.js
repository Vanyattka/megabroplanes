import {
  PLANE_TYPES,
  DEFAULT_PLANE_TYPE,
  BODY_COLORS,
  DEFAULT_BODY_COLOR,
} from '../config.js';

const STORAGE_KEY = 'mbp:loadout';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!PLANE_TYPES[j.type]) return null;
    return { type: j.type, color: j.color };
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

    const saved = loadSaved();
    this.selectedType = saved?.type || DEFAULT_PLANE_TYPE;
    this.selectedColor = saved?.color ?? DEFAULT_BODY_COLOR;

    this._renderPlaneCards();
    this._renderColors();
    this._wireButtons();
    this.onStart = null;
    this.onChange = null;

    document.body.classList.add('menu-open');
  }

  getSelection() {
    return { type: this.selectedType, color: this.selectedColor };
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
  }

  _showMain() {
    this.main.classList.remove('hidden');
    this.chooser.classList.add('hidden');
  }
  _showChooser() {
    this.main.classList.add('hidden');
    this.chooser.classList.remove('hidden');
  }

  _renderPlaneCards() {
    this.planeList.innerHTML = '';
    for (const key of Object.keys(PLANE_TYPES)) {
      const t = PLANE_TYPES[key];
      const card = document.createElement('div');
      card.className = 'plane-card' + (key === this.selectedType ? ' selected' : '');
      card.dataset.type = key;
      card.innerHTML = `
        <div class="pc-name">${t.name.toUpperCase()}</div>
        <div class="pc-desc">${t.description}</div>
      `;
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

  _emitChange() {
    save({ type: this.selectedType, color: this.selectedColor });
    if (this.onChange) this.onChange(this.getSelection());
  }

  _wireButtons() {
    document.getElementById('btn-start').addEventListener('click', () => {
      save({ type: this.selectedType, color: this.selectedColor });
      this.hide();
      if (this.onStart) this.onStart(this.getSelection());
    });
    document.getElementById('btn-choose').addEventListener('click', () => this._showChooser());
    document.getElementById('btn-back').addEventListener('click', () => this._showMain());
  }
}
