// 再生モード: 対象要素以外を暗くして強調し、吹き出しで手順を案内する。
//   interactive: false → 「見て再生」。ページ操作を止めて、戻る/次へで読み進める
//   interactive: true  → 「操作して再生」。ページを実際に操作でき、対象要素を操作すると次の手順へ自動で進む
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});
  const { h } = M;

  // 操作して再生: 次の手順の要素が現れるのを待つ最大時間（メニュー展開など、操作直後に現れる要素向け）
  const FIND_TIMEOUT_MS = 3000;
  const FIND_INTERVAL_MS = 200;
  // 操作後、ページ側の反応（メニューが開くなど）を待ってから次へ進む時間
  const ADVANCE_DELAY_MS = 350;

  // 値の変更（change）で完了とみなす要素か。それ以外はクリックで完了とする
  const NO_CHANGE_INPUT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'image'];
  function completesOnChange(el) {
    if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && !NO_CHANGE_INPUT.includes(el.type);
  }

  // ハッシュ(#...)を除いたURLで比較する
  function sameUrl(a, b) {
    try {
      const ua = new URL(a);
      const ub = new URL(b);
      return ua.origin + ua.pathname + ua.search === ub.origin + ub.pathname + ub.search;
    } catch (_) {
      return a === b;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function start(tour, opts) {
    const interactive = Boolean(opts && opts.interactive);
    const layer = M.createLayer();
    const root = layer.root;

    let index = 0;
    let targetEl = null;
    let done = false; // 操作して再生: 全手順を終えた
    let advancing = false; // 次の手順へ進む待機中（二重進行を防ぐ）
    let token = 0; // 古い show() の結果を捨てるための番号

    // ページ操作を止める透明な板（見て再生のみ）、全面の暗幕（要素が無いとき用）、スポットライト、吹き出し
    const dim = h('div', { class: 'dim' });
    const spot = h('div', { class: 'spot' });
    const tipHost = h('div');
    root.append(...(interactive ? [] : [h('div', { class: 'blocker' })]), dim, spot, tipHost);

    // ---------- 位置合わせ ----------
    function placeSpot() {
      if (done) {
        spot.style.display = 'none';
        dim.style.display = 'none';
        return;
      }
      if (!targetEl || !targetEl.isConnected) {
        spot.style.display = 'none';
        dim.style.display = 'block';
        return;
      }
      const r = targetEl.getBoundingClientRect();
      dim.style.display = 'none';
      Object.assign(spot.style, {
        display: 'block',
        left: `${r.left - 4}px`,
        top: `${r.top - 4}px`,
        width: `${r.width + 8}px`,
        height: `${r.height + 8}px`,
      });
    }

    function placeTip() {
      const tip = tipHost.firstElementChild;
      if (!tip) return;
      const pad = 12;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left;
      let top;
      if (!targetEl || !targetEl.isConnected) {
        left = (vw - tw) / 2;
        top = (vh - th) / 2;
      } else {
        const r = targetEl.getBoundingClientRect();
        if (r.bottom + pad + th <= vh) top = r.bottom + pad; // 下に出す
        else if (r.top - pad - th >= 0) top = r.top - pad - th; // 入らなければ上
        else top = Math.max(pad, vh - th - pad); // 要素が大きい場合は画面下部
        left = Math.min(Math.max(r.left, pad), Math.max(pad, vw - tw - pad));
      }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }

    let raf = 0;
    function reposition() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        placeSpot();
        placeTip();
      });
    }

    // ---------- 手順の表示 ----------
    // 操作して再生では、操作直後に現れる要素を少し待って探す
    async function findTarget(step, my) {
      let el = M.locator.find(step.target);
      if (el || !interactive) return el;
      const until = Date.now() + FIND_TIMEOUT_MS;
      while (!el && Date.now() < until) {
        await sleep(FIND_INTERVAL_MS);
        if (my !== token) return null;
        el = M.locator.find(step.target);
      }
      return el;
    }

    async function show(i) {
      index = i;
      advancing = false;
      const my = ++token;
      const step = tour.steps[i];
      const found = await findTarget(step, my);
      if (my !== token) return; // 待っている間に別の手順へ移った
      targetEl = found;
      if (targetEl) targetEl.scrollIntoView({ block: 'center', inline: 'center' });

      const notices = [];
      if (!sameUrl(step.url, location.href)) {
        const urlCode = h('code', { text: step.url });
        const children = ['この手順は別のページ用です。移動先: ', urlCode];
        if (/^(https?|file):/.test(step.url)) {
          children.push(' ', h('a', { href: step.url, target: '_blank', rel: 'noopener noreferrer', text: '開く' }));
        }
        notices.push(h('p', { class: 'notice' }, children));
      }
      if (!targetEl) {
        notices.push(h('p', { class: 'notice err', text: 'この手順の要素が見つかりません' }));
      } else if (interactive) {
        const how = completesOnChange(targetEl)
          ? 'ハイライトされた項目に入力・選択すると、次へ進みます（入力はEnterか枠外クリックで確定）'
          : 'ハイライトされた要素を実際にクリックすると、次へ進みます';
        notices.push(h('p', { class: 'notice info', text: how }));
      }

      const last = i === tour.steps.length - 1;
      const bar = h('span');
      bar.style.width = `${Math.round(((i + 1) / tour.steps.length) * 100)}%`;
      const tip = h('div', { class: 'tip' }, [
        h('div', { class: 'bar' }, [bar]),
        ...notices,
        h('h3', { text: step.title }),
        step.body ? h('p', { class: 'body', text: step.body }) : null,
        h('div', { class: 'foot' }, [
          h('span', { class: 'count', text: `${i + 1} / ${tour.steps.length}` }),
          h('button', { class: 'btn', text: '戻る', disabled: i === 0, onclick: back }),
          h('button', { class: 'btn primary', text: interactive ? 'スキップ' : last ? '完了' : '次へ', onclick: next }),
          h('button', { class: 'btn', text: '終了', onclick: exit }),
        ]),
      ]);
      tipHost.textContent = '';
      tipHost.append(tip);
      placeSpot();
      placeTip();
    }

    function showDone() {
      done = true;
      token++;
      targetEl = null;
      tipHost.textContent = '';
      tipHost.append(
        h('div', { class: 'tip' }, [
          h('h3', { text: 'ツアー完了' }),
          h('p', { class: 'body', text: `すべての手順（${tour.steps.length}手順）を終えました。` }),
          h('div', { class: 'foot' }, [
            h('span', { class: 'count' }),
            h('button', { class: 'btn primary', text: '終了', onclick: exit }),
          ]),
        ])
      );
      placeSpot();
      placeTip();
    }

    function next() {
      if (index < tour.steps.length - 1) show(index + 1);
      else if (interactive) showDone();
      else exit();
    }
    function back() {
      if (index > 0) show(index - 1);
    }
    function exit() {
      destroy();
      if (opts && opts.onExit) opts.onExit();
    }

    // ---------- 操作して再生: 対象要素の操作を検知して次へ ----------
    // 少し待ってから次へ進む（クリックによるメニュー展開などを待つ）
    function advanceSoon() {
      if (advancing || done) return;
      advancing = true;
      const my = token;
      setTimeout(() => {
        if (my === token) next();
      }, ADVANCE_DELAY_MS);
    }

    // イベントが対象要素（またはそのラベル）で起きたか
    function hitsTarget(e) {
      if (!targetEl || layer.contains(e)) return false;
      const path = e.composedPath();
      if (path.includes(targetEl)) return true;
      return Boolean(targetEl.labels && Array.from(targetEl.labels).some((l) => path.includes(l)));
    }

    function onActionClick(e) {
      if (!e.isTrusted || !targetEl || completesOnChange(targetEl)) return;
      if (hitsTarget(e)) advanceSoon();
    }
    function onActionChange(e) {
      if (!targetEl || !completesOnChange(targetEl)) return;
      if (hitsTarget(e)) advanceSoon();
    }

    // ---------- イベント ----------
    function onKey(e) {
      if (e.key === 'Escape') exit();
      // 矢印キーは、操作して再生ではページ側の入力と干渉するので使わない
      else if (!interactive && e.key === 'ArrowRight') next();
      else if (!interactive && e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);
    if (interactive) {
      window.addEventListener('click', onActionClick, true);
      window.addEventListener('change', onActionChange, true);
    }

    function destroy() {
      token++;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition, true);
      window.removeEventListener('click', onActionClick, true);
      window.removeEventListener('change', onActionChange, true);
      if (raf) cancelAnimationFrame(raf);
      layer.destroy();
    }

    show(0);
    return { destroy };
  }

  M.player = { start };
})();
