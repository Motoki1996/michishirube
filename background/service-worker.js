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
  return false;
});
