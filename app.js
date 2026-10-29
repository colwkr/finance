// Finance, on its own: the same records Nerve keeps (Supabase table fin_docs), signed in with the Nerve account.
// finance.js draws every page; this file is the frame around it: sign-in, the section tabs, taps and the toast.
(function () {
  const SB_URL = 'https://dejcovbqwlrvniitbdqv.supabase.co';
  const SB_KEY = 'sb_publishable_VB-KHKnNz_J5EKWvHKW9Ew_7B2sI6Zg';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const S = { user: null, ready: false };
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'finance.auth' } });

  let toastT = null;
  function toast(text, undo, label = 'Undo') {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button">${esc(label)}</button>` : ''}`;
    el.hidden = false;
    if (undo) el.querySelector('button').onclick = () => { el.hidden = true; undo(); };
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, undo ? 5000 : 3000);
  }

  // A redraw waits while you're typing in a field on the page, so a save from another device can't wipe it.
  let pending = false;
  const editing = () => { const a = document.activeElement; return !!(a && a.closest('#view') && a.matches('input, textarea')); };
  document.addEventListener('focusout', () => { if (pending) setTimeout(() => { if (!editing()) render(); }, 0); });

  let FIN = null;
  function render() {
    if (editing()) { pending = true; return; }
    pending = false;
    const view = $('#view'), signedIn = !!S.user;
    $('#tabs').hidden = !signedIn; $('#signOut').hidden = !signedIn; $('#addBtn').hidden = !signedIn;
    if (!S.ready) { view.innerHTML = ''; return; }
    if (!signedIn) { view.innerHTML = vLogin(); return; }
    const side = FIN.side();
    $('#tabs').innerHTML = side.items.map(i => `<button type="button" data-act="fin-sub" data-sub="${esc(i.key)}"${i.key === side.current ? ' aria-current="page"' : ''}>${i.icon}<span>${esc(i.label)}</span>${i.badge ? `<em>${i.badge}</em>` : ''}</button>`).join('');
    const sc = $('#finScroll'), top = sc ? sc.scrollTop : 0;
    view.innerHTML = FIN.view();
    const sc2 = $('#finScroll'); if (sc2) sc2.scrollTop = top;
    document.title = 'Finance · ' + ((side.items.find(i => i.key === side.current) || {}).label || '');
  }

  function vLogin() {
    return `<div class="login"><form id="loginForm" class="float login-card" novalidate>
      <h1 class="login-title">Finance</h1>
      <p class="meta">Sign in with your Nerve account.</p>
      <label class="f"><span class="f-h">Email</span><input id="l_email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required></label>
      <label class="f"><span class="f-h">Password</span><input id="l_pass" type="password" autocomplete="current-password" required></label>
      <p class="err" id="l_err" hidden></p>
      <button type="submit" class="btn solid" id="l_go">Sign in</button>
    </form></div>`;
  }
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'loginForm') return;
    e.preventDefault();
    const err = $('#l_err'), go = $('#l_go');
    go.disabled = true; err.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#l_email').value.trim(), password: $('#l_pass').value });
    go.disabled = false;
    if (error) { err.textContent = 'That email and password did not work.'; err.hidden = false; }
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !FIN) return;
    const act = b.dataset.act;
    if (act.startsWith('fin-')) { e.preventDefault(); FIN.act(act, b, e); }
  });
  $('#addBtn').onclick = () => { if (FIN && S.user) FIN.add(); };
  $('#signOut').onclick = () => sb.auth.signOut();

  FIN = window.POSFinance({ sb, toast, esc, clamp, rerender: render, canSave: () => !!S.user });

  sb.auth.onAuthStateChange((_ev, session) => {
    const u = session ? session.user : null, was = S.user && S.user.id;
    S.user = u; S.ready = true;
    if (u && was !== u.id) FIN.start();
    if (!u && was) FIN.stop();
    render();
  });
  // coming back to the app (the phone woke, the tab was hidden): fetch what changed meanwhile
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) FIN.start(); });
})();
