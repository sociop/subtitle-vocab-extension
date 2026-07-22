// ==== Конфигурация ====
const CONFIG = {
  captionSelector: ".allplay_caption, .allplay__caption, #pjs_player_subtitle",
  hotkey: { ctrlKey: true, shiftKey: true, code: "KeyX" },
  pollIntervalMs: 250,
};

// ==== Состояние ====
let lastCaptionText = "";
let popupEl = null;

// ==== Слежение за субтитрами ====
function extractCaptionText(el) {
  // innerText учитывает визуальные переносы строк (например, между
  // несколькими <i>-строками субтитров), в отличие от textContent,
  // который склеивает их без пробела.
  const raw = el.innerText || el.textContent || "";
  return raw.replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
}

function watchCaptions() {
  setInterval(() => {
    const el = document.querySelector(CONFIG.captionSelector);
    if (el) {
      const text = extractCaptionText(el);
      if (text) lastCaptionText = text;
    }
  }, CONFIG.pollIntervalMs);

  console.log("[Subtitle Vocab Catcher] Наблюдение за субтитрами запущено.");
}

// ==== Управление видео ====
function getVideoEl() {
  return document.querySelector("video");
}

function pauseVideo() {
  const video = getVideoEl();
  if (video && !video.paused) video.pause();
}

function playVideo() {
  const video = getVideoEl();
  if (video && video.paused) video.play();
}

// ==== Хоткей ====
function isHotkeyMatch(e) {
  return (
    e.ctrlKey === CONFIG.hotkey.ctrlKey &&
    e.shiftKey === CONFIG.hotkey.shiftKey &&
    e.code === CONFIG.hotkey.code
  );
}

document.addEventListener("keydown", (e) => {
  if (isHotkeyMatch(e)) {
    e.preventDefault();
    e.stopPropagation();
    if (popupEl) {
      closePopup();
      return;
    }
    if (!lastCaptionText) return;
    pauseVideo();
    openPopupWithPhrase(lastCaptionText);
  }
  if (e.code === "Escape" && popupEl) {
    closePopup();
  }
}, true);

// ==== Попап ====
function getMountTarget() {
  return document.fullscreenElement || document.body;
}

document.addEventListener("fullscreenchange", () => {
  if (popupEl) getMountTarget().appendChild(popupEl);
});

function openPopupWithPhrase(phrase) {
  popupEl = buildPopupSkeleton(phrase);
  getMountTarget().appendChild(popupEl);

  chrome.storage.local.get("popupPosition").then(({ popupPosition }) => {
    if (popupPosition && popupEl) applyPopupPosition(popupEl, clampToViewport(popupEl, popupPosition));
  });

  requestPhraseTranslation(phrase).then((translation) => {
    const translationEl = popupEl.querySelector(".svc-phrase-translation");
    if (translationEl) translationEl.textContent = translation;
  });
}

function applyPopupPosition(el, { left, top }) {
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.bottom = "auto";
  el.style.transform = "none";
}

function clampToViewport(el, { left, top }) {
  const rect = el.getBoundingClientRect();
  const maxLeft = Math.max(window.innerWidth - rect.width, 0);
  const maxTop = Math.max(window.innerHeight - rect.height, 0);
  return {
    left: Math.min(Math.max(left, 0), maxLeft),
    top: Math.min(Math.max(top, 0), maxTop),
  };
}

const NON_DRAGGABLE_SELECTOR = ".svc-word, .svc-close-btn, .svc-add-btn";

function setupDrag(container) {
  let startX, startY, startLeft, startTop;

  function onMouseMove(e) {
    const left = startLeft + (e.clientX - startX);
    const top = startTop + (e.clientY - startY);
    applyPopupPosition(container, clampToViewport(container, { left, top }));
  }

  function onMouseUp() {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    const rect = container.getBoundingClientRect();
    chrome.storage.local.set({ popupPosition: { left: rect.left, top: rect.top } });
  }

  container.addEventListener("mousedown", (e) => {
    if (e.target.closest(NON_DRAGGABLE_SELECTOR)) return;
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

function buildPopupSkeleton(phrase) {
  const container = document.createElement("div");
  container.className = "svc-popup";

  setupDrag(container);

  const closeBtn = document.createElement("button");
  closeBtn.className = "svc-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closePopup);
  container.appendChild(closeBtn);

  const phraseEl = document.createElement("div");
  phraseEl.className = "svc-phrase-original";
  phrase.split(/(\s+)/).forEach((token) => {
    if (token.trim() === "") {
      phraseEl.appendChild(document.createTextNode(token));
      return;
    }
    const span = document.createElement("span");
    span.className = "svc-word";
    span.textContent = token;
    span.addEventListener("click", () => onWordClick(token, phrase, span));
    phraseEl.appendChild(span);
  });
  container.appendChild(phraseEl);

  const translationEl = document.createElement("div");
  translationEl.className = "svc-phrase-translation";
  translationEl.textContent = "Перевожу...";
  container.appendChild(translationEl);

  const wordDetailEl = document.createElement("div");
  wordDetailEl.className = "svc-word-detail";
  wordDetailEl.style.display = "none";
  container.appendChild(wordDetailEl);

  return container;
}

function closePopup() {
  if (popupEl) {
    popupEl.remove();
    popupEl = null;
  }
  playVideo();
}

// ==== Клик по слову ====
function onWordClick(rawWord, fullPhrase, spanEl) {
  const normalized = rawWord.replace(/[‘’ʼ]/g, "'");
  const cleanWord = normalized.replace(/[^\p{L}'-]/gu, "").replace(/^-+|-+$/g, "");
  if (!cleanWord) return;

  popupEl.querySelectorAll(".svc-word").forEach((w) => w.classList.remove("svc-word-active"));
  spanEl.classList.add("svc-word-active");

  const detailEl = popupEl.querySelector(".svc-word-detail");
  detailEl.style.display = "block";
  detailEl.innerHTML = `<div class="svc-loading">Перевожу «${cleanWord}»...</div>`;

  requestWordTranslation(cleanWord).then((wordTranslation) => {
    const phraseTranslation =
      popupEl.querySelector(".svc-phrase-translation")?.textContent || "";

    detailEl.innerHTML = "";

    const wordLine = document.createElement("div");
    wordLine.className = "svc-word-line";
    wordLine.textContent = `${cleanWord} — ${wordTranslation}`;
    detailEl.appendChild(wordLine);

    const addBtn = document.createElement("button");
    addBtn.className = "svc-add-btn";
    addBtn.textContent = "+ Добавить в Anki";
    addBtn.addEventListener("click", () => {
      addBtn.disabled = true;
      addBtn.textContent = "Добавляю...";
      requestAddToAnki({
        word: cleanWord,
        wordTranslation,
        phrase: fullPhrase,
        phraseTranslation,
      }).then((result) => {
        if (result.ok) {
          addBtn.textContent = result.duplicate ? "Уже в колоде" : "✓ Добавлено";
        } else {
          addBtn.textContent = "Ошибка. Повторить?";
          addBtn.disabled = false;
        }
      });
    });
    detailEl.appendChild(addBtn);
  });
}

// ==== Сообщения к background.js ====
function requestPhraseTranslation(text) {
  return chrome.runtime
    .sendMessage({ type: "translate", text })
    .then((res) => (res && res.ok ? res.translation : "Ошибка перевода"));
}

function requestWordTranslation(word) {
  return chrome.runtime
    .sendMessage({ type: "translate", text: word })
    .then((res) => (res && res.ok ? res.translation : "Ошибка перевода"));
}

function requestAddToAnki(payload) {
  return chrome.runtime.sendMessage({ type: "addToAnki", payload });
}

// ==== Инициализация ====
if (document.body) {
  watchCaptions();
} else {
  document.addEventListener("DOMContentLoaded", watchCaptions);
}
