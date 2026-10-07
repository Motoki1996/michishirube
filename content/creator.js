// 作成モード: 要素をクリックで選択 → タイトル/説明を入力 → 手順として追加 → ツアーとして保存。
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});
  const { h } = M;

  // 選択中は、ページ本来のクリック動作などを止める対象のイベント
  const BLOCKED_EVENTS = [
    'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick',
    'auxclick', 'contextmenu', 'submit', 'touchstart', 'touchend',
  ];

  // initial: 編集する既存ツアー（新規作成なら null）/ opts.onExit: 終了時のコールバック
  function start(initial, opts) {
    const layer = M.createLayer();
    const root = layer.root;

    const state = {
      name: initial ? initial.name : '',
      description: initial ? initial.description : '',
      createdAt: initial ? initial.createdAt : null,
      originalName: initial ? initial.name : null, // 名前変更・上書き判定用
      steps: initial ? JSON.parse(JSON.stringify(initial.steps)) : [],
      editingIndex: null, // 編集中の手順（新規追加なら null）
      pending: null, // { target, url }: 選択済みで未確定の要素
      selectedEl: null,
      draft: { title: '', body: '' },
      side: 'right',
      dirty: false,
      dialogOpen: false,
      focusTitle: false,
    };

    let hoverEl = null;
    let statusEl = null;
    const hoverBox = h('div', { class: 'hl hover' });
    const selectedBox = h('div', { class: 'hl selected' });
    const panelHost = h('div');
    root.append(hoverBox, selectedBox, panelHost);

    // ---------- 枠の表示 ----------
    function placeBox(box, el) {
      if (!el || !el.isConnected) {
        box.style.display = 'none';
        return;
      }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, {
        display: 'block',
        left: `${r.left - 2}px`,
        top: `${r.top - 2}px`,
        width: `${r.width + 4}px`,
        height: `${r.height + 4}px`,
      });
    }
    function refreshBoxes() {
      placeBox(hoverBox, hoverEl === state.selectedEl ? null : hoverEl);
      placeBox(selectedBox, state.selectedEl);
    }
    let raf = 0;
    function scheduleRefresh() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        refreshBoxes();
      });
    }

    // ---------- 状態表示 ----------
    function setStatus(text, kind) {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.className = `status ${kind || ''}`;
    }

    // ---------- 手順の操作 ----------
    function markDirty() {
      state.dirty = true;
    }

    function moveStep(i, delta) {
      const j = i + delta;
      if (j < 0 || j >= state.steps.length) return;
      [state.steps[i], state.steps[j]] = [state.steps[j], state.steps[i]];
      if (state.editingIndex === i) state.editingIndex = j;
      else if (state.editingIndex === j) state.editingIndex = i;
      markDirty();
      render();
    }

    function deleteStep(i) {
      state.steps.splice(i, 1);
      if (state.editingIndex === i) cancelForm();
      else if (state.editingIndex !== null && state.editingIndex > i) state.editingIndex--;
      markDirty();
      render();
    }

    function editStep(i) {
      const s = state.steps[i];
      state.editingIndex = i;
      state.pending = { target: s.target, url: s.url };
      state.draft = { title: s.title, body: s.body };
      state.selectedEl = M.locator.find(s.target);
      if (state.selectedEl) state.selectedEl.scrollIntoView({ block: 'center', inline: 'center' });
      state.focusTitle = true;
      render();
      refreshBoxes();
    }

    function cancelForm() {
      state.editingIndex = null;
      state.pending = null;
      state.selectedEl = null;
      state.draft = { title: '', body: '' };
      render();
      refreshBoxes();
    }

    function commitForm() {
      const title = state.draft.title.trim();
      if (!title) {
        setStatus('タイトルを入力してください', 'error');
        return;
      }
      const step = {
        url: state.pending.url,
        title,
        body: state.draft.body,
        target: state.pending.target,
      };
      if (state.editingIndex === null) state.steps.push(step);
      else state.steps[state.editingIndex] = step;
      markDirty();
      cancelForm();
      setStatus(`手順を保存しました（全${state.steps.length}手順）。続けて要素をクリックできます`, 'ok');
    }

    // ---------- 保存 ----------
    async function save(overwrite) {
      const name = state.name.trim();
      if (!name) return setStatus('ツアー名を入力してください', 'error');
      if (state.steps.length === 0) return setStatus('手順を1つ以上追加してください', 'error');

      const now = new Date().toISOString();
      const tour = {
        schemaVersion: 1,
        name,
        description: state.description.trim(),
        createdAt: state.createdAt || now,
        updatedAt: now,
        steps: state.steps,
      };

      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: 'michishirube:save',
          tour,
          originalName: state.originalName,
          overwrite: overwrite === true,
        });
      } catch (e) {
        return setStatus(`保存に失敗しました: ${e.message}（ページを再読み込みしてやり直してください）`, 'error');
      }
      if (!res) return setStatus('保存に失敗しました（応答がありません）', 'error');

      if (res.conflict) {
        state.dialogOpen = true;
        const choice = await M.ask(layer, `「${name}」という名前のツアーが既にあります。`, [
          { label: '上書き', value: 'overwrite', kind: 'danger' },
          { label: `別名で保存（${res.suggestedName}）`, value: 'rename' },
          { label: 'キャンセル', value: 'cancel' },
        ]);
        state.dialogOpen = false;
        if (choice === 'overwrite') return save(true);
        if (choice === 'rename') {
          state.name = res.suggestedName;
          render();
          return save(false);
        }
        return;
      }
      if (!res.ok) return setStatus(`保存に失敗しました: ${res.error || '不明なエラー'}`, 'error');

      state.originalName = name;
      state.createdAt = tour.createdAt;
      state.dirty = false;
      setStatus(`「${name}」を保存しました`, 'ok');
    }

    // ---------- 終了 ----------
    async function requestExit() {
      if (state.dialogOpen) return;
      if (state.dirty || state.pending) {
        state.dialogOpen = true;
        const ok = await M.ask(layer, '保存していない変更があります。作成モードを終了しますか？', [
          { label: '終了する', value: true, kind: 'danger' },
          { label: '続ける', value: false },
        ]);
        state.dialogOpen = false;
        if (!ok) return;
      }
      destroy();
      if (opts && opts.onExit) opts.onExit();
    }

    // ---------- 描画 ----------
    function render() {
      panelHost.textContent = '';

      const nameInput = h('input', {
        class: 'in', value: state.name, maxlength: 100, placeholder: '例：新規登録の流れ',
        oninput: (e) => { state.name = e.target.value; markDirty(); },
      });
      const descInput = h('input', {
        class: 'in', value: state.description, maxlength: 1000, placeholder: '任意',
        oninput: (e) => { state.description = e.target.value; markDirty(); },
      });

      const list = h(
        'ol',
        { class: 'steps' },
        state.steps.map((s, i) =>
          h('li', { class: `step${i === state.editingIndex ? ' active' : ''}` }, [
            h('span', { class: 'num', text: `${i + 1}.` }),
            h('span', { class: 't', text: s.title, title: s.title }),
            h('button', { class: 'btn small', text: '↑', title: '上へ', disabled: i === 0, onclick: () => moveStep(i, -1) }),
            h('button', { class: 'btn small', text: '↓', title: '下へ', disabled: i === state.steps.length - 1, onclick: () => moveStep(i, 1) }),
            h('button', { class: 'btn small', text: '編集', onclick: () => editStep(i) }),
            h('button', { class: 'btn small', text: '削除', onclick: () => deleteStep(i) }),
          ])
        )
      );

      let formArea;
      if (state.pending) {
        const t = state.pending.target;
        const label = `<${t.tag}>${t.text ? ` 「${t.text.slice(0, 20)}」` : ''}`;
        const titleInput = h('input', {
          class: 'in', value: state.draft.title, maxlength: 200, placeholder: '例：送信ボタンを押します',
          oninput: (e) => { state.draft.title = e.target.value; },
        });
        formArea = h('div', { class: 'form' }, [
          h('div', { class: 'target-desc', text: `選択中の要素: ${label}` }),
          h('div', { class: 'target-desc', text: '別の要素をクリックすると対象を変更できます' }),
          h('label', { class: 'lbl', text: 'タイトル' }),
          titleInput,
          h('label', { class: 'lbl', text: '説明文' }),
          h('textarea', {
            class: 'in', value: state.draft.body, maxlength: 5000,
            oninput: (e) => { state.draft.body = e.target.value; },
          }),
          h('div', { class: 'row' }, [
            h('button', {
              class: 'btn primary',
              text: state.editingIndex === null ? '手順を追加' : '手順を更新',
              onclick: commitForm,
            }),
            h('button', { class: 'btn', text: 'キャンセル', onclick: cancelForm }),
          ]),
        ]);
        if (state.focusTitle) {
          state.focusTitle = false;
          setTimeout(() => titleInput.focus(), 0);
        }
      } else {
        formArea = h('div', { class: 'hint', text: 'ページ上の要素をクリックすると、手順を追加できます。' });
      }

      statusEl = h('div', { class: 'status' });

      panelHost.append(
        h('div', { class: `panel ${state.side}` }, [
          h('div', { class: 'panel-head' }, [
            h('strong', {}, [M.logo(), '作成モード']),
            h('button', {
              class: 'btn small', text: state.side === 'right' ? '← 左へ' : '右へ →', title: 'パネルの位置を切り替え',
              onclick: () => { state.side = state.side === 'right' ? 'left' : 'right'; render(); },
            }),
            h('button', { class: 'btn small', text: '終了 (Esc)', onclick: requestExit }),
          ]),
          h('label', { class: 'lbl', text: 'ツアー名' }),
          nameInput,
          h('label', { class: 'lbl', text: '説明（任意）' }),
          descInput,
          list,
          formArea,
          statusEl,
          h('div', { class: 'row' }, [
            h('button', { class: 'btn primary', text: 'ツアーを保存', onclick: () => save(false) }),
          ]),
        ])
      );
    }

    // ---------- ページ側イベント ----------
    // イベント発生元の（Shadow DOMを貫通した）実要素。自分のUI上なら null
    function pageTarget(e) {
      if (layer.contains(e)) return null;
      const t = e.composedPath()[0];
      return t instanceof Element ? t : e.target instanceof Element ? e.target : null;
    }

    function onMove(e) {
      const el = pageTarget(e);
      hoverEl = el ? M.locator.pickTarget(el) : null;
      refreshBoxes();
    }

    // 自分のUI以外へのクリック等は、ページ本来の動作を止める
    function onBlocked(e) {
      if (layer.contains(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click' && !state.dialogOpen) {
        const el = pageTarget(e);
        if (el) {
          const picked = M.locator.pickTarget(el);
          state.pending = { target: M.locator.capture(picked), url: location.href };
          state.selectedEl = picked;
          state.focusTitle = true;
          render();
          refreshBoxes();
        }
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        requestExit();
      }
    }

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', scheduleRefresh, true);
    window.addEventListener('resize', scheduleRefresh, true);
    for (const type of BLOCKED_EVENTS) window.addEventListener(type, onBlocked, true);

    function destroy() {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', scheduleRefresh, true);
      window.removeEventListener('resize', scheduleRefresh, true);
      for (const type of BLOCKED_EVENTS) window.removeEventListener(type, onBlocked, true);
      if (raf) cancelAnimationFrame(raf);
      layer.destroy();
    }

    render();
    return { destroy };
  }

  M.creator = { start };
})();
