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

Kurulum yeri: `%APPDATA%\app.heravex\studio-data\plugins\<id>\` (kuruluma özel,
workspace'e değil — ekip klasörü üzerinden kod yayılmaz).

### Güç katmanı — "Minecraft seviyesi" API'ler (v0.9.9+)

Kutucukların dışına çıkmak isteyenler için dört damar daha var. Her biri
manifest'te ilgili izni gerektirir ve kurulum onayında listelenir; her
kayıt bir `dispose` fonksiyonu döndürür ve eklenti kapatılınca otomatik
temizlenir.

| API | İzin | Ne yapar |
|---|---|---|
| `hv.dom.injectStyle(css)` | `dom` | Uygulamaya stylesheet enjekte et — tam tema gücü |
| `hv.dom.onElement(sel, cb)` | `dom` | Seçiciye uyan elemente müdahale (⚠️ React'in çocuklarına dokunma) |
| `hv.dom.mountToSlot(slot, el)` | `dom` | **GÜVENLİ enjeksiyon** — çekirdeğin `data-hv-slot` noktasına eleman ekle |
| `hv.themes.register({id,label,css,preview?,previewAccent?})` | `dom` | **GÜVENLİ tema** — Ayarlar → Görünüm'deki **hızlı tema seçicisine** önizleme kartı ekler (sidebar+ana arka plan); çekirdek uygular/geri alır |
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

Güvenli tema + ikon ekleme (v0.9.9 — Dracula'nın çökme yaşamadan yapılan hâli):

```js
export default function activate(hv) {
  // Ayarlar → Tema'ya güvenli bir tema pill'i (çekirdek uygular/geri alır):
  hv.themes.register({
    id: "dracula",
    label: "🧛 Dracula",
    css: ":root{--accent:#bd93f9!important} body,#root,.workspace{background:#282a36!important}",
  });
  // Sidebar nav altına güvenle bir kart bas:
  const card = document.createElement("div");
  card.textContent = "🎨 Theme Pack";
  hv.dom.mountToSlot("sidebar-nav-end", card);
}
```

Resmi `data-hv-slot` noktaları: `sidebar-nav-end`, `dashboard-top`.
(Yenileri talebe göre eklenir.)

> ⚠️ **DOM güvenlik kuralı (Dracula dersi):** Tema/ikon için yukarıdaki
> **resmi** yolları kullan. `hv.dom.onElement` ile React'in yönettiği bir
> düğüme **çocuk EKLEME/KALDIRMA** — reconciliation `removeChild`
> hatasıyla uygulamayı çökertir. `onElement`'i yalnızca mevcut bir
> elemanın stil/attribute'unu değiştirmek için kullan. Seçiciler
> (`.nav-item`, `.panel`…) sürümler arası değişebilir.

### Kurtarma (bir eklenti uygulamayı dondurursa)

Eklentiler uygulama içinde tam yetkiyle çalıştığı için kötü/eski bir
eklenti UI'ı dondurabilir. İki kurtarma yolu (kurulu eklentiler
`%APPDATA%\app.heravex\studio-data\plugins\` altındadır):

1. **Tek eklentiyi kaldır:** ilgili `<id>` klasörünü sil, uygulamayı
   yeniden başlat.
2. **Güvenli mod (hepsini kapat):** `plugins\` içine boş bir `.disabled`
   dosyası koy → hiçbir eklenti yüklenmez. Silince tekrar açılır.

### Geliştirme döngüsü

Şimdilik: zip'le → kur → dene. Aynı `id` ile tekrar kurmak üstüne yazar
(güncelleme budur). Hızlı iterasyon için `plugins/<id>/index.js`'i
doğrudan düzenleyip Ayarlar → Eklentiler'de eklentiyi kapat/aç da
yapabilirsin (modül yeniden yüklenir).

### Örnekler

| Klasör | Ne yapar |
|--------|----------|
| `example-plugin/` | Dört katkı türünün dördünü gösteren minimal örnek |
| `god-mode/` | **Güç katmanı vitrini** — neon tema (dom), slash komutu (editor), kayıt damgası + toast (hooks), Ctrl+Shift+G / sağ-tık (input) |
| `theme-pack/` | **Stabil kanca kanıtı** — `hv.themes.register` ile Ayarlar'a Dracula/Nord + `mountToSlot` ile sidebar rozeti (Dracula'nın çökmeyen hâli) |
| `deadline-heatmap/` | Görev deadline'larını haftalık ısı haritasında görselleştirir |
| `color-kit/` | Oyun bazlı renk paletleri, harmony analizi, multi-format export |
| `theme-pack/` | 8 arkaplan teması (Aurora, Sakura, Neon City, vb.) — `hv.themes.register` API |

Zip'leyip kurarak sistemi test edebilirsin.
