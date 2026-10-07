// タブへの content script の注入と、ページをまたぐ再生に必要なサイト権限。
// popup / service worker から使う。
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});

  // 注入する content script（この順で読み込む）
  const CONTENT_FILES = [
    'lib/schema.js',
    'lib/locator.js',
    'content/overlay.js',
    'content/creator.js',
    'content/player.js',
    'content/recorder.js',
    'content/main.js',
  ];

  // content script を注入する。
  // 拡張機能の更新後もタブには古いコードが残るため、注入済みかどうかでは判定せず毎回注入し直す。
  // （先に動作中のモードを止めて、古い画面が残らないようにする）
  async function inject(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__michishirube && typeof window.__michishirube.stop === 'function') {
          window.__michishirube.stop();
        }
      },
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  }

  // URLのオリジン（file: は 'file:'）。読めなければ null
  function originOf(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'file:' ? 'file:' : u.origin;
    } catch (_) {
      return null;
    }
  }

  // ツアーの手順が使うオリジンの一覧
  function tourOrigins(tour) {
    return [...new Set(tour.steps.map((s) => originOf(s.url)).filter(Boolean))];
  }

  // ハッシュ(#...)を除いて、2つ以上のページにまたがるツアーか
  function spansPages(tour) {
    const pages = new Set(
      tour.steps.map((s) => {
        try {
          const u = new URL(s.url);
          return u.origin + u.pathname + u.search;
        } catch (_) {
          return s.url;
        }
      })
    );
    return pages.size > 1;
  }

  // オリジン → 権限のマッチパターン（ポートはマッチパターンに書けないので、ホスト単位になる）
  function originPatterns(tour) {
    return tourOrigins(tour).map((o) => (o === 'file:' ? 'file:///*' : `${o.replace(/:\d+$/, '')}/*`));
  }

  M.inject = { CONTENT_FILES, inject, originOf, tourOrigins, spansPages, originPatterns };
})();
