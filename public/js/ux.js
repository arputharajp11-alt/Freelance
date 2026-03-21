/**
 * FreelancerHub — Global UX Enhancements
 * ════════════════════════════════════════
 * 1. Floating Action Button (FAB)
 * 2. Command Palette (Ctrl+K)
 * 3. Onboarding checklist for new users
 * 4. Back-to-top button
 * 5. Page loading progress bar
 * 6. Contextual notification icons
 * 7. Keyboard shortcuts
 */

(function () {
    // ── 1. Page Loading Progress Bar ───────────────────────────────────────
    const bar = document.createElement('div');
    bar.id = 'pageProgressBar';
    document.body.prepend(bar);

    let _progress = 0;
    let _progTimer = null;
    function startProgress() {
        _progress = 10;
        bar.style.opacity = '1';
        bar.style.width = '10%';
        _progTimer = setInterval(() => {
            if (_progress < 80) {
                _progress += Math.random() * 8;
                bar.style.width = _progress + '%';
            }
        }, 200);
    }
    function finishProgress() {
        clearInterval(_progTimer);
        bar.style.width = '100%';
        setTimeout(() => { bar.style.opacity = '0'; bar.style.width = '0%'; }, 400);
    }

    // Hook API fetch to show progress
    const _origApiFetch = window.apiFetch;
    if (_origApiFetch) {
        window.apiFetch = async function (...args) {
            startProgress();
            try {
                const result = await _origApiFetch(...args);
                finishProgress();
                return result;
            } catch (e) {
                finishProgress();
                throw e;
            }
        };
    }

    // ── 2. Back-to-Top Button ───────────────────────────────────────────────
    const btt = document.createElement('button');
    btt.id = 'backToTop';
    btt.innerHTML = '↑';
    btt.title = 'Back to top';
    btt.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.appendChild(btt);

    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) btt.classList.add('visible');
        else btt.classList.remove('visible');
    }, { passive: true });

    // ── 3. Floating Action Button (FAB) ─────────────────────────────────────
    function buildFAB() {
        const user = typeof getUser === 'function' ? getUser() : null;
        if (!user) return;

        const fabEls = [];

        if (user.role === 'client') {
            fabEls.push({ icon: '➕', label: 'Post a Job', href: '/post-job.html' });
            fabEls.push({ icon: '🔍', label: 'Find Freelancers', href: '/freelancers.html' });
        } else {
            fabEls.push({ icon: '💼', label: 'Browse Jobs', href: '/jobs.html' });
        }
        fabEls.push({ icon: '💬', label: 'Messages', href: '/chat.html' });
        fabEls.push({ icon: '🔔', label: 'Notifications', href: '/notifications.html' });
        fabEls.push({ icon: '⌨️', label: 'Quick Search', onclick: 'openCmdPalette()' });

        const fab = document.createElement('div');
        fab.className = 'fab-container';
        fab.id = 'fabContainer';

        const menu = document.createElement('div');
        menu.className = 'fab-menu';
        menu.id = 'fabMenu';
        menu.innerHTML = fabEls.map((item, i) => `
            <div class="fab-item" style="animation-delay:${i * 50}ms">
                <span class="fab-item-label">${item.label}</span>
                ${item.href
                    ? `<a href="${item.href}" class="fab-item-btn" title="${item.label}">${item.icon}</a>`
                    : `<button class="fab-item-btn" onclick="${item.onclick}" title="${item.label}">${item.icon}</button>`
                }
            </div>`).join('');

        const mainBtn = document.createElement('button');
        mainBtn.className = 'fab-main';
        mainBtn.id = 'fabMain';
        mainBtn.innerHTML = '✦';
        mainBtn.title = 'Quick Actions';
        mainBtn.onclick = () => {
            const isOpen = menu.classList.toggle('open');
            mainBtn.classList.toggle('open', isOpen);
        };

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!fab.contains(e.target)) {
                menu.classList.remove('open');
                mainBtn.classList.remove('open');
            }
        });

        fab.appendChild(menu);
        fab.appendChild(mainBtn);
        document.body.appendChild(fab);
    }

    // ── 4. Command Palette ───────────────────────────────────────────────────
    const CMD_PAGES = [
        { icon: '🏠', label: 'Home', sub: 'Go to homepage', href: '/' },
        { icon: '💼', label: 'Browse Jobs', sub: 'Find freelance opportunities', href: '/jobs.html' },
        { icon: '📊', label: 'Dashboard', sub: 'Your projects & earnings', href: '/dashboard.html' },
        { icon: '💬', label: 'Messages', sub: 'Chat with clients & freelancers', href: '/chat.html' },
        { icon: '🔔', label: 'Notifications', sub: 'View all alerts', href: '/notifications.html' },
        { icon: '👤', label: 'My Profile', sub: 'Edit your profile', href: '/profile.html' },
        { icon: '💳', label: 'Wallet', sub: 'Manage ETH & transactions', href: '/wallet.html' },
        { icon: '🔍', label: 'Find Freelancers', sub: 'Browse talent', href: '/freelancers.html' },
        { icon: '➕', label: 'Post a Job', sub: 'Hire top freelancers', href: '/post-job.html' },
    ];

    let _cmdSelected = 0;

    function buildCmdPalette() {
        const overlay = document.createElement('div');
        overlay.className = 'cmd-overlay';
        overlay.id = 'cmdOverlay';
        overlay.onclick = (e) => { if (e.target === overlay) closeCmdPalette(); };

        overlay.innerHTML = `
            <div class="cmd-box" id="cmdBox">
                <div class="cmd-input-wrap">
                    <span>🔍</span>
                    <input class="cmd-input" id="cmdInput" placeholder="Search pages, actions…" autocomplete="off" spellcheck="false">
                    <kbd style="background:rgba(255,255,255,0.06);padding:3px 8px;border-radius:6px;font-size:0.7rem;color:var(--text-muted);">Esc</kbd>
                </div>
                <div class="cmd-results" id="cmdResults"></div>
                <div class="cmd-footer">
                    <span><kbd>↑↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> open</span>
                    <span><kbd>Esc</kbd> close</span>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        const input = document.getElementById('cmdInput');
        input.addEventListener('input', () => renderCmdResults(input.value.trim().toLowerCase()));
        input.addEventListener('keydown', (e) => {
            const items = document.querySelectorAll('.cmd-result-item');
            if (e.key === 'ArrowDown') { e.preventDefault(); _cmdSelected = Math.min(_cmdSelected + 1, items.length - 1); highlightCmd(items); }
            if (e.key === 'ArrowUp') { e.preventDefault(); _cmdSelected = Math.max(_cmdSelected - 1, 0); highlightCmd(items); }
            if (e.key === 'Enter') { e.preventDefault(); const sel = items[_cmdSelected]; if (sel) { const href = sel.dataset.href; if (href) window.location.href = href; } }
            if (e.key === 'Escape') closeCmdPalette();
        });

        renderCmdResults('');
    }

    function renderCmdResults(q) {
        const res = document.getElementById('cmdResults');
        if (!res) return;
        _cmdSelected = 0;
        const filtered = CMD_PAGES.filter(p =>
            !q ||
            p.label.toLowerCase().includes(q) ||
            p.sub.toLowerCase().includes(q)
        );
        if (!filtered.length) { res.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem;">No results found</div>'; return; }
        res.innerHTML = filtered.map((p, i) => `
            <div class="cmd-result-item${i === 0 ? ' selected' : ''}" data-href="${p.href}" onclick="window.location.href='${p.href}'">
                <span class="cmd-result-icon">${p.icon}</span>
                <div>
                    <div class="cmd-result-label">${p.label}</div>
                    <div class="cmd-result-sub">${p.sub}</div>
                </div>
            </div>`).join('');
    }

    function highlightCmd(items) {
        items.forEach((el, i) => el.classList.toggle('selected', i === _cmdSelected));
        items[_cmdSelected]?.scrollIntoView({ block: 'nearest' });
    }

    window.openCmdPalette = function () {
        const overlay = document.getElementById('cmdOverlay');
        if (!overlay) return;
        overlay.classList.add('open');
        setTimeout(() => document.getElementById('cmdInput')?.focus(), 50);
    };

    window.closeCmdPalette = function () {
        const overlay = document.getElementById('cmdOverlay');
        if (overlay) overlay.classList.remove('open');
    };

    // ── 5. Onboarding Checklist ─────────────────────────────────────────────
    function buildOnboarding() {
        const user = typeof getUser === 'function' ? getUser() : null;
        if (!user) return;

        const stored = JSON.parse(localStorage.getItem('fh_onboard') || '{}');
        // Detect completion status
        const checks = {
            profile: !!user.bio,
            wallet: !!user.wallet_address,
            skills: user.role === 'client' ? true : (user.skills && user.skills.length > 0),
            firstAction: user.role === 'client'
                ? !!(stored.postedJob)
                : !!(stored.appliedJob)
        };

        const allDone = Object.values(checks).every(Boolean);
        if (allDone) {
            localStorage.setItem('fh_onboard_done', '1');
            return;
        }
        if (localStorage.getItem('fh_onboard_done')) return;

        const total = Object.keys(checks).length;
        const done = Object.values(checks).filter(Boolean).length;
        const pct = Math.round((done / total) * 100);

        const panel = document.createElement('div');
        panel.className = 'onboard-panel';
        panel.id = 'onboardPanel';

        const isFreelancer = user.role === 'freelancer';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div class="onboard-title">🚀 Get Started</div>
                <button onclick="document.getElementById('onboardPanel').classList.remove('show')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;">×</button>
            </div>
            <div class="onboard-subtitle">${done} of ${total} steps complete</div>
            <div class="onboard-progress-bar"><div class="onboard-progress-fill" style="width:${pct}%"></div></div>
            <div class="onboard-item ${checks.profile ? 'done' : ''}" onclick="window.location='/profile.html'">
                <div class="onboard-check">${checks.profile ? '✓' : ''}</div>
                <span class="onboard-item-text">Complete your profile & bio</span>
            </div>
            <div class="onboard-item ${checks.wallet ? 'done' : ''}" onclick="window.location='/wallet.html'">
                <div class="onboard-check">${checks.wallet ? '✓' : ''}</div>
                <span class="onboard-item-text">Connect your MetaMask wallet</span>
            </div>
            ${isFreelancer ? `
            <div class="onboard-item ${checks.skills ? 'done' : ''}" onclick="window.location='/profile.html'">
                <div class="onboard-check">${checks.skills ? '✓' : ''}</div>
                <span class="onboard-item-text">Add your skills to your profile</span>
            </div>
            <div class="onboard-item ${checks.firstAction ? 'done' : ''}" onclick="window.location='/jobs.html'">
                <div class="onboard-check">${checks.firstAction ? '✓' : ''}</div>
                <span class="onboard-item-text">Submit your first proposal</span>
            </div>` : `
            <div class="onboard-item ${checks.skills ? 'done' : ''}">
                <div class="onboard-check">${checks.skills ? '✓' : ''}</div>
                <span class="onboard-item-text">Skills setup (not needed for clients) ✓</span>
            </div>
            <div class="onboard-item ${checks.firstAction ? 'done' : ''}" onclick="window.location='/post-job.html'">
                <div class="onboard-check">${checks.firstAction ? '✓' : ''}</div>
                <span class="onboard-item-text">Post your first job</span>
            </div>`}
        `;

        document.body.appendChild(panel);

        // Auto-show after 2 seconds if not completed
        setTimeout(() => { panel.classList.add('show'); }, 2000);
    }

    // ── 6. Contextual Notification Icons ────────────────────────────────────
    window.getNotifIcon = function (type) {
        const map = {
            hired: '🤝',
            payment_released: '💸',
            work_submitted: '📤',
            dispute: '⚠️',
            invitation: '📩',
            message: '💬',
            review: '⭐',
            proposal: '📝',
        };
        return map[type] || '🔔';
    };

    // Patch loadNotifications to use contextual icons
    const _origLoadNotifications = window.loadNotifications;
    if (_origLoadNotifications) {
        window.loadNotifications = function () {
            _origLoadNotifications();
            // After notification list is rendered, upgrade icons
            setTimeout(() => {
                document.querySelectorAll('.notification-icon').forEach(el => {
                    const item = el.closest('[data-notif-type]');
                    if (item) el.textContent = getNotifIcon(item.dataset.notifType);
                });
            }, 500);
        };
    }

    // ── 7. Keyboard Shortcuts ────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        // Ctrl+K or Cmd+K = command palette
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            openCmdPalette();
        }
        // Escape = close command palette
        if (e.key === 'Escape') closeCmdPalette();
        // / = focus search input if on jobs page
        if (e.key === '/' && document.activeElement.tagName === 'BODY') {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) { e.preventDefault(); searchInput.focus(); }
        }
    });

    // ── Initialize on DOM ready ──────────────────────────────────────────────
    function init() {
        buildCmdPalette();
        buildFAB();
        if (typeof getUser === 'function' && getUser()) {
            buildOnboarding();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Slight delay to ensure app.js has run (getUser is defined)
        setTimeout(init, 100);
    }

})();
