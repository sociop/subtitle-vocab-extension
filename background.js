const DEFAULTS = {
  deeplApiKey: "",
  deeplHost: "https://api-free.deepl.com", // поменяй на https://api.deepl.com если у тебя платный ключ
  targetLang: "RU",
  ankiConnectUrl: "http://localhost:8765",
  deckName: "Subtitles",
  modelName: "Basic",
};

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function translateText(text) {
  const settings = await getSettings();
  if (!settings.deeplApiKey) {
    return { ok: false, error: "DeepL API ключ не задан. Открой настройки расширения." };
  }

  try {
    const resp = await fetch(`${settings.deeplHost}/v2/translate`, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${settings.deeplApiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        text,
        target_lang: settings.targetLang,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { ok: false, error: `DeepL ошибка ${resp.status}: ${errText}` };
    }

    const data = await resp.json();
    const translation = data.translations?.[0]?.text ?? "";
    return { ok: true, translation };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function ankiRequest(ankiConnectUrl, action, params) {
  const resp = await fetch(ankiConnectUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });
  return resp.json();
}

async function getModelFields(ankiConnectUrl, modelName) {
  const data = await ankiRequest(ankiConnectUrl, "modelFieldNames", { modelName });
  if (data.error) {
    throw new Error(`Не удалось получить поля модели "${modelName}": ${data.error}`);
  }
  return data.result;
}

function escapeAnkiQueryValue(value) {
  return value.replace(/"/g, '\\"');
}

async function findExistingNoteIds(ankiConnectUrl, deckName, fieldName, value) {
  const query = `deck:"${escapeAnkiQueryValue(deckName)}" "${fieldName}:${escapeAnkiQueryValue(value)}"`;
  const data = await ankiRequest(ankiConnectUrl, "findNotes", { query });
  if (data.error) {
    throw new Error(`Не удалось проверить дубликаты: ${data.error}`);
  }
  return data.result;
}

async function addToAnki(payload) {
  const settings = await getSettings();
  const { word, wordTranslation, phrase, phraseTranslation } = payload;

  let fieldNames;
  try {
    fieldNames = await getModelFields(settings.ankiConnectUrl, settings.modelName);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }

  if (!fieldNames || fieldNames.length < 2) {
    return {
      ok: false,
      error: `Модель "${settings.modelName}" должна иметь минимум 2 поля.`,
    };
  }

  try {
    const existingIds = await findExistingNoteIds(
      settings.ankiConnectUrl,
      settings.deckName,
      fieldNames[0],
      word
    );
    if (existingIds.length > 0) {
      return { ok: true, duplicate: true };
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }

  const fields = {
    [fieldNames[0]]: word,
    [fieldNames[1]]: `${wordTranslation}<br><br><i>${phrase}</i><br>${phraseTranslation}`,
  };

  const note = {
    deckName: settings.deckName,
    modelName: settings.modelName,
    fields,
    tags: ["subtitles"],
  };

  try {
    const data = await ankiRequest(settings.ankiConnectUrl, "addNote", { note });
    if (data.error) {
      return { ok: false, error: data.error };
    }
    return { ok: true, noteId: data.result };
  } catch (err) {
    return {
      ok: false,
      error: `Не удалось связаться с AnkiConnect (${err}). Убедись, что Anki открыт.`,
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "translate") {
    translateText(message.text).then(sendResponse);
    return true; // keep channel open for async response
  }
  if (message.type === "addToAnki") {
    addToAnki(message.payload).then(sendResponse);
    return true;
  }
});
