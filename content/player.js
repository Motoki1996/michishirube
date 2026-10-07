// 再生モード: 対象要素以外を暗くして強調し、吹き出しで手順を案内する。
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});
  const { h } = M;

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

  function start(tour, opts) {
    const layer = M.createLayer();
    const root = layer.root;

    let index = 0;
    let targetEl = null;

    // ページ操作を止める透明な板、全面の暗幕（要素が無いとき用）、スポットライト、吹き出し
    const blocker = h('div', { class: 'blocker' });
    const dim = h('div', { class: 'dim' });
    const spot = h('div', { class: 'spot' });
    const tipHost = h('div');
    root.append(blocker, dim, spot, tipHost);

    // ---------- 位置合わせ ----------
    function placeSpot() {
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
    function show(i) {
      index = i;
      const step = tour.steps[i];
      targetEl = M.locator.find(step.target);
      if (targetEl) targetEl.scrollIntoView({ block: 'center', inline: 'center' });

      const notices = [];
      if (!sameUrl(step.url, location.href)) {
        const urlCode = h('code', { text: step.url });
        const children = ['この手順は別のページ用です。移動先: ', urlCode];
        if (/^(https?|file):/.test(step.url)) {
          children.push(' ', h('a', { href: step.url, target: '_blank', rel: 'noopener noreferrer', text: '開く', style: 'color:inherit' }));
        }
        notices.push(h('p', { class: 'notice' }, children));
      }
      if (!targetEl) {
        notices.push(h('p', { class: 'notice err', text: 'この手順の要素が見つかりません' }));
      }

      const last = i === tour.steps.length - 1;
      const tip = h('div', { class: 'tip' }, [
        ...notices,
        h('h3', { text: step.title }),
        step.body ? h('p', { class: 'body', text: step.body }) : null,
        h('div', { class: 'foot' }, [
          h('span', { class: 'count', text: `${i + 1} / ${tour.steps.length}` }),
          h('button', { class: 'btn', text: '戻る', disabled: i === 0, onclick: back }),
          h('button', { class: 'btn primary', text: last ? '完了' : '次へ', onclick: next }),
          h('button', { class: 'btn', text: '終了', onclick: exit }),
        ]),
      ]);
      tipHost.textContent = '';
      tipHost.append(tip);
      placeSpot();
      placeTip();
    }

    function next() {
      if (index >= tour.steps.length - 1) exit();
      else show(index + 1);
    }
    function back() {
      if (index > 0) show(index - 1);
    }
    function exit() {
      destroy();
      if (opts && opts.onExit) opts.onExit();
    }

    // ---------- イベント ----------
    function onKey(e) {
      if (e.key === 'Escape') exit();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);

    function destroy() {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition, true);
      if (raf) cancelAnimationFrame(raf);
      layer.destroy();
    }

    show(0);
    return { destroy };
  }

  M.player = { start };
})();
