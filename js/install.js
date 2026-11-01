// The game only runs as an installed app (PWA). Opened in a browser tab, it
// shows an install screen instead of the title. `?debug` skips the gate.

const $ = (s) => document.querySelector(s);
const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const isFirefox = /Firefox|FxiOS/.test(ua);
const isSamsung = /SamsungBrowser/.test(ua);

// Chrome fires this event when the game can be installed; keep it so the
// install button can open the browser's own prompt later.
let promptEvent = null;
let installed = false;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptEvent = e;
  render();
});
addEventListener('appinstalled', () => {
  installed = true;
  promptEvent = null;
  render();
});

export function isApp() {
  return matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)').matches
    || navigator.standalone === true;
}

export const gateActive = () => !isApp() && !new URLSearchParams(location.search).has('debug');

// What to say when the browser gives us no install prompt to open.
function manualSteps() {
  if (isIOS) return 'Sur iPhone ou iPad : touche <b>Partager</b> <span class="ico">⬆️</span> puis <b>« Sur l\'écran d\'accueil »</b>.';
  if (isSamsung) return 'Ouvre le menu <b>☰</b> puis <b>« Ajouter la page à » → « Écran d\'accueil »</b>.';
  if (isFirefox && isAndroid) return 'Ouvre le menu <b>⋮</b> puis <b>« Installer »</b>.';
  if (isFirefox) return 'Firefox sur ordinateur ne sait pas installer d\'application : ouvre le jeu dans <b>Chrome</b> ou <b>Edge</b>.';
  if (isAndroid) return 'Ouvre le menu <b>⋮</b> du navigateur puis <b>« Installer l\'application »</b> ou <b>« Ajouter à l\'écran d\'accueil »</b>.';
  return 'Clique sur l\'icône d\'installation <b>⊕</b> à droite de la barre d\'adresse, ou menu <b>⋮</b> → <b>« Installer CodeBattle »</b>.';
}

function render() {
  const btn = $('#btn-install');
  const text = $('#install-text');
  const help = $('#install-help');
  if (!btn) return;
  if (installed) {
    text.innerHTML = 'C\'est installé ! 🎉 Ouvre <b>CodeBattle</b> depuis ton écran d\'accueil ou tes applications pour jouer.';
    btn.classList.add('hidden');
    help.innerHTML = '';
    return;
  }
  // iOS has no install prompt at all: the steps replace the button
  btn.classList.toggle('hidden', isIOS);
  help.innerHTML = promptEvent
    ? 'Déjà installé ? Ouvre <b>CodeBattle</b> depuis ton écran d\'accueil.'
    : `${manualSteps()}<br><span class="install-small">Déjà installé ? Ouvre <b>CodeBattle</b> depuis ton écran d'accueil.</span>`;
}

export async function install() {
  if (!promptEvent) {
    // no prompt available (yet): point at the browser's own menu
    $('#install-help').classList.remove('flash');
    void $('#install-help').offsetWidth;
    $('#install-help').classList.add('flash');
    return;
  }
  promptEvent.prompt();
  const { outcome } = await promptEvent.userChoice;
  if (outcome === 'accepted') installed = true;
  else promptEvent = null; // Chrome only lets the prompt be used once
  render();
}

export function initGate() {
  render();
}
