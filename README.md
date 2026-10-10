# 喵喵數獨 🐾

可愛貓咪主題的數獨遊戲，共 50 關，iPhone App（Capacitor）＋ 也能直接當網頁 / PWA 玩。

**▶ 線上試玩：https://hankhsu1969.github.io/meow-sudoku/**

- **50 關、5 個章節**：毛線球（入門）→ 小魚乾（簡單）→ 貓抓板（普通）→ 貓薄荷（困難）→ 貓咪之王（專家）
  - 每題都驗證過「唯一解」，並用人類解題技巧評估難度，讓難度平順上升
  - 1–10 關是新手暖身：空格從 10 個慢慢增加到 36 個，只要找「這格只剩一個數字能填」就能解完
  - 11–25 關只需基本技巧、26–40 關需要區塊摒除 / 數對、41–50 關需要進階技巧
- **玩法功能**：筆記模式、復原、擦除、提示（每關 3 次）、失誤 3 次重來、計時、三星評分、自動存檔、關卡解鎖
- **新手教學**（只在第 1 關）：介紹規則、帶你實際填第一個數字、說明貓掌與小幫手；聚光燈引導，必須照著做才會前進，可隨時跳過，也能在「?」說明裡重看
- **桌機 / 橫向平板版面**：棋盤放大到左邊，數字鍵盤改成 3×3 放在右邊；滑鼠有滑過效果，也能用鍵盤操作
- **美術**：全部由 H 站（Higgsfield GPT Image 2）產生：首頁背景、遊戲背景、4 種表情的貓咪吉祥物、App 圖示
- **音樂音效**：全部用 Web Audio API 即時合成（沒有任何音檔）
  - 主選單曲「喵喵進行曲」：Pluck 琶音 + 音樂盒旋律 + 跳躍貝斯 + 合成鼓組
  - 遊戲曲「午後貓窩」：Lo-fi FM 電鋼琴和弦 + 溫暖 Pad + 卡林巴旋律 + 輕柔鼓組，四段變化循環
  - 音效：填數字會依數字彈出五聲音階、完成一排有和弦鈴聲、過關有電鋼琴＋鈴聲齊奏的慶祝樂句，還有共振峰合成的「喵～」
  - 全部經過殘響與延遲回音處理，不是單音的電腦嗶聲
- **iPhone 細節**：瀏海 / Home 條安全區域、Taptic 震動回饋、離線可玩、iPhone SE 到 Pro Max 都排版正確

## 1. 在電腦上試玩（Windows，不用安裝任何東西）

```
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

再用瀏覽器打開 http://localhost:8080 。電腦上也可以用鍵盤：數字鍵填入、方向鍵移動、Backspace 擦除、N 筆記、H 提示、Ctrl+Z 復原。

## 2. 先在 iPhone 上玩（PWA，免 Mac）

用 iPhone 的 Safari 打開 https://hankhsu1969.github.io/meow-sudoku/ →「分享」→「加入主畫面」，就會變成有圖示、全螢幕、可離線的 App。

網站是 GitHub Pages 從 `gh-pages` 分支發佈的（內容就是 `www/` 資料夾）。修改 `www/` 並 push 到 `main` 之後，再執行下面這行更新網站：

```bash
git push origin `git subtree split --prefix www main`:gh-pages --force
```

## 3. 打包成真正的 iPhone App（需要 Mac + Xcode）

iOS App 只能在 macOS 上用 Xcode 編譯。在 Mac 上：

```bash
npm install
npm run ios:setup      # 建立 iOS 專案、產生 App 圖示與啟動畫面、同步網頁內容
npm run ios:open       # 用 Xcode 開啟
```

在 Xcode 裡：

1. 把 `capacitor.config.json` 的 `appId`（目前是 `com.example.meowsudoku`）改成你自己的 Bundle ID，再執行一次 `npx cap sync ios`
2. **Signing & Capabilities** → 選你的 Apple Developer Team
3. **General → Deployment Info** → 只勾 **Portrait**（直式）
4. 接上 iPhone 按 ▶ 執行；要上架就 **Product → Archive** → 上傳到 App Store Connect

之後每次修改 `www/` 裡的檔案，執行 `npm run ios:sync` 再重新編譯即可。

**沒有 Mac？** 可以用雲端建置服務（Codemagic、Ionic Appflow，或 GitHub Actions 的 macOS runner）編譯並上傳到 TestFlight。

> 小提醒：iPhone 側邊的靜音開關打開時，App 會跟其他遊戲一樣保持安靜；要聽音樂請關掉靜音。

## 專案結構

```
www/                  遊戲本體（網頁）
  index.html
  css/style.css
  js/levels.js        50 關題目與解答（自動產生）
  js/audio.js         合成音樂 / 音效引擎
  js/game.js          遊戲邏輯與畫面
  img/                圖片（由 art_src/ 轉檔而來）
  fonts/              粉圓體子集字型
  manifest.webmanifest, sw.js   PWA 設定與離線快取
assets/               iOS App 圖示與啟動畫面的原始檔（給 @capacitor/assets）
art_src/              H 站產生的原始高解析圖
tools/
  gen_levels.html     題目產生器（用瀏覽器開啟即可重新產生 50 關）
  process_art.ps1     把 art_src/ 轉成 App 用尺寸
  build_font.ps1      修改中文字後重新產生字型子集
  serve.ps1           本機測試伺服器
```
