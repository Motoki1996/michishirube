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

  M.storage = { getAll, save, remove, uniqueName };
})();
