// service worker: content script からのツアー保存要求を受け付ける。
// 保存先（chrome.storage.local）への書き込みをここに集約し、保存前に必ずスキーマ検証する。
importScripts('../lib/schema.js', '../lib/storage.js');

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
  return false;
});
