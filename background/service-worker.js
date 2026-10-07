// service worker: content script からのツアー保存要求を受け付ける。
// また、再生中のタブでページが切り替わったら、遷移先のページで続きを自動で再生する。
// 保存先（chrome.storage.local）への書き込みをここに集約し、保存前に必ずスキーマ検証する。
importScripts('../lib/schema.js', '../lib/storage.js', '../lib/inject.js');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 自分自身の拡張機能からのメッセージだけ処理する
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'michishirube:save') {
    (async () => {
      const result = globalThis.Michishirube.schema.validateTour(msg.tour);
      if (!result.ok) {
        sendResponse({ ok: false, error: result.errors.join('\n') });
        return;
      }
      const res = await globalThis.Michishirube.storage.save(result.tour, {
        overwrite: msg.overwrite === true,
        originalName: typeof msg.originalName === 'string' ? msg.originalName : null,
      });
      sendResponse(res);
    })().catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // 非同期で応答する
  }

  // 記録中の下書きを保存する（手順だけをスキーマ検証して保存）
  if (msg.type === 'michishirube:draft-save') {
    (async () => {
      const probe = globalThis.Michishirube.schema.validateTour({
        schemaVersion: 1, name: 'draft', steps: msg.steps,
      });
      if (!probe.ok) {
        sendResponse({ ok: false, error: probe.errors.join('\n') });
        return;
      }
      await globalThis.Michishirube.storage.setDraft({
        steps: probe.tour.steps,
        comment: msg.comment === true,
        updatedAt: new Date().toISOString(),
      });
      sendResponse({ ok: true });
    })().catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }

  if (msg.type === 'michishirube:draft-clear') {
    globalThis.Michishirube.storage.clearDraft()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }

  // 再生中の位置を保存する（ページが切り替わっても、ポップアップから続きを再生できるようにする）
  if (msg.type === 'michishirube:playback-save') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId === undefined) return false;
    (async () => {
      const result = globalThis.Michishirube.schema.validateTour(msg.tour);
      const index = msg.index;
      if (!result.ok || !Number.isInteger(index) || index < 0 || index >= result.tour.steps.length) {
        sendResponse({ ok: false, error: '再生位置が正しくありません' });
        return;
      }
      await globalThis.Michishirube.storage.setPlayback(tabId, {
        tour: result.tour,
        index,
        interactive: msg.interactive === true,
        updatedAt: new Date().toISOString(),
      });
      sendResponse({ ok: true });
    })().catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }

  if (msg.type === 'michishirube:playback-clear') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId === undefined) return false;
    globalThis.Michishirube.storage.clearPlayback(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  return false;
});

// タブを閉じたら、そのタブの再生位置を消す
chrome.tabs.onRemoved.addListener((tabId) => {
  globalThis.Michishirube.storage.clearPlayback(tabId).catch(() => {});
});

// ---------- ページをまたぐ再生: 遷移先のページで続きを自動で再生する ----------
// サイトへのアクセス許可（ポップアップで再生を始めるときに求める）がある場合だけ動く。
// 許可がなければ tab.url が読めず（tabs 権限は持たない）注入もできないので、従来どおりポップアップの「続きを再生」で続ける
const resuming = new Set(); // 注入中のタブ（読み込み完了の通知が続けて来ても二重に始めない）

async function autoResume(tabId, url) {
  const { storage, inject } = globalThis.Michishirube;
  const playback = await storage.getPlayback(tabId);
  if (!playback) return;
  // ツアーで使うサイトのページでだけ再開する（SSOなどで別サイトを経由している間は待つ）
  if (!inject.tourOrigins(playback.tour).includes(inject.originOf(url))) return;

  // SPAのURL変更や、戻る/進むでキャッシュから復元されたページでは、再生がまだ動いている
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(window.__michishirube && window.__michishirube.isPlaying && window.__michishirube.isPlaying()),
  });
  if (probe && probe.result) return;

  await inject.inject(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (p) => window.__michishirube.resumePlay(p),
    args: [playback],
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url || resuming.has(tabId)) return;
  resuming.add(tabId);
  autoResume(tabId, tab.url)
    .catch(() => {}) // 注入できないページ（chrome:// など）。ポップアップから続けられる
    .finally(() => resuming.delete(tabId));
});
