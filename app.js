// Finance, on its own: the same records Nerve keeps (Supabase table fin_docs), signed in with the Nerve account.
// finance.js draws every page; this file is the frame around it: sign-in, the section tabs, taps and the toast.
(function () {
  // The page's height (--appH). On the Home Screen with the see-through status bar, iOS starts the page at the very top of
  // the glass but reports the screen shorter by the top inset (62pt on an iPhone 17 Pro), which left a bare strip at the
  // bottom. When the reported height plus that inset still fits the screen, that's the shortfall, and it's added back.
  // (window.FIN_TEST lets the local test page stand in for the phone: standalone, screen height.)
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;visibility:hidden;pointer-events:none;height:var(--envT)';
  document.documentElement.appendChild(probe);
  function fitScreen() {
    const T = window.FIN_TEST || {};
    const standalone = T.standalone != null ? T.standalone : navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    const screenH = T.screenH || screen.height, top = probe.offsetHeight;
    const short = standalone && innerHeight >= innerWidth && top > 0 && innerHeight + top <= screenH;
    document.documentElement.style.setProperty('--appH', (short ? innerHeight + top : innerHeight) + 'px');
    document.documentElement.style.setProperty('--gapB', (short ? top : 0) + 'px'); // how far the window stops short of the screen's bottom
  }
  fitScreen();
  addEventListener('resize', fitScreen);
  addEventListener('orientationchange', () => setTimeout(fitScreen, 250));

  // GitHub Pages lets a phone keep the page cached for up to 10 minutes, so a home-screen app could keep running an
  // older build. On open (and coming back to it), ask for version.json fresh; when it's newer, load that build.
  async function checkVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const { v } = await r.json();
      // one try per version, so a slow cache can never send it round in a loop
      let tried = null; try { tried = sessionStorage.getItem('fin.tried'); } catch (e) {}
      if (v && v !== window.APP_V && tried !== v) {
        try { sessionStorage.setItem('fin.tried', v); } catch (e) {}
        location.replace(location.pathname + '?v=' + encodeURIComponent(v));
      }
    } catch (e) {}
  }
  checkVersion();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });

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
    $('#bar').hidden = !signedIn; $('#addBtn').hidden = !signedIn;
    if (!signedIn) setMenu(false);
    if (!S.ready) { view.innerHTML = ''; return; }
    if (!signedIn) { view.innerHTML = vLogin(); return; }
    const side = FIN.side(), cur = side.items.find(i => i.key === side.current) || {};
    $('#nav').innerHTML = side.items.map(i => `<button type="button" data-act="fin-sub" data-sub="${esc(i.key)}"${i.key === side.current ? ' aria-current="page"' : ''}>${i.icon}<span>${esc(i.label)}</span>${i.badge ? `<em>${i.badge}</em>` : ''}</button>`).join('');
    $('#where').textContent = cur.label || '';
    $('#addBtn').hidden = side.current === 'home'; // Accounts has no +: balances are set by tapping a card
    // the menu button carries a dot when another section has something waiting
    const waiting = side.items.filter(i => i.key !== side.current).reduce((t, i) => t + (i.badge || 0), 0);
    $('#menuBadge').hidden = !waiting; $('#menuBadge').textContent = waiting;
    const sc = $('#finScroll'), top = sc ? sc.scrollTop : 0;
    view.innerHTML = FIN.view();
    const sc2 = $('#finScroll'); if (sc2) sc2.scrollTop = top;
    document.title = 'Finance · ' + (cur.label || '');
  }

  // the sidebar: every section, and Sign out at the bottom. It slides in over the page from the left.
  function setMenu(open) {
    document.body.classList.toggle('menu-on', open);
    $('#scrim').hidden = !open;
    $('#side').setAttribute('aria-hidden', String(!open));
    $('#menuBtn').setAttribute('aria-expanded', String(open));
  }
  $('#menuBtn').onclick = () => setMenu(!document.body.classList.contains('menu-on'));
  $('#scrim').onclick = () => setMenu(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-on')) setMenu(false); });

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
    if (act.startsWith('fin-')) { e.preventDefault(); if (act === 'fin-sub') setMenu(false); FIN.act(act, b, e); }
  });
  $('#addBtn').onclick = () => { if (FIN && S.user) FIN.add(); };
  $('#signOut').onclick = () => { setMenu(false); sb.auth.signOut(); };

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
