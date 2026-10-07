// ページに差し込むUIの土台。
// Shadow DOM の中に描画して、社内システムのCSSと干渉しないようにする。
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});

  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .root {
      position: fixed; inset: 0; pointer-events: none;
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
      color: #1f2937; letter-spacing: normal; text-align: left;
    }
    button { font: inherit; cursor: pointer; }
    .btn {
      border: 1px solid #cbd5e1; background: #fff; color: #1f2937; border-radius: 6px;
      padding: 5px 12px; line-height: 1.4;
    }
    .btn:hover:not(:disabled) { background: #f1f5f9; }
    .btn:disabled { opacity: .45; cursor: default; }
    .btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .btn.primary:hover:not(:disabled) { background: #1d4ed8; }
    .btn.danger { background: #dc2626; border-color: #dc2626; color: #fff; }
    .btn.small { padding: 1px 7px; font-size: 12px; }
    .in {
      width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px;
      font: inherit; color: #1f2937; background: #fff;
    }
    textarea.in { resize: vertical; min-height: 64px; }
    label.lbl { display: block; font-size: 12px; color: #475569; margin: 8px 0 2px; }

    /* 要素の枠 */
    .hl { position: fixed; display: none; pointer-events: none; border-radius: 4px; }
    .hl.hover { border: 2px solid #2563eb; background: rgba(37, 99, 235, .12); }
    .hl.selected { border: 3px solid #16a34a; background: rgba(22, 163, 74, .15); }

    /* 作成パネル */
    .panel {
      position: fixed; right: 16px; bottom: 16px; width: 340px; max-height: calc(100vh - 32px);
      overflow: auto; background: #fff; border-radius: 10px; padding: 14px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, .3); pointer-events: auto;
    }
    .panel.left { right: auto; left: 16px; }
    .panel-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .panel-head strong { flex: 1; font-size: 15px; }
    .steps { list-style: none; margin: 10px 0 0; padding: 0; }
    .step {
      display: flex; align-items: center; gap: 4px; padding: 4px 6px; border: 1px solid #e2e8f0;
      border-radius: 6px; margin-bottom: 4px;
    }
    .step.active { border-color: #16a34a; background: #f0fdf4; }
    .step .num { color: #64748b; min-width: 1.6em; }
    .step .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hint { margin-top: 10px; padding: 8px; background: #eff6ff; border-radius: 6px; font-size: 13px; color: #1e40af; }
    .form { margin-top: 10px; padding: 10px; border: 1px solid #16a34a; border-radius: 8px; background: #f0fdf4; }
    .target-desc { font-size: 12px; color: #166534; word-break: break-all; }
    .row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .status { min-height: 1.4em; margin-top: 8px; font-size: 13px; }
    .status.error { color: #b91c1c; }
    .status.ok { color: #15803d; }

    /* ダイアログ */
    .dialog-back {
      position: fixed; inset: 0; background: rgba(15, 23, 42, .45); pointer-events: auto;
      display: flex; align-items: center; justify-content: center;
    }
    .dialog { background: #fff; border-radius: 10px; padding: 18px; width: 360px; max-width: calc(100vw - 32px); }
    .dialog p { margin: 0; white-space: pre-wrap; }

    /* 再生 */
    .blocker { position: fixed; inset: 0; pointer-events: auto; }
    .dim { position: fixed; inset: 0; background: rgba(15, 23, 42, .6); display: none; pointer-events: none; }
    .spot {
      position: fixed; display: none; border-radius: 6px; pointer-events: none;
      box-shadow: 0 0 0 3px #3b82f6, 0 0 0 200vmax rgba(15, 23, 42, .6);
    }
    .tip {
      position: fixed; width: 320px; max-width: calc(100vw - 24px); background: #fff; border-radius: 10px;
      padding: 14px 16px; box-shadow: 0 8px 30px rgba(0, 0, 0, .35); pointer-events: auto;
    }
    .tip h3 { margin: 0 0 6px; font-size: 16px; }
    .tip .body { margin: 0; white-space: pre-wrap; word-break: break-word; }
    .tip .count { font-size: 12px; color: #64748b; }
    .tip .foot { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
    .tip .foot .count { flex: 1; }
    .notice {
      margin: 0 0 8px; padding: 6px 8px; border-radius: 6px; font-size: 13px;
      background: #fef3c7; color: #92400e; word-break: break-all;
    }
    .notice.err { background: #fee2e2; color: #991b1b; }
    .notice code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; user-select: text; }
  `;

  // 要素を作る小さなヘルパー。テキストは必ず textContent で入れる（HTML注入を防ぐ）
  function h(tag, props, children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children || [])) {
      if (c !== null && c !== undefined && c !== false) el.append(c);
    }
    return el;
  }

  // Shadow DOM のレイヤーを作る。戻り値の root の中にUIを組み立てる
  function createLayer() {
    const host = document.createElement('div');
    host.setAttribute('data-michishirube', '');
    // ページ側CSSの影響を受けないよう !important で固定し、z-index は最大値にする
    host.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important;' +
      'z-index: 2147483647 !important; pointer-events: none !important; display: block !important;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const root = h('div', { class: 'root' });
    shadow.append(style, root);
    document.documentElement.appendChild(host);
    return {
      host,
      root,
      // イベントがこのレイヤー内で起きたか
      contains(event) {
        return event.composedPath().includes(host);
      },
      destroy() {
        host.remove();
      },
    };
  }

  // 確認ダイアログ。choices: [{label, value, kind}] → 選ばれた value で resolve
  function ask(layer, message, choices) {
    return new Promise((resolve) => {
      const dlg = h('div', { class: 'dialog-back' }, [
        h('div', { class: 'dialog' }, [
          h('p', { text: message }),
          h(
            'div',
            { class: 'row' },
            choices.map((c) =>
              h('button', {
                class: `btn ${c.kind || ''}`,
                text: c.label,
                onclick: () => {
                  dlg.remove();
                  resolve(c.value);
                },
              })
            )
          ),
        ]),
      ]);
      layer.root.append(dlg);
    });
  }

  M.h = h;
  M.createLayer = createLayer;
  M.ask = ask;
})();
