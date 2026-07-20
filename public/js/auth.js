// Shared across index.html, studio.html, play.html.
let currentUser = null;
const listeners = [];

export function onAuthChange(fn) { listeners.push(fn); }
function notify() { listeners.forEach(fn => fn(currentUser)); }

export async function fetchMe() {
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  currentUser = data.user;
  notify();
  return currentUser;
}

export function getUser() { return currentUser; }

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  notify();
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

export function mountAuthWidget(container) {
  render();
  onAuthChange(render);

  function render() {
    container.innerHTML = '';
    const widget = document.createElement('div');
    widget.className = 'auth-widget';
    if (currentUser) {
      widget.innerHTML = `
        <div class="auth-chip">
          <span class="auth-avatar-dot" style="background:${currentUser.color}"></span>
          ${escapeHtml(currentUser.username)}
        </div>
        <button class="auth-signout" id="signOutBtn">Sign out</button>
      `;
      container.appendChild(widget);
      widget.querySelector('#signOutBtn').addEventListener('click', logout);
    } else {
      widget.innerHTML = `<button class="btn-ghost" id="signInBtn" style="padding:8px 16px;font-size:13px;">Sign in</button>`;
      container.appendChild(widget);
      widget.querySelector('#signInBtn').addEventListener('click', () => openAuthModal('login'));
    }
  }
}

export function openAuthModal(mode = 'login', onSuccess) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card">
      <button class="modal-close" id="modalCloseBtn">✕</button>
      <h3 id="modalTitle">${mode === 'login' ? 'Sign in' : 'Create account'}</h3>
      <p class="sub" id="modalSub">${mode === 'login' ? 'Welcome back to LeGames.' : 'Takes ten seconds, no email needed.'}</p>
      <div class="field"><label>Username</label><input type="text" id="modalUsername" autocomplete="username"></div>
      <div class="field"><label>Password</label><input type="password" id="modalPassword" autocomplete="current-password"></div>
      <div class="error" id="modalError"></div>
      <div class="modal-actions">
        <button class="btn-primary" id="modalSubmit" style="flex:1;">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </div>
      <div class="switch-mode" id="modalSwitch"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  let currentMode = mode;
  const title = backdrop.querySelector('#modalTitle');
  const sub = backdrop.querySelector('#modalSub');
  const submitBtn = backdrop.querySelector('#modalSubmit');
  const switchEl = backdrop.querySelector('#modalSwitch');
  const errorEl = backdrop.querySelector('#modalError');
  const userInput = backdrop.querySelector('#modalUsername');
  const passInput = backdrop.querySelector('#modalPassword');

  function renderSwitch() {
    switchEl.innerHTML = currentMode === 'login'
      ? `New here? <a id="toRegister">Create an account</a>`
      : `Already have an account? <a id="toLogin">Sign in</a>`;
    const link = switchEl.querySelector(currentMode === 'login' ? '#toRegister' : '#toLogin');
    link.addEventListener('click', () => {
      currentMode = currentMode === 'login' ? 'register' : 'login';
      title.textContent = currentMode === 'login' ? 'Sign in' : 'Create account';
      sub.textContent = currentMode === 'login' ? 'Welcome back to LeGames.' : 'Takes ten seconds, no email needed.';
      submitBtn.textContent = currentMode === 'login' ? 'Sign in' : 'Create account';
      errorEl.textContent = '';
      renderSwitch();
    });
  }
  renderSwitch();

  function close() { backdrop.remove(); }
  backdrop.querySelector('#modalCloseBtn').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  async function submit() {
    const username = userInput.value.trim();
    const password = passInput.value;
    errorEl.textContent = '';
    try {
      const res = await fetch(`/api/auth/${currentMode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) { errorEl.textContent = data.error || 'Something went wrong'; return; }
      currentUser = data.user;
      notify();
      close();
      if (onSuccess) onSuccess(currentUser);
    } catch (e) {
      errorEl.textContent = 'Could not reach server';
    }
  }
  submitBtn.addEventListener('click', submit);
  passInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  userInput.focus();
}
