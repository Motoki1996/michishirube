// content script のエントリ。popup から executeScript で呼び出される。
// 作成・記録・再生モードは同時に1つだけ動かす。
(function () {
  'use strict';

  const M = globalThis.Michishirube;
  let current = null;
  let playing = false; // current が再生モードか

  function stop() {
    if (current) {
      current.destroy();
      current = null;
    }
    playing = false;
  }

  function startPlay(tour, opts) {
    stop();
    playing = true;
    current = M.player.start(tour, { ...opts, onExit: () => { current = null; playing = false; } });
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
    // 見て再生（ページ操作は止めて、案内を読み進める）
    play(tour) {
      startPlay(tour, { interactive: false });
    },
    // 操作して再生（ページを実際に操作して進める）
    playInteractive(tour) {
      startPlay(tour, { interactive: true });
    },
    // ページ遷移などで中断された再生を、保存された手順から続ける。playback: { tour, index, interactive }
    resumePlay(playback) {
      startPlay(playback.tour, { interactive: Boolean(playback.interactive), startIndex: playback.index });
    },
    // 再生中か（戻る/進むでページがキャッシュから復元された場合などに、二重に再生を始めないため）
    isPlaying: () => playing,
    stop,
  };
})();
