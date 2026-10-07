// 記録モード: ページを普通に操作するだけで、クリックや入力が手順として自動記録される。
//   comment: true  → 1操作ごとにコメント欄を出す（任意で入力）
//   comment: false → コメントなしで、操作だけをすばやく記録する
// ページ本来の動作は止めない。入力した「値」は記録しない（どの要素を操作したかだけ記録する）。
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});
  const { h } = M;

  const TEXT_LIKE_INPUT = ['text', 'search', 'email', 'tel', 'url', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range'];
  const NO_CHANGE_INPUT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'image'];

  // opts: { comment, steps（再開時の既存手順）, onExit, onEdit(tour) }
  function start(opts) {
    const layer = M.createLayer();
    const root = layer.root;

    const state = {
      comment: Boolean(opts.comment),
      steps: opts.steps ? JSON.parse(JSON.stringify(opts.steps)) : [],
      phase: 'recording', // recording → finish → saved
      name: M.schema.defaultTourName(),
      side: 'right',
      savedTour: null,
      message: '',
    };

    let lastEl = null;
    let lastKind = '';
    let lastAt = 0;
    let draftTimer = 0;

    const flashBox = h('div', { class: 'hl selected' });
    const panelHost = h('div');
    root.append(flashBox, panelHost);

    // ---------- 下書き（ページ遷移で中断されても残す） ----------
    async function send(msg) {
      try {
        return await chrome.runtime.sendMessage(msg);
      } catch (_) {
        return null; // 拡張機能が再読み込みされた場合など。記録自体は続ける
      }
    }
    function persistDraft() {
      return send({ type: 'michishirube:draft-save', steps: state.steps, comment: state.comment });
    }
    function persistDraftSoon() {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(persistDraft, 500);
    }

    // ---------- 記録 ----------
    // 記録した要素を一瞬だけ枠で光らせて、記録されたことを伝える
    function flash(el) {
      const r = el.getBoundingClientRect();
      Object.assign(flashBox.style, {
        display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`,
        width: `${r.width + 4}px`, height: `${r.height + 4}px`,
      });
      setTimeout(() => { flashBox.style.display = 'none'; }, 600);
    }

    function record(el, kind) {
      // ラベルのクリックで続けて発火する、同じ要素へのクリックは重複とみなす
      if (kind === 'input' && el === lastEl && lastKind === 'input') return;
      if (el === lastEl && Date.now() - lastAt < 400) return;

      // 色などが変わる前に要素の情報を作る
      const step = {
        url: location.href,
        title: M.locator.describeAction(el, kind),
        body: '',
        target: M.locator.capture(el),
      };
      state.steps.push(step);
      lastEl = el;
      lastKind = kind;
      lastAt = Date.now();
      flash(el);
      persistDraft();
      render();
    }

    function realTarget(e) {
      const t = e.composedPath()[0];
      return t instanceof Element ? t : null;
    }

    function onClick(e) {
      if (state.phase !== 'recording' || !e.isTrusted || layer.contains(e)) return;
      const raw = realTarget(e);
      if (!raw) return;
      let el = M.locator.pickTarget(raw);
      if (el.tagName === 'LABEL' && el.control) el = el.control; // ラベル経由の操作は部品本体の操作として記録
      const type = el.tagName === 'INPUT' ? el.type : '';
      // 入力欄・選択ボックスは、クリックではなく値の変更（change）で記録する
      if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      if (el.tagName === 'INPUT' && !NO_CHANGE_INPUT.includes(type)) return;
      record(el, type === 'checkbox' || type === 'radio' ? 'toggle' : 'click');
    }

    function onChange(e) {
      if (state.phase !== 'recording' || layer.contains(e)) return;
      const el = realTarget(e);
      if (!el) return;
      if (el.tagName === 'SELECT') return record(el, 'select');
      if (el.tagName === 'TEXTAREA') return record(el, 'input');
      if (el.tagName === 'INPUT' && !NO_CHANGE_INPUT.includes(el.type)) {
        record(el, el.type === 'file' ? 'file' : 'input');
      }
    }

    // ---------- 停止・保存 ----------
    function undoLast() {
      state.steps.pop();
      lastEl = null;
      persistDraft();
      render();
    }

    async function stopRecording() {
      if (state.steps.length === 0) return quit();
      state.phase = 'finish';
      render();
    }

    async function save() {
      const name = state.name.trim();
      if (!name) {
        state.message = 'ツアー名を入力してください';
        return render();
      }
      const now = new Date().toISOString();
      const tour = { schemaVersion: 1, name, description: '', createdAt: now, updatedAt: now, steps: state.steps };
      let res = await send({ type: 'michishirube:save', tour });
      if (res && res.conflict) {
        // 同名がある場合は上書きせず、自動で別名にする
        tour.name = res.suggestedName;
        res = await send({ type: 'michishirube:save', tour });
      }
      if (!res || !res.ok) {
        state.message = `保存に失敗しました: ${(res && res.error) || 'ページを再読み込みしてやり直してください'}`;
        return render();
      }
      await send({ type: 'michishirube:draft-clear' });
      state.savedTour = tour;
      state.phase = 'saved';
      state.message = '';
      render();
    }

    async function discard() {
      const ok = await M.ask(layer, `記録した${state.steps.length}手順を破棄しますか？`, [
        { label: '破棄する', value: true, kind: 'danger' },
        { label: '戻る', value: false },
      ]);
      if (!ok) return;
      await send({ type: 'michishirube:draft-clear' });
      quit();
    }

    function quit() {
      destroy();
      if (opts.onExit) opts.onExit();
    }

    function editComments() {
      const tour = state.savedTour;
      destroy();
      if (opts.onEdit) opts.onEdit(tour);
    }

    // ---------- 描画 ----------
    function panel(children) {
      return h('div', { class: `panel ${state.side}` }, children);
    }

    function sideButton() {
      return h('button', {
        class: 'btn small', text: state.side === 'right' ? '← 左へ' : '右へ →', title: 'パネルの位置を切り替え',
        onclick: () => { state.side = state.side === 'right' ? 'left' : 'right'; render(); },
      });
    }

    function renderRecording() {
      const last = state.steps[state.steps.length - 1];
      const kids = [
        h('div', { class: 'panel-head' }, [
          h('strong', {}, [M.logo(), h('span', { class: 'dot' }), `記録中（${state.steps.length}手順）`]),
          sideButton(),
        ]),
        h('div', { class: 'hint', text: 'いつも通りページを操作してください。クリックや入力が自動で記録されます。' }),
      ];
      if (last) {
        kids.push(h('div', { class: 'last', text: `直前の手順: ${last.title}` }));
        if (state.comment) {
          // コメントは任意。入力内容は直前の手順にそのまま反映される
          kids.push(
            h('label', { class: 'lbl', text: 'タイトル（自動入力。変更できます）' }),
            h('input', {
              class: 'in', value: last.title, maxlength: 200,
              oninput: (e) => { last.title = e.target.value || '（無題）'; persistDraftSoon(); },
            }),
            h('label', { class: 'lbl', text: 'コメント（任意）' }),
            h('textarea', {
              class: 'in', value: last.body, maxlength: 5000, placeholder: 'ここに説明を書けます',
              oninput: (e) => { last.body = e.target.value; persistDraftSoon(); },
            })
          );
        }
      }
      kids.push(
        h('label', { class: 'chk' }, [
          h('input', {
            type: 'checkbox', checked: state.comment,
            onchange: (e) => { state.comment = e.target.checked; persistDraft(); render(); },
          }),
          '1操作ごとにコメント欄を出す',
        ]),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn primary', text: '停止して保存へ', onclick: stopRecording }),
          h('button', { class: 'btn', text: '直前を取り消し', disabled: !last, onclick: undoLast }),
        ])
      );
      return panel(kids);
    }

    function renderFinish() {
      return panel([
        h('div', { class: 'panel-head' }, [h('strong', {}, [M.logo(), `記録を保存（${state.steps.length}手順）`]), sideButton()]),
        h('label', { class: 'lbl', text: 'ツアー名' }),
        h('input', {
          class: 'in', value: state.name, maxlength: 100,
          oninput: (e) => { state.name = e.target.value; },
        }),
        h('div', { class: 'status error', text: state.message }),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn primary', text: '保存', onclick: save }),
          h('button', { class: 'btn', text: '続きを記録', onclick: () => { state.phase = 'recording'; render(); } }),
          h('button', { class: 'btn', text: '破棄', onclick: discard }),
        ]),
      ]);
    }

    function renderSaved() {
      const tour = state.savedTour;
      const status = h('div', { class: 'status ok', text: state.message });
      return panel([
        h('div', { class: 'panel-head' }, [h('strong', {}, [M.logo(), '保存しました'])]),
        h('div', { class: 'last', text: `「${tour.name}」（${tour.steps.length}手順）` }),
        h('div', { class: 'hint', text: '共有するには、JSONファイルを書き出すか、コピーして貼り付けてください。受け取る側はポップアップの「インポート」で取り込めます。' }),
        status,
        h('div', { class: 'row' }, [
          h('button', {
            class: 'btn primary', text: 'JSONを書き出し',
            onclick: () => { M.downloadTour(layer, tour); status.textContent = 'ダウンロードしました'; },
          }),
          h('button', {
            class: 'btn', text: 'JSONをコピー',
            onclick: async () => {
              const ok = await M.copyText(layer, JSON.stringify(tour, null, 2));
              status.textContent = ok ? 'コピーしました' : 'コピーできませんでした。書き出しを使ってください';
            },
          }),
        ]),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn', text: 'コメントを編集', onclick: editComments }),
          h('button', { class: 'btn', text: '閉じる', onclick: quit }),
        ]),
      ]);
    }

    function render() {
      panelHost.textContent = '';
      const view = state.phase === 'recording' ? renderRecording() : state.phase === 'finish' ? renderFinish() : renderSaved();
      panelHost.append(view);
    }

    // ---------- イベント登録（ページの動作は止めない） ----------
    window.addEventListener('click', onClick, true);
    window.addEventListener('change', onChange, true);

    function destroy() {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('change', onChange, true);
      clearTimeout(draftTimer);
      layer.destroy();
    }

    render();
    return { destroy };
  }

  M.recorder = { start };
})();
