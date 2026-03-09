/**
 * FreelancerHub — Theme Customizer
 * Persists to localStorage, applies instantly across all pages.
 */
(function () {
    'use strict';

    /* ── 1. Defaults ───────────────────────────────────────────────── */
    const DEFAULTS = {
        theme: 'default',
        fontSize: 100,
        radius: 'normal',
        animations: true,
        compact: false,
    };

    /* ── 2. Load saved settings (apply BEFORE render to prevent flash) */
    let settings = { ...DEFAULTS };
    try {
        const saved = JSON.parse(localStorage.getItem('fh_theme') || '{}');
        settings = { ...DEFAULTS, ...saved };
    } catch (_) { }

    function applySettings(s) {
        const root = document.documentElement;
        // Theme
        if (s.theme === 'default') root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', s.theme);
        // Font size
        root.style.fontSize = s.fontSize + '%';
        // Border radius
        if (s.radius === 'normal') root.removeAttribute('data-radius');
        else root.setAttribute('data-radius', s.radius);
        // Animations
        if (s.animations) root.removeAttribute('data-no-anim');
        else root.setAttribute('data-no-anim', 'true');
        // Compact
        if (s.compact) root.setAttribute('data-compact', 'true');
        else root.removeAttribute('data-compact');
    }

    // Apply immediately (before DOM ready) to prevent flash of default styles
    applySettings(settings);

    /* ── 3. Build the panel HTML ───────────────────────────────────── */
    const PRESETS = [
        { id: 'default', name: 'Cyber Purple', swatch: 'purple' },
        { id: 'ocean', name: 'Ocean Blue', swatch: 'ocean' },
        { id: 'neon', name: 'Neon Green', swatch: 'neon' },
        { id: 'sunset', name: 'Sunset Red', swatch: 'sunset' },
        { id: 'rose', name: 'Rose Gold', swatch: 'rose' },
        { id: 'light', name: 'Light Mode', swatch: 'light' },
    ];

    function buildPanel() {
        // Preset buttons
        const presetBtns = PRESETS.map(p => `
            <button class="theme-preset-btn${settings.theme === p.id ? ' active' : ''}"
                    data-preset="${p.id}" title="${p.name}" aria-label="Apply ${p.name} theme">
                <div class="theme-preset-swatch swatch-${p.swatch}"></div>
                <span class="theme-preset-name">${p.name}</span>
                <div class="theme-preset-check">✓</div>
            </button>`).join('');

        const radii = [
            { id: 'sharp', label: 'Sharp' },
            { id: 'normal', label: 'Default' },
            { id: 'round', label: 'Round' },
            { id: 'pill', label: 'Pill' },
        ];
        const radiusBtns = radii.map(r => `
            <button class="radius-btn${settings.radius === r.id ? ' active' : ''}"
                    data-radius="${r.id}" aria-label="${r.label} corners">
                <div class="radius-preview ${r.id}"></div>
                <span>${r.label}</span>
            </button>`).join('');

        return `
        <button class="theme-toggle-btn${isCustomized() ? ' theme-customized' : ''}"
                id="themeToggleBtn"
                title="Customize Theme"
                aria-label="Open theme customizer"
                aria-expanded="false">
            🎨
            <div class="theme-active-dot"></div>
        </button>

        <aside class="theme-panel" id="themePanel" role="dialog" aria-label="Theme Customizer">
            <div class="theme-panel-header">
                <div class="theme-panel-title">
                    <span>🎨</span> Theme Customizer
                </div>
                <button class="theme-panel-close" id="themePanelClose" aria-label="Close theme panel">✕</button>
            </div>
            <div class="theme-panel-body">

                <!-- Presets -->
                <div>
                    <div class="theme-section-label">Color Theme</div>
                    <div class="theme-presets">
                        ${presetBtns}
                    </div>
                </div>

                <div class="theme-divider"></div>

                <!-- Font Size -->
                <div class="font-size-control">
                    <div class="theme-section-label">Font Size</div>
                    <div class="font-slider-row">
                        <span class="font-size-label" style="font-size:0.7rem">A</span>
                        <input type="range" class="theme-slider" id="fontSizeSlider"
                               min="80" max="120" step="5" value="${settings.fontSize}"
                               aria-label="Font size">
                        <span class="font-size-label" style="font-size:1rem">A</span>
                        <div class="font-size-badge" id="fontSizeBadge">${settings.fontSize}%</div>
                    </div>
                </div>

                <div class="theme-divider"></div>

                <!-- Border Radius -->
                <div>
                    <div class="theme-section-label">Corner Style</div>
                    <div class="radius-options">
                        ${radiusBtns}
                    </div>
                </div>

                <div class="theme-divider"></div>

                <!-- Toggles -->
                <div style="display:flex;flex-direction:column;gap:14px;">
                    <div class="toggle-row">
                        <div class="toggle-info">
                            <span class="toggle-label">Animations</span>
                            <span class="toggle-desc">Smooth transitions & effects</span>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="animToggle" ${settings.animations ? 'checked' : ''}
                                   aria-label="Toggle animations">
                            <span class="toggle-track"></span>
                        </label>
                    </div>
                    <div class="toggle-row">
                        <div class="toggle-info">
                            <span class="toggle-label">Compact UI</span>
                            <span class="toggle-desc">Tighter spacing & padding</span>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="compactToggle" ${settings.compact ? 'checked' : ''}
                                   aria-label="Toggle compact mode">
                            <span class="toggle-track"></span>
                        </label>
                    </div>
                </div>

                <div class="theme-divider"></div>

                <!-- Reset -->
                <button class="theme-reset-btn" id="themeResetBtn" aria-label="Reset all theme settings">
                    ↺ Reset to Default
                </button>

            </div>
        </aside>`;
    }

    function isCustomized() {
        return (
            settings.theme !== DEFAULTS.theme ||
            settings.fontSize !== DEFAULTS.fontSize ||
            settings.radius !== DEFAULTS.radius ||
            settings.animations !== DEFAULTS.animations ||
            settings.compact !== DEFAULTS.compact
        );
    }

    /* ── 4. Inject UI into navbar ──────────────────────────────────── */
    function inject() {
        const navbarRight = document.querySelector('.navbar-right');
        if (!navbarRight) return;

        // Container
        const wrap = document.createElement('div');
        wrap.style.position = 'relative';
        wrap.innerHTML = buildPanel();

        // Insert before the first child of navbar-right
        const navToggle = navbarRight.querySelector('.nav-toggle');
        if (navToggle) {
            navbarRight.insertBefore(wrap, navToggle);
        } else {
            navbarRight.appendChild(wrap);
        }

        bindEvents();
    }

    /* ── 5. Save & apply ───────────────────────────────────────────── */
    function save() {
        localStorage.setItem('fh_theme', JSON.stringify(settings));
        applySettings(settings);

        // Update dot indicator
        const btn = document.getElementById('themeToggleBtn');
        if (btn) {
            btn.classList.toggle('theme-customized', isCustomized());
        }
    }

    /* ── 6. Event bindings ─────────────────────────────────────────── */
    function bindEvents() {
        const toggleBtn = document.getElementById('themeToggleBtn');
        const panel = document.getElementById('themePanel');
        const closeBtn = document.getElementById('themePanelClose');
        const fontSlider = document.getElementById('fontSizeSlider');
        const fontBadge = document.getElementById('fontSizeBadge');
        const animToggle = document.getElementById('animToggle');
        const compToggle = document.getElementById('compactToggle');
        const resetBtn = document.getElementById('themeResetBtn');

        // Open / close panel
        function openPanel() {
            panel.classList.add('open');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
        function closePanel() {
            panel.classList.remove('open');
            toggleBtn.setAttribute('aria-expanded', 'false');
        }

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.contains('open') ? closePanel() : openPanel();
        });

        closeBtn.addEventListener('click', closePanel);

        // Click outside closes panel
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && e.target !== toggleBtn) {
                closePanel();
            }
        });

        // Escape key closes panel
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePanel();
        });

        // Preset buttons
        panel.querySelectorAll('.theme-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.theme-preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                settings.theme = btn.dataset.preset;
                save();
                showToastIfAvailable(`Theme applied: ${btn.querySelector('.theme-preset-name').textContent}`);
            });
        });

        // Font size slider
        fontSlider.addEventListener('input', () => {
            settings.fontSize = parseInt(fontSlider.value, 10);
            fontBadge.textContent = settings.fontSize + '%';
            save();
        });

        // Border radius buttons
        panel.querySelectorAll('.radius-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.radius-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                settings.radius = btn.dataset.radius;
                save();
            });
        });

        // Animations toggle
        animToggle.addEventListener('change', () => {
            settings.animations = animToggle.checked;
            save();
        });

        // Compact toggle
        compToggle.addEventListener('change', () => {
            settings.compact = compToggle.checked;
            save();
        });

        // Reset
        resetBtn.addEventListener('click', () => {
            settings = { ...DEFAULTS };
            save();
            // Rebuild panel UI in place
            const wrap = toggleBtn.closest('div[style]') || toggleBtn.parentElement;
            wrap.innerHTML = buildPanel();
            bindEvents();
            // Re-sync slider
            const sl = document.getElementById('fontSizeSlider');
            if (sl) sl.value = DEFAULTS.fontSize;
            showToastIfAvailable('Theme reset to default');
        });
    }

    /* ── 7. Toast helper ───────────────────────────────────────────── */
    function showToastIfAvailable(msg) {
        if (typeof showToast === 'function') {
            showToast(msg, 'success');
        }
    }

    /* ── 8. Init ───────────────────────────────────────────────────── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }

})();
