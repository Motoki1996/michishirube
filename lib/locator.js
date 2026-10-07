// 要素の特定ロジック。
// 記録(capture)時は複数の手がかりを保存し、再生(find)時は上から順に試す:
//   1. id（ランダムっぽいidは除外）
//   2. data-testid / name / aria-label などの安定した属性
//   3. タグ名 + 表示テキスト（完全一致）
//   4. タグ名 + 表示テキスト（ゆるい一致: 全角/半角・件数・数字・記号の違いを無視。1つに決まるときだけ）
//   5. CSSセレクタのパス（最終手段）
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});

  // 記録する属性（優先順）
  const STABLE_ATTRS = [
    'data-testid',
    'data-test',
    'data-cy',
    'data-qa',
    'name',
    'aria-label',
    'placeholder',
    'title',
    'for',
  ];
  const TEXT_MAX = 80;

  // クリックされた要素を、操作の単位として自然な祖先（ボタン等）に引き上げる
  const INTERACTIVE_SELECTOR =
    'button,a,input,select,textarea,label,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"]';
  function pickTarget(el) {
    return el.closest(INTERACTIVE_SELECTOR) || el;
  }

  // 自動生成っぽいid（連番・ハッシュ・フレームワーク由来）を除外する
  function isStableId(id) {
    if (!id || id.length > 40) return false;
    if (/\d{3,}/.test(id)) return false; // 長い数字列
    if (/^[0-9a-f]{8,}$/i.test(id)) return false; // ハッシュ
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(id)) return false; // UUID
    if (/^(:r|ember|react-|mui-|ext-gen|__|radix-|headlessui-)/i.test(id)) return false;
    const digits = (id.match(/\d/g) || []).length;
    if (id.length >= 6 && digits / id.length > 0.4) return false;
    return true;
  }

  function normalizeText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function getText(el) {
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) {
      return normalizeText(el.value);
    }
    return normalizeText(el.innerText || el.textContent);
  }

  function isUniqueId(id) {
    return document.querySelectorAll(`#${CSS.escape(id)}`).length === 1;
  }

  // ルート（または安定idの祖先）からのCSSパスを作る
  function buildCssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && isStableId(node.id) && isUniqueId(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      if (node === document.body) {
        parts.unshift('body');
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  // 要素から target オブジェクト（JSONスキーマの target）を作る
  function capture(el) {
    const attributes = {};
    for (const name of STABLE_ATTRS) {
      const v = el.getAttribute(name);
      if (v && v.length <= 200) attributes[name] = v;
    }
    const text = getText(el);
    return {
      id: el.id && isStableId(el.id) && isUniqueId(el.id) ? el.id : '',
      attributes,
      tag: el.tagName.toLowerCase(),
      text: text.length <= TEXT_MAX ? text : '',
      cssPath: buildCssPath(el),
    };
  }

  function attrSelector(tag, name, value) {
    const v = value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
    return `${tag || '*'}[${name}="${v}"]`;
  }

  function safeQueryAll(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (_) {
      return [];
    }
  }

  function safeQuery(selector) {
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function isVisible(el) {
    return el.getClientRects().length > 0;
  }

  // 候補が複数あるときの絞り込み: cssPath と一致するもの → 表示中のもの
  // 戻り値: 1つに決まれば要素、決まらなければ null
  function disambiguate(candidates, target) {
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) return null;
    if (target.cssPath) {
      const byPath = safeQuery(target.cssPath);
      if (byPath && candidates.includes(byPath)) return byPath;
    }
    const visible = candidates.filter(isVisible);
    return visible.length === 1 ? visible[0] : null;
  }

  // 表記ゆれを吸収した比較用のキー（全角/半角、件数表示、数字、飾りの記号、空白を無視する）
  function looseKey(s) {
    return normalizeText(s)
      .normalize('NFKC') // 「ＯＫ」→「OK」、「（３）」→「(3)」
      .replace(/[(\[]\s*\d[\d,]*\s*[)\]]/g, '') // 件数「受信箱 (3)」「通知[12]」
      .replace(/\d+/g, '#') // 残りの数字は「何かの数字」として扱う
      .replace(/[▼▲►▶›»×✕…:：]/g, '') // 飾りの記号
      .replace(/\s+/g, '')
      .toLowerCase();
  }
  const LOOSE_KEY_MIN = 2; // 短すぎるキーは誤検出のもとなので使わない

  // target に対応する要素を探す。見つからなければ null
  function find(target) {
    return findDetailed(target).el;
  }

  // find と同じ探索をして、どの方法で見つかったかも返す。
  // 戻り値: { el, loose }（loose: 表示テキストのゆるい一致で見つかった）
  function findDetailed(target) {
    if (!target) return { el: null, loose: false };
    const el = findStrict(target);
    if (el) return { el, loose: false };

    // 4. タグ名 + 表示テキスト（ゆるい一致）。誤って別の要素を案内しないよう、1つに決まるときだけ使う
    const wanted = target.text && target.tag ? looseKey(target.text) : '';
    if (wanted.length >= LOOSE_KEY_MIN) {
      const candidates = safeQueryAll(target.tag).filter((c) => looseKey(getText(c)) === wanted);
      const hit = disambiguate(candidates, target);
      if (hit) return { el: hit, loose: true };
    }

    // 5. CSSパス（最終手段）
    if (target.cssPath) {
      const byPath = safeQuery(target.cssPath);
      if (byPath) return { el: byPath, loose: false };
    }
    return { el: null, loose: false };
  }

  // 1〜3（id・属性・表示テキストの完全一致）で探す
  function findStrict(target) {
    if (!target) return null;
    const tag = target.tag || '';

    // 1. id
    if (target.id) {
      const el = document.getElementById(target.id);
      if (el) return el;
    }

    // 2. 安定した属性（記録順の優先度で試す）
    const attrs = target.attributes || {};
    const names = [...STABLE_ATTRS.filter((n) => n in attrs), ...Object.keys(attrs).filter((n) => !STABLE_ATTRS.includes(n))];
    for (const name of names) {
      const value = attrs[name];
      if (!value) continue;
      let candidates = safeQueryAll(attrSelector(tag, name, value));
      if (candidates.length > 1 && target.text) {
        const byText = candidates.filter((c) => getText(c) === normalizeText(target.text));
        if (byText.length > 0) candidates = byText;
      }
      const hit = disambiguate(candidates, target);
      if (hit) return hit;
    }

    // 3. タグ名 + 表示テキスト（完全一致）
    if (target.text && tag) {
      const wanted = normalizeText(target.text);
      const candidates = safeQueryAll(tag).filter((c) => getText(c) === wanted);
      const hit = disambiguate(candidates, target);
      if (hit) return hit;
    }
    return null;
  }

  // ---------- 記録モード用: 要素の人間向けラベルと、操作の自動タイトル ----------
  function shorten(s, n) {
    return s.length > n ? `${s.slice(0, n)}…` : s;
  }

  // ラベル内のフォーム部品（selectの選択肢など）を除いた文字列
  function labelText(label) {
    const c = label.cloneNode(true);
    c.querySelectorAll('input,select,textarea,button').forEach((n) => n.remove());
    return normalizeText(c.textContent);
  }

  function labelOf(el) {
    const aria = normalizeText(el.getAttribute('aria-label'));
    if (aria) return shorten(aria, 30);
    if (el.labels && el.labels.length) {
      const t = labelText(el.labels[0]);
      if (t) return shorten(t, 30);
    }
    const text = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'button' && el.type !== 'submit'
      ? '' : getText(el);
    if (text) return shorten(text, 30);
    const alt = el.querySelector && el.querySelector('img[alt]');
    for (const v of [el.getAttribute('placeholder'), el.getAttribute('title'), alt && alt.getAttribute('alt'), el.getAttribute('name')]) {
      if (v && normalizeText(v)) return shorten(normalizeText(v), 30);
    }
    return '';
  }

  // kind: 'click' | 'toggle' | 'input' | 'select' | 'file'
  function describeAction(el, kind) {
    const label = labelOf(el);
    const name = label ? `「${label}」` : 'この要素';
    switch (kind) {
      case 'toggle':
        if (el.type === 'radio') return `${name}を選択`;
        return el.checked ? `${name}にチェックを入れる` : `${name}のチェックを外す`;
      case 'input':
        return `${name}に入力`;
      case 'file':
        return `${name}でファイルを選択`;
      case 'select': {
        const opt = el.selectedOptions && el.selectedOptions[0];
        const v = opt ? normalizeText(opt.textContent) : '';
        return v ? `${name}で「${shorten(v, 20)}」を選択` : `${name}を選択`;
      }
      default:
        return `${name}をクリック`;
    }
  }

  M.locator = { capture, find, findDetailed, looseKey, pickTarget, isStableId, describeAction };
})();
