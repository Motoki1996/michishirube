// ページに差し込むUIの土台。
// Shadow DOM の中に描画して、社内システムのCSSと干渉しないようにする。
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});

  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .root {
      --ink: #17142b; --muted: #6b7085; --line: rgba(23, 20, 43, .10); --soft: #f1efff;
      --brand: #6d5ef5; --brand-ink: #4338ca; --brand2: #a855f7;
      --grad: linear-gradient(135deg, #5b5bf0 0%, #a855f7 100%);
      --accent: #ffb020; --danger: #e5484d; --ok: #0f7a3d;
      position: fixed; inset: 0; pointer-events: none;
      font: 14px/1.55 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
      color: var(--ink); letter-spacing: normal; text-align: left;
    }
    button { font: inherit; cursor: pointer; }

    /* ボタン・入力 */
    .btn {
      border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 999px;
      padding: 6px 14px; line-height: 1.4; font-size: 13px; font-weight: 600;
      transition: background .15s, border-color .15s, transform .15s, filter .15s;
    }
    .btn:hover:not(:disabled) { background: var(--soft); border-color: rgba(109, 94, 245, .4); }
    .btn:disabled { opacity: .4; cursor: default; }
    .btn.primary {
      background: var(--grad); border-color: transparent; color: #fff;
      box-shadow: 0 6px 14px -4px rgba(109, 94, 245, .6);
    }
    .btn.primary:hover:not(:disabled) { background: var(--grad); filter: brightness(1.07); transform: translateY(-1px); }
    .btn.danger { background: var(--danger); border-color: transparent; color: #fff; }
    .btn.danger:hover:not(:disabled) { background: var(--danger); filter: brightness(1.08); }
    .btn.small { padding: 1px 9px; font-size: 12px; }
    .btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .in {
      width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px;
      font: inherit; color: var(--ink); background: #fff; transition: border-color .15s, box-shadow .15s;
    }
    .in:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px rgba(109, 94, 245, .18); }
    textarea.in { resize: vertical; min-height: 64px; }
    label.lbl { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin: 10px 0 3px; }

    /* 要素の枠 */
    .hl { position: fixed; display: none; pointer-events: none; border-radius: 8px; }
    .hl.hover { border: 2px solid var(--brand); background: rgba(109, 94, 245, .10); box-shadow: 0 0 0 4px rgba(109, 94, 245, .16); }
    .hl.selected { border: 3px solid var(--accent); background: rgba(255, 176, 32, .16); box-shadow: 0 0 0 4px rgba(255, 176, 32, .22); }

    /* パネル（作成・記録） */
    .panel {
      position: fixed; right: 18px; bottom: 18px; width: 352px; max-height: calc(100vh - 36px);
      overflow: auto; padding: 16px 16px 14px; border-radius: 20px; pointer-events: auto;
      background: var(--grad) top / 100% 3px no-repeat, #fff;
      box-shadow: 0 0 0 1px var(--line), 0 24px 56px -14px rgba(23, 20, 43, .5);
      animation: rise .22s ease-out;
    }
    .panel.left { right: auto; left: 18px; }
    .panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
    .panel-head strong { flex: 1; display: flex; align-items: center; font-size: 15px; letter-spacing: -.01em; }
    .logo { flex: none; width: 24px; height: 24px; margin-right: 8px; filter: drop-shadow(0 3px 5px rgba(109, 94, 245, .35)); }
    .steps { list-style: none; margin: 12px 0 0; padding: 0; }
    .step {
      display: flex; align-items: center; gap: 4px; padding: 5px 8px; margin-bottom: 5px;
      border: 1px solid var(--line); border-radius: 12px; background: #fff;
    }
    .step.active { border-color: var(--accent); background: #fff8e8; }
    .step .num { color: var(--brand); font-weight: 700; min-width: 1.7em; }
    .step .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hint { margin-top: 12px; padding: 9px 12px; background: var(--soft); border-radius: 12px; font-size: 13px; color: var(--brand-ink); }
    .form { margin-top: 12px; padding: 12px; border: 1px solid rgba(255, 176, 32, .6); border-radius: 14px; background: #fffaf0; }
    .target-desc { font-size: 12px; color: #92600a; word-break: break-all; }
    .row { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
    .status { min-height: 1.4em; margin-top: 8px; font-size: 13px; }
    .status.error { color: var(--danger); }
    .status.ok { color: var(--ok); }
    .dot {
      display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--danger);
      margin-right: 8px; animation: pulse-dot 1.4s ease-out infinite;
    }
    .last { margin-top: 10px; font-size: 13px; color: var(--muted); word-break: break-all; }
    .chk { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 13px; }
    .chk input { accent-color: var(--brand); }

    /* ダイアログ */
    .dialog-back {
      position: fixed; inset: 0; background: rgba(18, 14, 36, .5); pointer-events: auto;
      display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px);
    }
    .dialog {
      background: #fff; border-radius: 20px; padding: 20px; width: 380px; max-width: calc(100vw - 32px);
      box-shadow: 0 30px 70px -16px rgba(0, 0, 0, .55); animation: rise .2s ease-out;
    }
    .dialog p { margin: 0; white-space: pre-wrap; }

    /* 再生 */
    .blocker { position: fixed; inset: 0; pointer-events: auto; }
    .dim { position: fixed; inset: 0; background: rgba(18, 14, 36, .64); display: none; pointer-events: none; }
    .spot {
      position: fixed; display: none; border-radius: 10px; pointer-events: none;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, .95), 0 0 0 7px rgba(168, 85, 247, .55), 0 0 0 200vmax rgba(18, 14, 36, .64);
      animation: ring 1.8s ease-in-out infinite;
    }
    .tip {
      position: fixed; width: 344px; max-width: calc(100vw - 24px); background: #fff; border-radius: 20px;
      padding: 14px 18px 14px; pointer-events: auto; animation: rise .22s ease-out;
      box-shadow: 0 0 0 1px var(--line), 0 24px 56px -12px rgba(0, 0, 0, .55);
    }
    .tip .top { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .tip .bar { flex: 1; height: 4px; border-radius: 999px; background: var(--soft); overflow: hidden; }
    .tip .bar span { display: block; height: 100%; border-radius: 999px; background: var(--grad); transition: width .3s ease; }
    .tip h3 { margin: 0 0 6px; font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
    .tip .body { margin: 0; white-space: pre-wrap; word-break: break-word; color: #3a3752; }
    .tip .foot { display: flex; align-items: center; gap: 6px; margin-top: 14px; }
    .tip .count {
      margin-right: auto; font-size: 12px; font-weight: 700; color: var(--brand-ink);
      background: var(--soft); border-radius: 999px; padding: 2px 10px;
    }
    .tip .count:empty { background: none; padding: 0; }
    .notice {
      margin: 0 0 10px; padding: 7px 10px; border-radius: 10px; font-size: 13px;
      background: #fff4d6; color: #8a5a00; border-left: 3px solid var(--accent); word-break: break-all;
    }
    .notice.info { background: var(--soft); color: var(--brand-ink); border-left-color: var(--brand); }
    .notice.err { background: #fdecec; color: #b42318; border-left-color: var(--danger); }
    .notice a { color: inherit; }
    .notice code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; user-select: text; }

    /* 一時停止バー */
    .paused {
      position: fixed; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 6px;
      padding: 8px 10px 8px 12px; border-radius: 999px; background: #fff; pointer-events: auto;
      box-shadow: 0 0 0 1px var(--line), 0 16px 36px -10px rgba(23, 20, 43, .45);
      animation: rise .22s ease-out;
    }
    .paused.left { right: auto; left: 18px; }
    .paused .logo { width: 20px; height: 20px; margin-right: 2px; }
    .paused-text { font-size: 13px; font-weight: 700; color: var(--brand-ink); margin-right: 4px; white-space: nowrap; }

    @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
    @keyframes ring {
      0%, 100% { box-shadow: 0 0 0 3px rgba(255, 255, 255, .95), 0 0 0 7px rgba(168, 85, 247, .55), 0 0 0 200vmax rgba(18, 14, 36, .64); }
      50% { box-shadow: 0 0 0 3px rgba(255, 255, 255, .95), 0 0 0 11px rgba(168, 85, 247, .22), 0 0 0 200vmax rgba(18, 14, 36, .64); }
    }
    @keyframes pulse-dot {
      0% { box-shadow: 0 0 0 0 rgba(229, 72, 77, .55); }
      80%, 100% { box-shadow: 0 0 0 8px rgba(229, 72, 77, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel, .tip, .dialog, .spot, .dot, .paused { animation: none; }
    }
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

  // クリップボードにコピー。http のページでは navigator.clipboard が使えないので execCommand にフォールバック
  async function copyText(layer, text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* フォールバックへ */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position: fixed; opacity: 0;';
    layer.root.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) { /* 失敗扱い */ }
    ta.remove();
    return ok;
  }

  // ツアーをJSONファイルとしてダウンロード
  function downloadTour(layer, tour) {
    const blob = new Blob([JSON.stringify(tour, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: M.schema.exportFileName(tour.name) });
    layer.root.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // アイコンと同じ形のロゴ（道と、その先に灯る標）
  function logo() {
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    const svg = mk('svg', { viewBox: '0 0 100 100', class: 'logo', 'aria-hidden': 'true' });
    const defs = mk('defs', {});
    const grad = mk('linearGradient', { id: 'mc-logo', x1: '0', y1: '0', x2: '1', y2: '1' });
    grad.append(mk('stop', { offset: '0', 'stop-color': '#4f46e5' }), mk('stop', { offset: '1', 'stop-color': '#a855f7' }));
    defs.append(grad);
    svg.append(
      defs,
      mk('rect', { width: '100', height: '100', rx: '22.5', fill: 'url(#mc-logo)' }),
      mk('path', { d: 'M27 75 C27 46 69 66 69 31', fill: 'none', stroke: '#fff', 'stroke-width': '10.4', 'stroke-linecap': 'round' }),
      mk('circle', { cx: '69', cy: '27', r: '13.5', fill: '#fff' }),
      mk('circle', { cx: '69', cy: '27', r: '9.5', fill: '#ffb81c' })
    );
    return svg;
  }

  M.logo = logo;
  M.copyText = copyText;
  M.downloadTour = downloadTour;
  M.h = h;
  M.createLayer = createLayer;
  M.ask = ask;
})();
