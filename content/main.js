// content script のエントリ。popup から executeScript で呼び出される。
// 作成・記録・再生モードは同時に1つだけ動かす。
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

  function startCreate(tour) {
    stop();
    current = M.creator.start(tour || null, { onExit: () => { current = null; } });
  }

  window.__michishirube = {
    startCreate,
    // 操作を記録する。opts: { comment: boolean, steps?: 再開時の既存手順 }
    startRecord(opts) {
      stop();
      current = M.recorder.start({
        comment: Boolean(opts && opts.comment),
        steps: opts && opts.steps,
        onExit: () => { current = null; },
        onEdit: (tour) => startCreate(tour), // 記録後に「コメントを編集」する場合は作成モードで開く
      });
    },
    play(tour) {
      stop();
      current = M.player.start(tour, { onExit: () => { current = null; } });
    },
    stop,
  };
})();
