// chrome.storage.local へのツアー保存。popup / service worker から使う。
// ツアーは name をキーとして一意になる（同名は上書きか別名保存を選ぶ）。
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});
  const KEY = 'tours';

  async function getAll() {
    const data = await chrome.storage.local.get(KEY);
    return Array.isArray(data[KEY]) ? data[KEY] : [];
  }

  async function setAll(tours) {
    await chrome.storage.local.set({ [KEY]: tours });
  }

  // 「名前 (2)」「名前 (3)」… の形で、未使用の名前を返す
  function uniqueName(name, tours) {
    const names = new Set(tours.map((t) => t.name));
    if (!names.has(name)) return name;
    let n = 2;
    while (names.has(`${name} (${n})`)) n++;
    return `${name} (${n})`;
  }

  // 保存する。
  //   overwrite    : 同名ツアーがあっても上書きする
  //   originalName : 編集中のツアーの元の名前（名前変更時に古い方を消す）
  // 同名があり上書き指定がない場合は { ok:false, conflict:true, suggestedName } を返す
  async function save(tour, { overwrite = false, originalName = null } = {}) {
    const tours = await getAll();
    const isRename = originalName !== null && originalName !== tour.name;
    const sameNameIdx = tours.findIndex((t) => t.name === tour.name);
    const editingSameName = originalName === tour.name;

    if (sameNameIdx >= 0 && !overwrite && !editingSameName) {
      return { ok: false, conflict: true, suggestedName: uniqueName(tour.name, tours) };
    }

    let next = tours;
    if (isRename) next = next.filter((t) => t.name !== originalName);
    const idx = next.findIndex((t) => t.name === tour.name);
    if (idx >= 0) next[idx] = tour;
    else next.push(tour);
    await setAll(next);
    return { ok: true };
  }

  async function remove(name) {
    const tours = await getAll();
    await setAll(tours.filter((t) => t.name !== name));
  }

  // 記録の下書き（ページ遷移などで記録が中断されても失われないようにする）
  async function getDraft() {
    const data = await chrome.storage.local.get('draft');
    return data.draft && Array.isArray(data.draft.steps) ? data.draft : null;
  }
  async function setDraft(draft) {
    await chrome.storage.local.set({ draft });
  }
  async function clearDraft() {
    await chrome.storage.local.remove('draft');
  }

  // 再生中の位置（タブごと）。ブラウザを閉じれば消えてよいので chrome.storage.session に置く。
  // session はページ側（content script）からは読めない設定のまま使う
  const playbackKey = (tabId) => `playback:${tabId}`;
  async function getPlayback(tabId) {
    const key = playbackKey(tabId);
    const data = await chrome.storage.session.get(key);
    const p = data[key];
    return p && p.tour && Array.isArray(p.tour.steps) ? p : null;
  }
  async function setPlayback(tabId, playback) {
    await chrome.storage.session.set({ [playbackKey(tabId)]: playback });
  }
  async function clearPlayback(tabId) {
    await chrome.storage.session.remove(playbackKey(tabId));
  }

  M.storage = {
    getAll, save, remove, uniqueName, getDraft, setDraft, clearDraft,
    getPlayback, setPlayback, clearPlayback,
  };
})();
