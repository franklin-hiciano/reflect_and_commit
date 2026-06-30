// ── Intro video overlay (opened manually via help icon) ──────────────────────────
const _INTRO_VIDEO_SRC = "https://www.loom.com/embed/bcfda84165f842fe92784ad2025bf8e2";

window._dismissIntroVideo = function () {
  const ov = document.getElementById("introVideoOv");
  if (ov) ov.classList.remove("on");
  // pause/unload video when closed
  const fr = document.getElementById("introVideoFrame");
  if (fr) fr.src = "";
};

window._openIntroVideo = function () {
  const ov = document.getElementById("introVideoOv");
  if (!ov) return;
  const ph = document.getElementById("introVideoPh");
  const fr = document.getElementById("introVideoFrame");
  if (ph) ph.style.display = "none";
  if (fr) {
    fr.src = _INTRO_VIDEO_SRC;
    fr.style.display = "";
  }
  ov.classList.add("on");
};

// No-op stubs kept for any callers that may reference these
window._maybeShowIntroVideo = function () {};
window._maybeShowCompoundCard = function () {};
window._dismissCompoundCard = function () {};
