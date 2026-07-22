const FIELDS = ["deeplApiKey", "deeplHost", "deckName", "modelName"];

const DEFAULTS = {
  deeplApiKey: "",
  deeplHost: "https://api-free.deepl.com",
  deckName: "Subtitles",
  modelName: "Basic",
};

function load() {
  chrome.storage.local.get(FIELDS, (stored) => {
    const settings = { ...DEFAULTS, ...stored };
    FIELDS.forEach((key) => {
      document.getElementById(key).value = settings[key];
    });
  });
}

function save() {
  const settings = {};
  FIELDS.forEach((key) => {
    settings[key] = document.getElementById(key).value.trim();
  });

  chrome.storage.local.set(settings, () => {
    const statusEl = document.getElementById("status");
    statusEl.textContent = "Сохранено ✓";
    setTimeout(() => (statusEl.textContent = ""), 1500);
  });
}

document.addEventListener("DOMContentLoaded", load);
document.getElementById("save").addEventListener("click", save);
