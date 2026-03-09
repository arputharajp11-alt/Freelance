/* ═══════════════════════════════════════════════════════════════════════
   FreelancerHub — Shared JavaScript Utilities
   ═══════════════════════════════════════════════════════════════════════ */

// API base — set by /js/config.js (auto-detects local vs production)
const API_BASE = (typeof window !== 'undefined' && window.FH_API_BASE) ? window.FH_API_BASE : '/api';

// ── Token / User storage ─────────────────────────────────────────────────
const TOKEN_KEY = 'fh_token';
const USER_KEY = 'fh_user';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function removeToken() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function isLoggedIn() { return !!getToken(); }

function requireAuth() {
    if (!isLoggedIn()) { window.location.href = '/login.html'; return false; }
    return true;
}

// ── API Helper ────────────────────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers
    };

    try {
        const resp = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
        const data = await resp.json();

        if (resp.status === 401) {
            removeToken();
            window.location.href = '/login.html';
            return null;
        }
        if (!resp.ok) throw new Error(data.error || 'Something went wrong');
        return data;
    } catch (error) {
        if (error.name === 'TypeError' && (error.message === 'Failed to fetch' || error.message.includes('fetch'))) {
            const friendlyErr = new Error('Cannot connect to server. Make sure the server is running and try again.');
            showToast(friendlyErr.message, 'error');
            throw friendlyErr;
        }
        throw error;
    }
}

// ── Toast Notifications ───────────────────────────────────────────────────
function showToast(message, type = 'info') {
    // Prefer the toastContainer element used by the newer HTML pages
    let container = document.getElementById('toastContainer') || document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> <span>${message}</span>`;
    toast.onclick = () => toast.remove();
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.transition = 'opacity 0.4s';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ── Auth: Login ───────────────────────────────────────────────────────────
async function login(email, password) {
    const btn = document.querySelector('#loginForm button[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    try {
        const data = await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        if (!data) return; // redirected by apiFetch on 401

        setToken(data.token);
        setUser(data.user);
        showToast('Login successful! Redirecting…', 'success');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 800);
    } catch (error) {
        showToast(error.message || 'Login failed. Please try again.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
    }
}

// ── Auth: Register ────────────────────────────────────────────────────────
async function register(full_name, email, password, role) {
    const btn = document.querySelector('#registerForm button[type=submit]');
    const originalText = btn ? btn.textContent : 'Create Free Account';
    if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }

    try {
        const data = await apiFetch('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ full_name, email, password, role })
        });
        if (!data) return;

        setToken(data.token);
        setUser(data.user);
        showToast('Account created! Welcome to FreelancerHub 🎉', 'success');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 900);
    } catch (error) {
        let msg = error.message || 'Registration failed. Please try again.';
        if (msg.includes('Failed to fetch') || msg.includes('ETIMEDOUT') || msg.includes('connect')) {
            msg = 'Cannot connect to server. Please check your connection and try again.';
        } else if (msg.includes('already registered') || msg.includes('already exists')) {
            msg = 'This email is already registered. Try signing in instead.';
        }
        showToast(msg, 'error');
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
}

// ── Auth: Logout ──────────────────────────────────────────────────────────
async function logout() {
    try {
        await apiFetch('/auth/logout', { method: 'POST' });
    } catch (e) { /* ignore */ }
    removeToken();
    window.location.href = '/';
}

// ── Navbar ────────────────────────────────────────────────────────────────
function updateNav() {
    const user = getUser();
    // New-style navbar elements
    const navLogin = document.getElementById('navLogin');
    const navRegister = document.getElementById('navRegister');
    const navUser = document.getElementById('navUser');
    const navAvatar = document.getElementById('navAvatar');

    if (user) {
        if (navLogin) navLogin.style.display = 'none';
        if (navRegister) navRegister.style.display = 'none';
        if (navUser) navUser.style.display = 'flex';
        if (navAvatar) navAvatar.textContent = (user.full_name || user.email || 'U').charAt(0).toUpperCase();
    } else {
        if (navLogin) navLogin.style.display = '';
        if (navRegister) navRegister.style.display = '';
        if (navUser) navUser.style.display = 'none';
    }
}

function toggleDropdown() {
    const menu = document.getElementById('navDropdown') || document.getElementById('dropdown-menu');
    if (menu) menu.classList.toggle('show');
}

function toggleNav() {
    const links = document.getElementById('navLinks') || document.getElementById('nav-links');
    if (links) {
        const isHidden = links.style.display === 'none' || !links.style.display;
        links.style.display = isHidden ? 'flex' : 'none';
    }
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('navUser') || document.getElementById('user-dropdown');
    const menu = document.getElementById('navDropdown') || document.getElementById('dropdown-menu');
    if (menu && dropdown && !dropdown.contains(e.target)) {
        menu.classList.remove('show');
    }
});

// ── Unread badge counts ───────────────────────────────────────────────────
async function fetchUnreadCounts() {
    if (!isLoggedIn()) return;
    try {
        const [chatData, notifData] = await Promise.all([
            apiFetch('/chat/unread'),
            apiFetch('/notifications?unread_only=true&limit=1')
        ]);
        const chatBadge = document.getElementById('chat-badge');
        const notifBadge = document.getElementById('notif-badge');
        if (chatData && chatData.unread > 0 && chatBadge) {
            chatBadge.textContent = chatData.unread;
            chatBadge.classList.remove('hidden');
        }
        if (notifData && notifData.unread_total > 0 && notifBadge) {
            notifBadge.textContent = notifData.unread_total;
            notifBadge.classList.remove('hidden');
        }
    } catch (e) { /* ignore */ }
}

// ── Utility functions ─────────────────────────────────────────────────────
function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

function formatBudget(min, max, type) {
    if (!min && !max) return 'Negotiable';
    if (type === 'hourly') return `${min}–${max} ETH/hr`;
    return `${min}–${max} ETH`;
}

function getStatusIcon(status) {
    return { open: '🟢', in_progress: '🔵', submitted: '🟡', completed: '✅', cancelled: '🔴', disputed: '⚠️', pending: '⏳', accepted: '✅', rejected: '❌' }[status] || '📋';
}

function renderSkills(skills) {
    if (!Array.isArray(skills)) return '';
    return skills.map(s => `<span class="badge badge-skill">${escapeHtml(s)}</span>`).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}

function closeModal() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('show'));
}

// ── Job card renderer ─────────────────────────────────────────────────────
function renderJobCard(j) {
    const budget = formatBudget(j.budget_min, j.budget_max, j.budget_type);
    const skills = (j.skills_required || []).slice(0, 4).map(s => `<span class="badge badge-skill">${escapeHtml(s)}</span>`).join('');
    return `
    <div class="job-card" onclick="location.href='/job-detail.html?id=${j.id}'">
        <div class="job-card-header">
            <div class="job-card-title">${escapeHtml(j.title)}</div>
            <div class="job-card-budget">${budget}</div>
        </div>
        <p class="job-card-description">${escapeHtml(j.description || '')}</p>
        <div class="job-card-meta">${skills}</div>
        <div class="job-card-footer">
            <span>${escapeHtml(j.category || '')}</span>
            <span class="badge badge-${j.status}">${j.status || 'open'}</span>
        </div>
    </div>`;
}

// ── Page loaders ──────────────────────────────────────────────────────────
function loadFeaturedJobs() {
    const el = document.getElementById('featuredJobs');
    if (!el) return;
    fetch(`${API_BASE}/jobs?limit=6`)
        .then(r => r.json())
        .then(d => {
            const jobs = d.jobs || [];
            el.innerHTML = jobs.length
                ? jobs.map(renderJobCard).join('')
                : '<div class="empty-state"><p>No jobs posted yet. Be the first!</p></div>';
        })
        .catch(() => { el.innerHTML = '<div class="empty-state"><p>Could not load jobs.</p></div>'; });
}

let allJobs = [];
function loadJobs() {
    const el = document.getElementById('jobsGrid');
    if (!el) return;
    fetch(`${API_BASE}/jobs`)
        .then(r => r.json())
        .then(d => { allJobs = d.jobs || []; renderJobs(allJobs); })
        .catch(() => { el.innerHTML = '<div class="empty-state"><p>Could not load jobs.</p></div>'; });
}

function renderJobs(jobs) {
    const el = document.getElementById('jobsGrid');
    if (!el) return;
    el.innerHTML = jobs.length ? jobs.map(renderJobCard).join('') : '<div class="empty-state"><p>No jobs found.</p></div>';
}

function filterJobs() {
    const q = (document.getElementById('searchInput') || {}).value || '';
    const cat = (document.getElementById('categoryFilter') || {}).value || '';
    renderJobs(allJobs.filter(j => {
        const matchQ = !q || j.title.toLowerCase().includes(q.toLowerCase());
        const matchCat = !cat || j.category === cat;
        return matchQ && matchCat;
    }));
}

function loadDashboard() {
    const user = getUser();
    if (!user) { location.href = '/login.html'; return; }

    const welcome = document.getElementById('dashWelcome');
    if (welcome) welcome.textContent = `Welcome back, ${user.full_name || user.email}!`;

    const postBtn = document.getElementById('postJobBtn');
    const findBtn = document.getElementById('findJobBtn');
    if (user.role === 'client' && postBtn) postBtn.style.display = '';
    if (user.role === 'freelancer' && findBtn) findBtn.style.display = '';

    // Load user's jobs
    if (user.role === 'client') {
        loadPostedJobs();
    } else {
        loadAppliedJobs();
    }
}

async function loadPostedJobs() {
    const tc = document.getElementById('tabContent');
    if (!tc) return;
    tc.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div><span>Loading...</span></div>';
    try {
        const data = await apiFetch('/jobs/my/posted');
        const jobs = data?.jobs || [];
        if (!jobs.length) {
            tc.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No jobs posted yet.</p><a href="/post-job.html" class="btn btn-primary">Post Your First Job</a></div>';
            return;
        }
        tc.innerHTML = jobs.map(j => `
            <div class="job-card" style="margin-bottom:16px;" onclick="location.href='/job-detail.html?id=${j.id}'">
                <div class="job-card-header">
                    <div class="job-card-title">${escapeHtml(j.title)}</div>
                    <span class="badge badge-${j.status}">${j.status}</span>
                </div>
                <div class="job-card-meta" style="margin-top:10px;">
                    <span style="color:var(--text-muted);font-size:0.8rem;">📝 ${j.proposal_count || 0} proposals</span>
                    <span style="color:var(--text-muted);font-size:0.8rem;">💰 ${formatBudget(j.budget_min, j.budget_max, j.budget_type)}</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        tc.innerHTML = '<div class="empty-state"><p>Could not load jobs.</p></div>';
    }
}

async function loadAppliedJobs() {
    const tc = document.getElementById('tabContent');
    if (!tc) return;
    tc.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div><span>Loading...</span></div>';
    try {
        const data = await apiFetch('/jobs/my/applied');
        const jobs = data?.jobs || [];
        if (!jobs.length) {
            tc.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><p class="empty-state-text">No applications yet.</p><a href="/jobs.html" class="btn btn-primary">Browse Jobs</a></div>';
            return;
        }
        tc.innerHTML = jobs.map(j => `
            <div class="job-card" style="margin-bottom:16px;" onclick="location.href='/job-detail.html?id=${j.id}'">
                <div class="job-card-header">
                    <div class="job-card-title">${escapeHtml(j.title)}</div>
                    <span class="badge badge-${j.proposal_status}">${j.proposal_status}</span>
                </div>
                <div class="job-card-meta" style="margin-top:10px;">
                    <span style="color:var(--text-muted);font-size:0.8rem;">👤 ${escapeHtml(j.client_name)}</span>
                    <span style="color:#64ffda;font-size:0.85rem;font-weight:700;">💰 ${j.proposed_amount} ETH</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        tc.innerHTML = '<div class="empty-state"><p>Could not load applications.</p></div>';
    }
}

function switchTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const user = getUser();
    if (tab === 'jobs') {
        if (user?.role === 'client') loadPostedJobs();
        else loadAppliedJobs();
    } else if (tab === 'proposals') {
        if (user?.role === 'client') loadProposalsReceived();
        else loadAppliedJobs();
    }
}

async function loadProposalsReceived() {
    const tc = document.getElementById('tabContent');
    if (!tc) return;
    tc.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div><span>Loading...</span></div>';
    tc.innerHTML = '<div class="empty-state"><p>No proposals yet on your jobs.</p></div>';
}

function loadJobDetail() {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) return;
    const el = document.getElementById('jobDetailContent');
    if (!el) return;

    el.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div><span>Loading job...</span></div>';

    apiFetch(`/jobs/${id}`)
        .then(data => {
            const j = data.job;
            const user = getUser();
            const isClient = user && user.id === j.client_id;
            const isFreelancer = user && user.role === 'freelancer';

            el.innerHTML = `
            <div class="job-detail-header" style="margin-bottom:24px;">
                <div class="job-detail-meta" style="margin-bottom:12px;">
                    <span>${escapeHtml(j.category)}</span>
                    <span>${formatBudget(j.budget_min, j.budget_max, j.budget_type)}</span>
                    <span class="badge badge-${j.status}">${getStatusIcon(j.status)} ${j.status}</span>
                </div>
                <h1 class="job-detail-title">${escapeHtml(j.title)}</h1>
                <p style="color:var(--text-muted);font-size:0.85rem;">Posted by <strong>${escapeHtml(j.client_name)}</strong> · ${timeAgo(j.created_at)}</p>
            </div>
            <div class="job-detail-body">
                <div class="job-detail-content">
                    <h3>Description</h3>
                    <p>${escapeHtml(j.description)}</p>
                    <h3>Skills Required</h3>
                    <div class="job-card-meta">${renderSkills(j.skills_required)}</div>
                </div>
                <div class="job-detail-sidebar">
                    <div class="sidebar-card">
                        <h3>Details</h3>
                        <div class="sidebar-info-row"><span class="label">Budget</span><span class="value">${formatBudget(j.budget_min, j.budget_max, j.budget_type)}</span></div>
                        <div class="sidebar-info-row"><span class="label">Duration</span><span class="value">${escapeHtml(j.duration || 'Negotiable')}</span></div>
                        <div class="sidebar-info-row"><span class="label">Level</span><span class="value">${escapeHtml(j.experience_level || 'Any')}</span></div>
                        <div class="sidebar-info-row"><span class="label">Proposals</span><span class="value">${j.proposal_count || 0}</span></div>
                    </div>
                    ${isFreelancer && j.status === 'open' ? `<button class="btn btn-primary" style="width:100%;margin-top:12px;" onclick="openProposalModal()">✏️ Submit Proposal</button>` : ''}
                    ${isClient && j.status === 'submitted' ? `<button class="btn btn-primary" style="width:100%;margin-top:12px;" onclick="completeJob(${j.id})">✅ Approve & Release Payment</button>` : ''}
                </div>
            </div>`;

            // Show proposals if client
            if (isClient && data.proposals && data.proposals.length > 0) {
                const propsHtml = data.proposals.map(p => `
                    <div class="proposal-card">
                        <div class="proposal-header">
                            <div class="proposal-freelancer">
                                <div class="proposal-freelancer-avatar">${(p.full_name || '?').charAt(0)}</div>
                                <div>
                                    <div style="font-weight:700;">${escapeHtml(p.full_name)}</div>
                                    <div style="font-size:0.78rem;color:var(--text-muted);">⭐ ${p.rating || 0} · ${p.total_reviews || 0} reviews</div>
                                </div>
                            </div>
                            <div class="proposal-amount">${p.proposed_amount} ETH</div>
                        </div>
                        <p class="proposal-letter">${escapeHtml(p.cover_letter)}</p>
                        ${j.status === 'open' && p.status === 'pending' ? `
                        <div class="proposal-actions">
                            <button class="btn btn-primary btn-sm" onclick="hireFreelancer(${j.id}, ${p.freelancer_id})">✅ Hire</button>
                        </div>` : `<span class="badge badge-${p.status}">${p.status}</span>`}
                    </div>
                `).join('');
                el.innerHTML += `<div style="margin-top:32px;"><h3 style="font-size:1.1rem;font-weight:700;margin-bottom:16px;">📝 Proposals (${data.proposals.length})</h3><div class="proposal-list">${propsHtml}</div></div>`;
            }
        })
        .catch(() => { el.innerHTML = '<div class="empty-state"><p>Job not found.</p></div>'; });
}

function openProposalModal() {
    const m = document.getElementById('proposalModal');
    if (m) m.classList.add('show');
}

// ── Proposal form submit ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('proposalForm');
    if (!form) return; // only on job-detail page

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const jobId = new URLSearchParams(location.search).get('id');
        if (!jobId) { showToast('Job ID missing', 'error'); return; }

        const amount   = document.getElementById('propAmount')?.value?.trim();
        const delivery = document.getElementById('propDelivery')?.value?.trim();
        const letter   = document.getElementById('propLetter')?.value?.trim();

        if (!amount || !letter) {
            showToast('Please fill in all required fields', 'error');
            return;
        }

        const submitBtn = form.querySelector('button[type=submit]');
        const originalText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Submitting…'; }

        try {
            await apiFetch(`/jobs/${jobId}/apply`, {
                method: 'POST',
                body: JSON.stringify({
                    cover_letter: letter,
                    proposed_amount: parseFloat(amount),
                    estimated_duration: delivery || ''
                })
            });
            showToast('✅ Proposal submitted successfully!', 'success');
            closeModal();
            form.reset();
            // Reload job to show updated proposal count
            setTimeout(() => location.reload(), 1200);
        } catch (err) {
            showToast(err.message || 'Failed to submit proposal', 'error');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
        }
    });
});


async function hireFreelancer(jobId, freelancerId) {
    if (!confirm('Hire this freelancer and move the job to In Progress?')) return;
    try {
        await apiFetch(`/jobs/${jobId}/hire/${freelancerId}`, { method: 'POST', body: JSON.stringify({}) });
        showToast('Freelancer hired! 🎉', 'success');
        setTimeout(() => location.reload(), 1200);
    } catch (e) {
        showToast(e.message || 'Failed to hire', 'error');
    }
}

async function completeJob(jobId) {
    if (!confirm('Approve the work and release escrow payment?')) return;
    try {
        await apiFetch(`/jobs/${jobId}/complete`, { method: 'POST', body: JSON.stringify({}) });
        showToast('Payment released! Project completed 🎉', 'success');
        setTimeout(() => location.reload(), 1200);
    } catch (e) {
        showToast(e.message || 'Failed to complete', 'error');
    }
}

function loadProfile() {
    const user = getUser();
    const el = document.getElementById('profileContent');
    if (!el) return;
    if (!user) {
        el.innerHTML = '<div class="empty-state"><p>Please <a href="/login.html">sign in</a> to view your profile.</p></div>';
        return;
    }
    const initial = (user.full_name || user.email || 'U').charAt(0).toUpperCase();
    el.innerHTML = `
    <div class="profile-header">
        <div class="profile-avatar-lg">${initial}</div>
        <div class="profile-info">
            <span class="badge badge-${user.role === 'client' ? 'open' : 'in_progress'}">${user.role}</span>
            <h1>${escapeHtml(user.full_name || 'Anonymous')}</h1>
            <p class="bio" style="color:var(--text-secondary);">${escapeHtml(user.bio || 'No bio yet.')}</p>
            <p style="color:var(--text-muted);font-size:0.85rem;">${escapeHtml(user.email)}</p>
        </div>
    </div>
    <div class="profile-stats">
        <div class="stat-card"><div class="stat-value">${user.rating || '0.0'}</div><div class="stat-label">Rating</div></div>
        <div class="stat-card"><div class="stat-value">${user.total_reviews || 0}</div><div class="stat-label">Reviews</div></div>
        <div class="stat-card"><div class="stat-value">${user.total_earnings ? user.total_earnings + ' ETH' : '—'}</div><div class="stat-label">${user.role === 'client' ? 'Spent' : 'Earned'}</div></div>
    </div>
    ${user.skills && user.skills.length ? `<div style="margin-top:20px;"><h3 style="font-size:1rem;font-weight:700;margin-bottom:12px;">Skills</h3><div class="job-card-meta">${renderSkills(user.skills)}</div></div>` : ''}`;
}

function loadWallet() {
    const el = document.getElementById('txList');
    apiFetch('/wallet')
        .then(d => {
            const w = d.wallet || {};
            const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
            setEl('walletBalance', (w.balance || 0).toFixed(4) + ' ETH');
            setEl('walletEarned', (w.total_earned || 0).toFixed(4) + ' ETH');
            setEl('walletPending', (w.pending_count || 0) + ' pending');
            if (!el) return;
            const txs = d.transactions || [];
            if (!txs.length) { el.innerHTML = '<div class="empty-state"><p>No transactions yet.</p></div>'; return; }
            el.innerHTML = txs.map(t => `
                <div class="sidebar-info-row">
                    <span class="label">${escapeHtml(t.description || t.type)}</span>
                    <span class="value" style="color:${t.type === 'credit' || t.type === 'deposit' ? 'var(--success)' : 'var(--error)'}">
                        ${t.type === 'credit' || t.type === 'deposit' ? '+' : '-'}${parseFloat(t.amount).toFixed(4)} ETH
                    </span>
                </div>`).join('');
        })
        .catch(() => { if (el) el.innerHTML = '<div class="empty-state"><p>Could not load wallet.</p></div>'; });
}

function withdrawFunds() {
    const amount = prompt('Enter amount in ETH to withdraw:');
    if (!amount || isNaN(amount)) return;
    apiFetch('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: parseFloat(amount) }) })
        .then(d => { showToast(d.message || 'Withdrawal requested', 'success'); loadWallet(); })
        .catch(e => showToast(e.message || 'Withdrawal failed', 'error'));
}

function loadNotifications() {
    const el = document.getElementById('notifList');
    if (!el) return;
    apiFetch('/notifications')
        .then(d => {
            const ns = d.notifications || [];
            if (!ns.length) { el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔔</div><p>No notifications yet.</p></div>'; return; }
            el.innerHTML = ns.map(n => `
                <div class="notification-item${n.is_read ? '' : ' unread'}" onclick="markRead(${n.id}, this)">
                    <div class="notification-icon">🔔</div>
                    <div>
                        <div class="notification-title">${escapeHtml(n.title)}</div>
                        <div class="notification-message">${escapeHtml(n.message)}</div>
                        <div class="notification-time">${timeAgo(n.created_at)}</div>
                    </div>
                </div>`).join('');
        })
        .catch(() => { el.innerHTML = '<div class="empty-state"><p>Could not load notifications.</p></div>'; });
}

function markRead(id, el) {
    apiFetch(`/notifications/${id}/read`, { method: 'PUT' })
        .then(() => { if (el) el.classList.remove('unread'); })
        .catch(() => { });
}

function markAllRead() {
    apiFetch('/notifications/read-all', { method: 'PUT' })
        .then(() => { showToast('All marked as read', 'success'); loadNotifications(); })
        .catch(() => { });
}

function filterNotifs(type, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadNotifications();
}

function loadConversations() {
    const el = document.getElementById('conversationList');
    if (!el) return;
    if (!isLoggedIn()) { el.innerHTML = '<div class="empty-state"><p>Please sign in.</p></div>'; return; }

    apiFetch('/chat/conversations')
        .then(d => {
            const convs = d.conversations || [];
            if (!convs.length) { el.innerHTML = '<div class="empty-state" style="padding:20px"><p>No conversations yet.</p></div>'; return; }
            el.innerHTML = convs.map(c => `
                <div class="conversation-item" onclick="openConversation('${c.id}')">
                    <div class="conversation-avatar">${(c.other_name || 'U').charAt(0).toUpperCase()}${c.other_online ? '<span class="online-dot"></span>' : ''}</div>
                    <div class="conversation-info">
                        <div class="conversation-name">${escapeHtml(c.other_name || 'Unknown')}</div>
                        <div class="conversation-preview">${escapeHtml(c.last_message || 'No messages yet')}</div>
                    </div>
                    ${c.unread_count > 0 ? `<span class="nav-badge">${c.unread_count}</span>` : ''}
                </div>`).join('');
        })
        .catch(() => { el.innerHTML = '<div class="empty-state"><p>Could not load.</p></div>'; });
}

function openConversation(convId) {
    const ci = document.getElementById('chatInputArea');
    const msgs = document.getElementById('chatMessages');
    if (ci) ci.style.display = 'flex';
    if (msgs) msgs.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div></div>';

    apiFetch(`/chat/messages/${convId}`)
        .then(d => {
            const user = getUser();
            const ms = d.messages || [];
            if (!msgs) return;
            msgs.innerHTML = ms.map(m => {
                const sent = String(m.sender_id) === String(user?.id);
                return `<div class="message message-${sent ? 'sent' : 'received'}"><div class="message-text">${escapeHtml(m.message)}</div><div class="message-time">${timeAgo(m.created_at)}</div></div>`;
            }).join('');
            msgs.scrollTop = msgs.scrollHeight;
            // Store active conversation
            window._activeConvId = convId;
        })
        .catch(() => { if (msgs) msgs.innerHTML = '<div class="empty-state"><p>Could not load messages.</p></div>'; });
}

function handleMsgKey(e) { if (e.key === 'Enter') sendMessage(); }

function sendMessage() {
    const inp = document.getElementById('messageInput');
    const text = inp?.value?.trim();
    if (!text || !window._activeConvId) return;
    inp.value = '';
    apiFetch('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: window._activeConvId, message: text, receiver_id: 0 })
    }).then(() => openConversation(window._activeConvId)).catch(() => { });
}

function postJob(data) {
    const user = getUser();
    if (!user) { location.href = '/login.html'; return; }
    apiFetch('/jobs', { method: 'POST', body: JSON.stringify(data) })
        .then(d => {
            showToast('Job posted successfully! 🎉', 'success');
            setTimeout(() => { location.href = '/dashboard.html'; }, 1200);
        })
        .catch(e => showToast(e.message || 'Failed to post job', 'error'));
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateNav();
    if (isLoggedIn()) fetchUnreadCounts();

    // Check verification status from URL
    const params = new URLSearchParams(window.location.search);
    const verified = params.get('verified');
    if (verified === 'success') showToast('Email verified! 🎉', 'success');
    if (verified === 'expired') showToast('Verification link expired. Request a new one.', 'error');
    if (verified === 'invalid') showToast('Invalid verification link.', 'error');
});
