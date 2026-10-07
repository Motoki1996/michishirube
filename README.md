# michishirube（みちしるべ）

社内のWebシステムの画面上に「操作ツアー」を作成・再生できる Chrome 拡張機能です。ツアーは JSON ファイルでインポート / エクスポートできます。

- Manifest V3 / 依存ライブラリなし / ビルド不要
- 外部通信なし（`fetch`・外部CDN・解析ツールは使っていません）
- 権限は `storage`、`activeTab`、`scripting` のみ（ホスト権限なし）

## 読み込み方法

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダ（`manifest.json` があるフォルダ）を選ぶ

> **`file://` のページ（`test/demo.html` を直接開く場合）**
> 拡張機能の「詳細」で「ファイルのURLへのアクセスを許可する」をオンにしてください。
> オンにしたくない場合は `python3 -m http.server` などでローカルサーバーを立て、`http://localhost:8000/test/demo.html` を開いてください。

## 使い方

### ツアーを作成する
1. ツアーを作りたいページを開き、ツールバーの拡張機能アイコン →「ツアーを作成」
2. ページ上の要素にマウスを乗せると枠が出ます。クリックで選択（元のページのクリック動作は止まります）
3. 右下のパネルでタイトルと説明文を入力し「手順を追加」
4. 手順は ↑↓ で並べ替え、「編集」「削除」ができます。パネルが邪魔なら「← 左へ」で位置を切り替えられます
5. ツアー名を入力して「ツアーを保存」。`Esc` で作成モードを終了します

### ツアーを再生する
アイコン → 一覧の「再生」。対象以外が暗くなり、吹き出しに「n / 全体数」と「戻る」「次へ」「終了」が出ます（キーボードの ← → Esc も使えます）。

- 要素が見つからない手順は「この手順の要素が見つかりません」と表示され、そのまま次へ進めます
- 記録したURLと現在のURLが違う手順は、その旨と移動先URLが表示されます（自動遷移はしません）

### 書き出し / 取り込み
- 一覧の「書き出し」で `michishirube_<ツアー名>.json` をダウンロードします
- 「JSONをインポート」でファイルを選ぶと、スキーマを検証します。不正な場合は理由を表示します
- 同名のツアーがある場合は「上書き」か「別名で保存」を選べます

## 要素の特定方法

記録時に複数の手がかりを保存し、再生時は上から順に試します。

1. `id`（連番・ハッシュ・フレームワーク自動生成っぽいidは記録しません）
2. `data-testid`、`name`、`aria-label` などの安定した属性
3. タグ名 + 表示テキスト（ボタンやリンクの文言）
4. CSSセレクタのパス（最終手段）

同じ条件に複数の要素が当てはまる場合は、CSSパスが一致するもの、次に表示されているものが1つだけならそれを使い、決まらなければ次の手がかりに進みます。

## JSONスキーマ（schemaVersion: 1）

```json
{
  "schemaVersion": 1,
  "name": "ツアー名",
  "description": "任意の説明",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "steps": [
    {
      "url": "https://example.local/page",
      "title": "手順のタイトル",
      "body": "説明文",
      "target": {
        "id": "submit-button",
        "attributes": { "name": "", "aria-label": "", "data-testid": "" },
        "tag": "button",
        "text": "送信",
        "cssPath": "main > form > button:nth-of-type(1)"
      }
    }
  ]
}
```

| フィールド | 必須 | 説明 |
|---|---|---|
| `schemaVersion` | ○ | `1` 固定 |
| `name` | ○ | ツアー名（100文字まで）。同名はインポート時に上書き / 別名を選択 |
| `description` | | 説明（1000文字まで） |
| `createdAt` / `updatedAt` | | ISO8601形式。省略時はインポート時刻 |
| `steps` | ○ | 手順の配列（1〜200件） |
| `steps[].url` | ○ | 手順を記録したページのURL（`http` / `https` / `file` のみ） |
| `steps[].title` | ○ | タイトル（200文字まで） |
| `steps[].body` | | 説明文（5000文字まで） |
| `steps[].target` | ○ | 要素の手がかり。`id` / `attributes`（値が空でないもの）/ `text` / `cssPath` のいずれか1つ以上が必要 |
| `target.attributes` | | 属性名→値のオブジェクト（値は文字列。記録時は値のある属性のみ保存） |
| `target.tag` | | タグ名（小文字） |

## ファイル構成

```
manifest.json
background/service-worker.js  ツアー保存の受付（保存前にスキーマ検証）
lib/schema.js                 JSONスキーマの検証・正規化
lib/storage.js                chrome.storage.local への保存・同名処理
lib/locator.js                要素の記録と探索
content/overlay.js            Shadow DOM のレイヤー・共通UI部品
content/creator.js            作成モード
content/player.js             再生モード
content/main.js               content script のエントリ
popup/                        ポップアップ（一覧・インポート/エクスポート）
test/demo.html                動作確認用ページ
```

content script は、ポップアップを開いたタブにだけ `chrome.scripting.executeScript` で注入されます。

## 制限事項

- ページをまたぐ自動遷移、スクリーンショット付き手順書、共有・同期、管理コンソール配布は対象外です
- ページ側の Shadow DOM の内部にある要素は、CSSパスでは特定できません（他の手がかりで見つかる場合があります）
- iframe 内の要素は対象外です（トップフレームのみ）
- `chrome://` ページやChromeウェブストアでは拡張機能を実行できません
- ポップアップの「JSONをインポート」でファイル選択ダイアログを開くとポップアップが閉じる環境がある場合は、お知らせください
