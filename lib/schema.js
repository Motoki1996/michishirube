// ツアーJSONのスキーマ検証と正規化。
// popup / service worker / content script のすべてから使う（DOMには依存しない）。
(function () {
  'use strict';

  const M = (globalThis.Michishirube = globalThis.Michishirube || {});

  const SCHEMA_VERSION = 1;
  const LIMITS = {
    name: 100,
    description: 1000,
    steps: 200,
    title: 200,
    body: 5000,
    targetString: 1000,
  };
  // 属性名はセレクタ文字列に使うため、安全な文字だけ許可する
  const ATTR_NAME_RE = /^[a-zA-Z_][\w:.-]*$/;

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isIsoDate(v) {
    return typeof v === 'string' && !Number.isNaN(Date.parse(v));
  }

  function isAllowedUrl(v) {
    try {
      const u = new URL(v);
      return ['http:', 'https:', 'file:'].includes(u.protocol);
    } catch (_) {
      return false;
    }
  }

  // 任意の文字列フィールドを検証して値を返す（問題があれば errors に追加）
  function readString(obj, key, path, errors, opts) {
    const { required = false, max = LIMITS.targetString, fallback = '' } = opts || {};
    const v = obj[key];
    if (v === undefined || v === null) {
      if (required) errors.push(`${path}${key} がありません`);
      return fallback;
    }
    if (typeof v !== 'string') {
      errors.push(`${path}${key} は文字列である必要があります`);
      return fallback;
    }
    if (required && v.trim() === '') errors.push(`${path}${key} が空です`);
    if (v.length > max) errors.push(`${path}${key} が長すぎます（最大${max}文字）`);
    return v;
  }

  function validateTarget(t, path, errors) {
    if (!isObject(t)) {
      errors.push(`${path} はオブジェクトである必要があります`);
      return null;
    }
    const p = `${path}.`;
    const out = {
      id: readString(t, 'id', p, errors),
      attributes: {},
      tag: readString(t, 'tag', p, errors, { max: 50 }).toLowerCase(),
      text: readString(t, 'text', p, errors),
      cssPath: readString(t, 'cssPath', p, errors),
    };
    if (t.attributes !== undefined && t.attributes !== null) {
      if (!isObject(t.attributes)) {
        errors.push(`${p}attributes はオブジェクトである必要があります`);
      } else {
        for (const [k, v] of Object.entries(t.attributes)) {
          if (!ATTR_NAME_RE.test(k)) {
            errors.push(`${p}attributes の属性名「${k}」は使用できません`);
          } else if (typeof v !== 'string') {
            errors.push(`${p}attributes.${k} は文字列である必要があります`);
          } else if (v.length > LIMITS.targetString) {
            errors.push(`${p}attributes.${k} が長すぎます`);
          } else {
            out.attributes[k] = v;
          }
        }
      }
    }
    const hasClue =
      out.id || out.text || out.cssPath || Object.values(out.attributes).some((v) => v !== '');
    if (!hasClue) errors.push(`${path} に要素を特定する手がかりがありません`);
    return out;
  }

  function validateStep(s, index, errors) {
    const path = `steps[${index}]`;
    if (!isObject(s)) {
      errors.push(`${path} はオブジェクトである必要があります`);
      return null;
    }
    const p = `${path}.`;
    const url = readString(s, 'url', p, errors, { required: true });
    if (url && !isAllowedUrl(url)) {
      errors.push(`${p}url は http / https / file のURLである必要があります`);
    }
    return {
      url,
      title: readString(s, 'title', p, errors, { required: true, max: LIMITS.title }),
      body: readString(s, 'body', p, errors, { max: LIMITS.body }),
      target: validateTarget(s.target, `${p}target`, errors),
    };
  }

  // ツアー全体を検証する。
  // 戻り値: { ok, errors: string[], tour }（ok のとき tour は未知のキーを除いた正規化済みデータ）
  function validateTour(data) {
    const errors = [];
    if (!isObject(data)) {
      return { ok: false, errors: ['JSONのトップレベルはオブジェクトである必要があります'], tour: null };
    }

    if (data.schemaVersion !== SCHEMA_VERSION) {
      if (typeof data.schemaVersion === 'number' && data.schemaVersion > SCHEMA_VERSION) {
        errors.push(
          `schemaVersion が ${data.schemaVersion} です。このバージョンの拡張機能は ${SCHEMA_VERSION} のみ対応しています`
        );
      } else {
        errors.push(`schemaVersion は ${SCHEMA_VERSION} である必要があります`);
      }
    }

    const name = readString(data, 'name', '', errors, { required: true, max: LIMITS.name });
    const description = readString(data, 'description', '', errors, { max: LIMITS.description });

    const now = new Date().toISOString();
    let createdAt = now;
    let updatedAt = now;
    for (const key of ['createdAt', 'updatedAt']) {
      if (data[key] === undefined) continue;
      if (!isIsoDate(data[key])) {
        errors.push(`${key} は日時（ISO8601形式）である必要があります`);
      } else if (key === 'createdAt') createdAt = data[key];
      else updatedAt = data[key];
    }

    const steps = [];
    if (!Array.isArray(data.steps)) {
      errors.push('steps は配列である必要があります');
    } else if (data.steps.length === 0) {
      errors.push('steps に手順が1つもありません');
    } else if (data.steps.length > LIMITS.steps) {
      errors.push(`steps が多すぎます（最大${LIMITS.steps}件）`);
    } else {
      data.steps.forEach((s, i) => {
        const step = validateStep(s, i, errors);
        if (step) steps.push(step);
      });
    }

    if (errors.length > 0) return { ok: false, errors, tour: null };
    return {
      ok: true,
      errors: [],
      tour: { schemaVersion: SCHEMA_VERSION, name, description, createdAt, updatedAt, steps },
    };
  }

  M.schema = { SCHEMA_VERSION, LIMITS, validateTour };
})();
