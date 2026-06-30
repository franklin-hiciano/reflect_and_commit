// ── PWA install / habit prompt ─────────────────────────────────────────────────
// Shows after first reflection, keeps showing on load until installed or
// permanently dismissed. FAB in bottom-right opens it manually at any time.
//
// Variants:
//  Desktop Chrome/Edge  → install as desktop app (dock/taskbar)
//  Desktop Safari/FF    → QR code + "use Chrome/Edge for desktop"
//  Mobile Android       → Add to Home Screen (beforeinstallprompt)
//  Mobile iOS Safari    → step-by-step instructions

const _isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const _isMobile = () => /iphone|ipad|ipod|android/i.test(navigator.userAgent);
const _isIOS    = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const _isIOSSafari = () =>
  _isIOS() && /safari/i.test(navigator.userAgent) && !/crios|fxios|opios/i.test(navigator.userAgent);

// localStorage keys
const _KEY_PERM     = 'pwa_perm_dismissed';   // never show again
const _KEY_TRIGGERED = 'pwa_triggered';        // first reflection done, start prompting

let _deferredPrompt = null;

// Capture Android/desktop Chrome-Edge install prompt
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPrompt = e;
});

// ── Public API ────────────────────────────────────────────────────────────────

// Called by FAB — always shows (no "do not ask again" side-effect)
window.openPwaSheet = function () { _show(true); };

// Called by "not now" — hides sheet, will show again next visit
window.closePwaSheet = function () {
  document.getElementById('pwaSheet').style.display = 'none';
};

// Called by "don't ask again" — hides sheet and FAB forever
window.dismissPwaSheet = function () {
  localStorage.setItem(_KEY_PERM, '1');
  document.getElementById('pwaSheet').style.display = 'none';
  _hideFab();
};

window.triggerPwaInstall = async function () {
  if (!_deferredPrompt) return;
  _deferredPrompt.prompt();
  const { outcome } = await _deferredPrompt.userChoice;
  _deferredPrompt = null;
  if (outcome === 'accepted') {
    localStorage.setItem(_KEY_PERM, '1');
    document.getElementById('pwaSheet').style.display = 'none';
    _hideFab();
  }
};

// ── Internal ──────────────────────────────────────────────────────────────────

function _hideFab() {
  const fab = document.getElementById('pwaFab');
  if (fab) fab.style.display = 'none';
}

function _showFab() {
  if (_isStandalone()) return;
  if (localStorage.getItem(_KEY_PERM)) return;
  const fab = document.getElementById('pwaFab');
  if (fab) fab.style.display = 'flex';
}

function _show(manual = false) {
  if (_isStandalone()) return;

  // Permanently dismissed — never show the auto prompt; FAB still works
  // but if manually opened after perm dismiss, still respect it
  if (!manual && localStorage.getItem(_KEY_PERM)) return;

  const sheet  = document.getElementById('pwaSheet');
  const ids    = ['pwaDesktopInstall','pwaDesktopQR','pwaAndroid','pwaIOS'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

  let variantId;

  if (!_isMobile()) {
    // Desktop
    if (_deferredPrompt) {
      variantId = 'pwaDesktopInstall';
    } else {
      // QR code
      const url = location.origin + location.pathname;
      const qr  = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=10&color=e2e0d9&bgcolor=131313&data=${encodeURIComponent(url)}`;
      const img = document.getElementById('pwaQrImg');
      const urlEl = document.getElementById('pwaUrl');
      if (img) img.src = qr;
      if (urlEl) urlEl.textContent = url.replace(/^https?:\/\//, '');
      variantId = 'pwaDesktopQR';
    }
  } else if (_isIOSSafari()) {
    variantId = 'pwaIOS';
  } else if (_deferredPrompt) {
    variantId = 'pwaAndroid';
  } else {
    return; // Android but prompt not ready
  }

  const el = document.getElementById(variantId);
  if (el) el.style.display = '';
  if (sheet) sheet.style.display = 'flex';
}

// ── Trigger: after first reflection ──────────────────────────────────────────

window.addEventListener('load', () => {
  // Show FAB if habit prompt has been triggered
  if (localStorage.getItem(_KEY_TRIGGERED) && !localStorage.getItem(_KEY_PERM)) {
    _showFab();
    // Also re-show the sheet on every load until permanently dismissed
    setTimeout(() => _show(false), 1000);
  }

  // Wrap finishReflection to set the trigger on first completion
  const _orig = window.finishReflection;
  if (typeof _orig === 'function') {
    window.finishReflection = function () {
      _orig.apply(this, arguments);
      if (!localStorage.getItem(_KEY_TRIGGERED)) {
        localStorage.setItem(_KEY_TRIGGERED, '1');
        _showFab();
        setTimeout(() => _show(false), 700);
      }
    };
  }
});

// ── Auto-show help tooltip for first-time visitors ───────────────────────────

window.addEventListener('load', () => {
  if (localStorage.getItem('tooltip_seen')) return;
  const wrap = document.getElementById('helpIconBtn')?.closest('.help-icon-wrap');
  if (!wrap) return;
  wrap.classList.add('tooltip-show');
  const hide = () => {
    wrap.classList.remove('tooltip-show');
    localStorage.setItem('tooltip_seen', '1');
  };
  const timer = setTimeout(hide, 5000);
  document.getElementById('helpIconBtn')?.addEventListener('click', () => {
    clearTimeout(timer); hide();
  }, { once: true });
});
