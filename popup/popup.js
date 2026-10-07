// ポップアップ: ツアー一覧、作成・再生の開始、インポート / エクスポート。
(function () {
  'use strict';

  const { schema, storage } = globalThis.Michishirube;

  // 操作中のタブに注入する content script（この順で読み込む）
  const CONTENT_FILES = [
    'lib/schema.js',
    'lib/locator.js',
    'content/overlay.js',
    'content/creator.js',
    'content/player.js',
    'content/recorder.js',
    'content/main.js',
  ];
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

  const $ = (id) => document.getElementById(id);

  // ---------- 表示ヘルパー ----------
  function el(tag, props, children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) if (c) e.append(c);
    return e;
  }

  // kind: 'error' | 'ok' | 'info'。details は箇条書きで表示する
  function showMessage(text, kind, details, actions) {
    const box = $('message');
    box.textContent = '';
    box.className = `message ${kind || 'info'}`;
    box.append(el('div', { text }));
    if (details && details.length) {
      box.append(el('ul', {}, details.map((d) => el('li', { text: d }))));
    }
    if (actions && actions.length) {
      box.append(
        el('div', { class: 'row' }, actions.map((a) => el('button', { class: `btn small ${a.kind || ''}`, text: a.label, onclick: a.onclick })))
      );
    }
    box.hidden = false;
  }
  function clearMessage() {
    $('message').hidden = true;
  }

  // ---------- タブへの注入 ----------
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) throw new Error('操作できるタブが見つかりません');
    return tab;
  }

  // content script を（未注入のときだけ）現在のタブに注入する
  async function ensureInjected(tabId) {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__michishirube),
    });
    if (!probe.result) {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    }
  }

  // method: 'startCreate' | 'startRecord' | 'play'。arg はそのメソッドに渡す値
  async function runInTab(method, arg) {
    try {
      const tab = await getActiveTab();
      await ensureInjected(tab.id);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (m, t) => window.__michishirube[m](t),
        args: [method, arg],
      });
      window.close();
    } catch (e) {
      showMessage(
        'このページでは実行できません。',
        'error',
        [
          'chrome:// ページや Chrome ウェブストアなどでは拡張機能を使えません。',
          'file:// のページは、拡張機能の詳細で「ファイルのURLへのアクセスを許可する」をオンにしてください。',
          `詳細: ${(e && e.message) || e}`,
        ]
      );
    }
  }

  // ---------- 一覧 ----------
  function formatDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
  }

  async function renderList() {
    const tours = await storage.getAll();
    const list = $('tours');
    list.textContent = '';
    $('empty').hidden = tours.length > 0;
    for (const t of tours) {
      list.append(
        el('li', { class: 'tour' }, [
          el('div', { class: 'name', text: t.name }),
          el('div', { class: 'meta', text: `${t.steps.length}手順 ・ 更新 ${formatDate(t.updatedAt)}` }),
          el('div', { class: 'actions' }, [
            el('button', { class: 'btn small primary', text: '再生', onclick: () => runInTab('play', t) }),
            el('button', { class: 'btn small', text: '編集', onclick: () => runInTab('startCreate', t) }),
            el('button', { class: 'btn small', text: '書き出し', onclick: () => exportTour(t) }),
            el('button', { class: 'btn small', text: 'コピー', onclick: () => copyTour(t) }),
            el('button', { class: 'btn small', text: '削除', onclick: () => deleteTour(t) }),
          ]),
        ])
      );
    }
  }

  async function deleteTour(t) {
    if (!confirm(`ツアー「${t.name}」を削除しますか？\n（先に書き出しておくと、後でインポートして戻せます）`)) return;
    await storage.remove(t.name);
    showMessage(`「${t.name}」を削除しました`, 'ok');
    await renderList();
  }

  // ---------- エクスポート ----------
  function exportTour(t) {
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: schema.exportFileName(t.name) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showMessage(`「${t.name}」を書き出しました`, 'ok');
  }

  // JSONをクリップボードにコピー（チャットやメールに貼り付けて共有できる）
  async function copyTour(t) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(t, null, 2));
      showMessage(`「${t.name}」のJSONをコピーしました。貼り付けて共有できます`, 'ok');
    } catch (e) {
      showMessage('コピーできませんでした。「書き出し」を使ってください', 'error');
    }
  }

  // ---------- 記録の下書き（ページ遷移などで中断された記録） ----------
  async function renderDraft() {
    const box = $('draft');
    const draft = await storage.getDraft();
    if (!draft || draft.steps.length === 0) {
      box.hidden = true;
      return;
    }
    box.textContent = '';
    box.append(el('div', { text: `中断された記録があります（${draft.steps.length}手順）` }));
    box.append(
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn small primary', text: 'このページで続きを記録',
          onclick: () => runInTab('startRecord', { comment: draft.comment, steps: draft.steps }),
        }),
        el('button', {
          class: 'btn small', text: 'このまま保存',
          onclick: async () => {
            const now = new Date().toISOString();
            let tour = { schemaVersion: 1, name: schema.defaultTourName(), description: '', createdAt: now, updatedAt: now, steps: draft.steps };
            const res = await storage.save(tour);
            if (res.conflict) tour = { ...tour, name: res.suggestedName };
            if (res.conflict) await storage.save(tour);
            await storage.clearDraft();
            showMessage(`「${tour.name}」として保存しました`, 'ok');
            await renderDraft();
            await renderList();
          },
        }),
        el('button', {
          class: 'btn small', text: '破棄',
          onclick: async () => {
            if (!confirm('中断された記録を破棄しますか？')) return;
            await storage.clearDraft();
            await renderDraft();
          },
        }),
      ])
    );
    box.hidden = false;
  }

  // ---------- インポート ----------
  async function importFile(file) {
    clearMessage();
    if (file.size > MAX_IMPORT_BYTES) {
      return showMessage('インポートできません。', 'error', ['ファイルが大きすぎます（最大5MB）']);
    }
    await importText(await file.text());
  }

  // JSON文字列（ファイルの中身、または貼り付けたテキスト）をインポートする
  async function importText(text) {
    clearMessage();
    if (text.length > MAX_IMPORT_BYTES) {
      return showMessage('インポートできません。', 'error', ['テキストが大きすぎます（最大5MB）']);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return showMessage('インポートできません。', 'error', [`JSONとして読み込めません（${e.message}）`]);
    }

    const result = schema.validateTour(data);
    if (!result.ok) {
      const shown = result.errors.slice(0, 10);
      if (result.errors.length > shown.length) shown.push(`…ほか${result.errors.length - shown.length}件`);
      return showMessage('ツアーの形式が正しくありません。', 'error', shown);
    }

    const tour = result.tour;
    const res = await storage.save(tour);
    if (res.ok) {
      showMessage(`「${tour.name}」をインポートしました`, 'ok');
      return renderList();
    }
    if (res.conflict) {
      // 同名ツアーがある: 上書きか別名かを選んでもらう
      showMessage(`「${tour.name}」という名前のツアーが既にあります。`, 'info', null, [
        {
          label: '上書き',
          kind: 'danger',
          onclick: async () => {
            await storage.save(tour, { overwrite: true });
            showMessage(`「${tour.name}」を上書きしました`, 'ok');
            renderList();
          },
        },
        {
          label: `別名で保存（${res.suggestedName}）`,
          onclick: async () => {
            await storage.save({ ...tour, name: res.suggestedName });
            showMessage(`「${res.suggestedName}」として保存しました`, 'ok');
            renderList();
          },
        },
        { label: 'キャンセル', onclick: clearMessage },
      ]);
    }
  }

  // ---------- 起動 ----------
  $('record-comment').addEventListener('click', () => runInTab('startRecord', { comment: true }));
  $('record-quick').addEventListener('click', () => runInTab('startRecord', { comment: false }));
  $('pick-mode').addEventListener('click', () => runInTab('startCreate', null));
  $('paste-toggle').addEventListener('click', () => {
    $('paste-area').hidden = !$('paste-area').hidden;
    if (!$('paste-area').hidden) $('paste-text').focus();
  });
  $('paste-import').addEventListener('click', async () => {
    const text = $('paste-text').value.trim();
    if (!text) return showMessage('JSONを貼り付けてください', 'error');
    await importText(text);
    $('paste-text').value = '';
  });
  $('import').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // 同じファイルを続けて選べるように
    if (file) await importFile(file);
  });

  renderList();
  renderDraft();
})();
