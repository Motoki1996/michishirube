// content script のエントリ。popup から executeScript で呼び出される。
// 作成モードと再生モードは同時に1つだけ動かす。
(function () {
  'use strict';

  const M = globalThis.Michishirube;
  let current = null;

  function stop() {
    if (current) {
      current.destroy();
      current = null;
    }
  }

  window.__michishirube = {
    startCreate(tour) {
      stop();
      current = M.creator.start(tour || null, { onExit: () => { current = null; } });
    },
    play(tour) {
      stop();
      current = M.player.start(tour, { onExit: () => { current = null; } });
    },
    stop,
  };
})();
