# Rhygym アプリアイコン

音符（八分音符）とダンベルを組み合わせた Rhygym のアプリアイコン一式です。

## ファイル一覧

### 角丸版（icon-NNN.png）
四隅が角丸に加工済み。favicon、apple-touch-icon、一般的な用途に使う。

| ファイル | サイズ | 主な用途 |
|----------|--------|----------|
| icon-512.png | 512×512 | PWA、ストア表示、高解像度 |
| icon-192.png | 192×192 | PWA（Android ホーム画面） |
| icon-180.png | 180×180 | apple-touch-icon（iOS） |
| icon-167.png | 167×167 | iPad Pro |
| icon-152.png | 152×152 | iPad |
| icon-128.png | 128×128 | Chrome ウェブストアなど |
| icon-96 / 64 / 48.png | 各サイズ | 汎用 |
| icon-32.png | 32×32 | favicon（標準） |
| icon-16.png | 16×16 | favicon（最小・タブ表示） |

### マスカブル版（icon-maskable-NNN.png）
角丸なしのフルブリード（背景が四隅まで広がる）。要素を中央に余裕を持って配置してあり、OS が円形・角丸など任意の形でマスクしても切れない。PWA の maskable アイコン、Android アダプティブアイコン用。

## SVG 素材
- `icon-master.svg` … 角丸版のベクター元データ
- `icon-fullbleed.svg` … マスカブル版のベクター元データ

サイズを追加したい場合は、この SVG から書き出せる。

## HTML への組み込み例

```html
<!-- favicon -->
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16.png">

<!-- iOS ホーム画面 -->
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">

<!-- PWA マニフェスト -->
<link rel="manifest" href="/manifest.webmanifest">
```

## manifest.webmanifest の記述例

```json
{
  "name": "Rhygym",
  "short_name": "Rhygym",
  "description": "楽譜を読み、画面タップでリズムを叩く。読譜力を鍛えるWebリズム学習アプリ。",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FFD24A",
  "theme_color": "#FFD24A",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

## カラー

| 用途 | 値 |
|------|-----|
| 背景（メイン） | #FFD24A |
| 背景（上部の明るい帯） | #FFE08A |
| 音符・ダンベル本体 | #2A1B06 |
| ダンベルのウェイト | #E8612E |
