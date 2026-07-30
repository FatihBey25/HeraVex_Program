# HeraVex Eklenti SDK'sı (apiVersion 1)

HeraVex'e **tam sayfa**, **dashboard widget'ı**, **komut paleti komutu** ve
**ayarlar paneli** ekleyen eklentiler yazabilirsin. Eklentiler uygulama
içinde tam yetkiyle çalışır — kullanıcılar kurulumda izin listeni görür.

## Hızlı başlangıç

Bir eklenti = iki dosyalık bir klasör:

```
my-plugin/
├── heravex.plugin.json   ← manifest
└── index.js              ← TEK bundle'lanmış ES modülü
```

### 1) Manifest — `heravex.plugin.json`

```json
{
  "id": "my-plugin",
  "name": "Benim Eklentim",
  "description": "Ne yaptığının bir cümlelik özeti.",
  "version": "1.0.0",
  "author": "Adın",
  "apiVersion": 1,
  "entry": "index.js",
  "permissions": ["readGames", "readTasks"],
  "contributes": {
    "pages":    [{ "id": "board", "title": "Panom", "icon": "Sparkles" }],
    "widgets":  [{ "id": "w1", "slot": "dashboard" }],
    "commands": [{ "id": "run", "title": "Çalıştır" }],
    "settings": [{ "id": "prefs", "title": "Tercihler" }]
  }
}
```

- `id`: küçük harf + rakam + tire, 2–64 karakter. Kurulum klasörünün adıdır.
- `permissions`: kullandığın API'lere göre zorunlu — izinsiz çağrılar hata
  fırlatır. Değerler: `readGames`, `readTasks`, `readNotes`, `writeNotes`,
  `readWallet`, `network`, `storage`.
- `pages[].icon`: sidebar ikonu — `Puzzle`, `Sparkles`, `Wrench`, `FileText`,
  `BarChart3`, `Gamepad2`, `Calendar`, `ListTodo`, `StickyNote`, `Workflow`.

### 2) Kod — `index.js`

```js
export default function activate(hv) {
  hv.registerPage("board", (root) => {
    root.innerHTML = "<h2 style='padding:24px'>Merhaba HeraVex!</h2>";
    return () => { /* sayfa kapanınca temizlik */ };
  });
  hv.registerCommand("run", () => hv.toast("Çalıştı!", "success"));
}
```

Kurallar:
- **Tek ES modülü**: bağımlılıkların varsa tek dosyaya bundle et
  (`esbuild index.ts --bundle --format=esm --outfile=index.js`).
- **Vanilla DOM**: render fonksiyonları sana boş bir `HTMLElement` verir.
  React zorunlu değil; uygulamanın CSS değişkenleri (`--accent`,
  `--accent-soft` …) temaya uyum için kullanılabilir.
- Render fonksiyonundan **temizlik fonksiyonu döndür** (listener/timer
  ekledinse). `activate` da bir temizlik fonksiyonu döndürebilir.

### 3) `hv` API'si (özet — tam tipler `heravex-plugin.d.ts` içinde)

| Çağrı | İzin | Ne yapar |
|---|---|---|
| `hv.getGames()` | readGames | Oyun listesi (salt okunur) |
| `hv.getTasks()` | readTasks | Tüm görevler (+gameId/gameTitle) |
| `hv.getNotes()` / `hv.saveNote(n)` | readNotes / writeNotes | Notlar |
| `hv.getExpenses()` | readWallet | Tüm giderler |
| `hv.toast(msg, kind?)` | — | Bildirim göster |
| `hv.navigate(hedef)` | — | Çekirdek sekmeye veya kendi sayfana git |
| `hv.subscribe(cb)` | — | Store değişince cb; unsubscribe döner |
| `hv.on(event, cb)` | — | Host olaylarını dinle (ör. `heravex:games-list-changed`) |
| `hv.storage.get/set/remove` | storage | Eklentiye özel kalıcı depo |
| `hv.language` | — | Aktif dil (`"tr"`, `"en"`, …) |

### 4) Paketle & kur

1. Klasörü zip'le (klasörün kendisini veya içeriğini — ikisi de olur):
   `my-plugin.zip` (veya `.hvx`).
2. HeraVex → **Ayarlar → Eklentiler → Eklenti ekle → Dosyadan (.zip)**.
   URL ile de kurulabilir (bir GitHub release linki gibi).
3. İzin onayından sonra eklenti aktifleşir; sayfalar sidebar'da
   **EKLENTİLER** altında belirir.

Kurulum yeri: `%LOCALAPPDATA%/app.heravex/plugins/<id>/` (kuruluma özel,
workspace'e değil — ekip klasörü üzerinden kod yayılmaz).

### Güç katmanı — "Minecraft seviyesi" API'ler (v0.9.9+)

Kutucukların dışına çıkmak isteyenler için dört damar daha var. Her biri
manifest'te ilgili izni gerektirir ve kurulum onayında listelenir; her
kayıt bir `dispose` fonksiyonu döndürür ve eklenti kapatılınca otomatik
temizlenir.

| API | İzin | Ne yapar |
|---|---|---|
| `hv.dom.injectStyle(css)` | `dom` | Uygulamaya stylesheet enjekte et — tam tema gücü |
| `hv.dom.onElement(sel, cb)` | `dom` | Seçiciye uyan mevcut **ve gelecekteki** her elemente müdahale (buton ekle, davranış değiştir) |
| `hv.hooks.filter(hook, fn)` | `hooks` | `game:beforeSave`, `note:beforeSave`, `*:beforeDelete`… — veriyi **değiştir** ya da `null` döndürüp **engelle** |
| `hv.hooks.on(hook, fn)` | `hooks` | İşlem sonrası bildirim (`*:afterSave`, `*:afterDelete`) |
| `hv.store.watch(sel, cb)` | `hooks` | Store'daki herhangi bir dilimi canlı izle |
| `hv.editor.addSlashCommand(...)` | `editor` | "/" menüsüne komut ekle — caret'e **düzenlenebilir** içerik yazar |
| `hv.menu.register({title, selector?, onClick})` | `input` | Uygulama geneli sağ-tık menüsüne öğe ekle (seçiciyle bağlama uyumlu) |
| `hv.hotkeys.register("Ctrl+Shift+K", fn)` | `input` | Küresel kısayol tanımla |
| `hv.fetch(url, opts?)` | `network` | Rust üzerinden HTTP — CSP engeline takılmadan dış API'lere eriş |

Mini örnek — kaydedilen her notun başlığını otomatik büyük harfe çevir:

```js
export default function activate(hv) {
  hv.hooks.filter("note:beforeSave", (note) => ({
    ...note,
    title: note.title.toUpperCase(),
  }));
}
```

Mini örnek — "/" menüsüne kendi snippet komutunu ekle:

```js
hv.editor.addSlashCommand({
  id: "callout",
  label: "Uyarı kutusu",
  onSelect: (insert) => insert('<blockquote>⚠️ Dikkat!</blockquote>'),
});
```

> ⚠️ **DOM güvenlik kuralı (Dracula dersi):** `hv.dom.onElement` ile
> React'in yönettiği bir konteynıra **çocuk EKLEME** ya da React'in
> sahip olduğu bir düğümü **KALDIRMA** — React'in reconciliation'ı
> `removeChild` hatasıyla uygulamayı çökertebilir. Güvenli desen: kendi
> elemanını `document.body`'ye ekle (ör. `position:fixed` overlay), ya da
> mevcut bir elemanın SADECE stil/attribute'unu değiştir; asla React'in
> child listesine dokunma. Seçiciler (`.nav-item`, `.panel`…) sürümler
> arasında değişebilir — büyük sürümlerde test et.

### Geliştirme döngüsü

Şimdilik: zip'le → kur → dene. Aynı `id` ile tekrar kurmak üstüne yazar
(güncelleme budur). Hızlı iterasyon için `plugins/<id>/index.js`'i
doğrudan düzenleyip Ayarlar → Eklentiler'de eklentiyi kapat/aç da
yapabilirsin (modül yeniden yüklenir).

### Örnekler

| Klasör | Ne yapar |
|--------|----------|
| `example-plugin/` | Dört katkı türünün dördünü gösteren minimal örnek |
| `god-mode/` | **Güç katmanı vitrini** — neon tema (dom), `[progress:70]` çubuğu (editor), kayıt damgası + toast (hooks), Ctrl+Shift+G / sağ-tık (input) |
| `deadline-heatmap/` | Görev deadline'larını haftalık ısı haritasında görselleştirir |
| `color-kit/` | Oyun bazlı renk paletleri, harmony analizi, multi-format export |

Zip'leyip kurarak sistemi test edebilirsin.
