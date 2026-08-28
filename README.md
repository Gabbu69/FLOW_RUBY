# 🎀 Ruby ✨ (Hello Kitty Edition)

> **An open-source, mobile-first, privacy-respecting cycle, fertility, pregnancy, and perimenopause companion — styled in a delightful Hello Kitty aesthetic.**

Ruby ships as a modern web application and native iOS/Android mobile app powered by Capacitor. It combines the speed and offline-first reliability of local IndexedDB with automatic cloud sync to **Supabase**, plus an integrated Bring-Your-Own-Key AI Health Companion supporting **Google Gemini**, **Anthropic Claude**, and **OpenAI**.

---

## 🌸 Key Highlights

- 🎀 **Delightful Hello Kitty Aesthetic**: Custom SVG red bow motifs, sweet pastel pinks, bubbly cards, 3D candy buttons, rounded typography (`Quicksand` & `Nunito`), and cute micro-interactions.
- 🔒 **Privacy First & Zero-Tracking**: Core logs live on your device in Dexie (IndexedDB). No analytics trackers, no third-party ads, no paywalls.
- ☁️ **Supabase Cloud Sync**: Transparent background syncing that mirrors every write into your cloud database without compromising offline capability.
- ✨ **AI Health Companion**: Powered by **Google Gemini 2.5 Flash / Pro**, **Claude Opus / Sonnet**, or **OpenAI GPT-5**, with granular consent controls over which health categories travel with each message.
- 📱 **Mobile-First & Native Ready**: Responsive touch controls, iOS/Android safe area support, haptic feedback, and local notifications.

---

## 🛠️ Architecture

```
├── app/
│   ├── src/
│   │   ├── components/     # UI Components (CycleRing, TabBar, RubyMark, DateStrip, LogSheet, etc.)
│   │   ├── db/             # Dexie (IndexedDB) schema, taxonomy, and Supabase sync layer
│   │   ├── engine/         # Cycle estimation, fertility algorithms, safety screening, audits
│   │   ├── lib/            # AI assistant transports (Gemini, Claude, OpenAI), crypto vault
│   │   ├── native/         # Capacitor native bridges (biometrics, health, widgets, notifications)
│   │   ├── screens/        # Primary views (Today, Insights, Trends, Settings, Onboarding)
│   │   └── styles/         # Design tokens, base styles, and hello-kitty-theme.css
│   ├── android/            # Native Android Studio project
│   ├── ios/                # Native iOS Xcode project
│   ├── supabase-migration.sql # Cloud database schema
│   └── package.json
├── workers/                # Optional Cloudflare zero-knowledge backup & reminders relays
└── package.json
```

---

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js LTS (v20+)](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation) (`npm install -g pnpm`)
- [Git](https://git-scm.com/)

### 2. Installation & Run
```sh
# Clone repository
git clone https://github.com/Gabbu69/FLOW_RUBY.git
cd FLOW_RUBY

# Install dependencies
pnpm install

# Start local development server
pnpm dev
```
Open **[http://localhost:5173/](http://localhost:5173/)** in your browser.

---

## ☁️ Supabase Cloud Database Setup

To enable real-time cloud sync for your Ruby instance:

1. Create a project at [Supabase](https://supabase.com/).
2. In your **Supabase Dashboard → SQL Editor**, run [`app/supabase-migration.sql`](app/supabase-migration.sql).
3. Create an `app/.env` file with your credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
   ```
4. All daily logs, cycle data, bookmarks, and health profiles will automatically sync both ways.

---

## ✨ AI Companion Setup (Google Gemini / Anthropic / OpenAI)

Ruby allows you to bring your own API key for intelligent cycle insights:
1. Tap the **Ruby AI** button (or open the **AI Assistant**).
2. Tap the **⚙ (Settings)** icon in the top right.
3. Select your provider:
   - **Google Gemini** (Recommended — Gemini 2.5 Flash / Pro)
   - **Anthropic Claude** (Claude Opus / Sonnet / Haiku or CLI Token)
   - **OpenAI** (GPT models)
4. Paste your API key and tap **Save connection ✨**.
5. *Keys are stored encrypted on-device and never shared.*

---

## 🧪 Testing

Run the test suite covering cycle algorithms, prediction engines, and safety filters:
```sh
pnpm test
```
*Current test suite: 187 passed across 22 test files.*

---

## 💡 How to Improve & Future Roadmap

Here are high-impact ways to further enhance **Ruby**:

1. **🔐 Multi-User Supabase Auth & Row Level Security (RLS)**:
   - Add Supabase Auth (Magic link / Google / Apple sign-in) so each user has their own private encrypted partition in the cloud database.
2. **📲 Native Home-Screen Widgets**:
   - Build native iOS WidgetKit (Swift) and Android AppWidget (Kotlin) components to show the cute Hello Kitty countdown ring directly on the home screen.
3. **⌚ Apple Watch & Wear OS Companion App**:
   - Add quick log check-ins (flow, mood, water) directly from smartwatches.
4. **📊 Exportable Doctor PDF Reports with Hello Kitty Header**:
   - Allow exporting customized clinical reports in PDF format for OB/GYN consultations.
5. **🔔 Smart Push Reminders & Cycle Phase Alerts**:
   - Expand local notification triggers for hydration check-ins, pill reminders, and predicted cycle transitions.
6. **🌐 Internationalization (i18n)**:
   - Add multi-language support (Spanish, French, Japanese, German, Chinese) for global accessibility.

---

## 📜 Disclaimer

Ruby is an open-source educational companion. It is not a medical device and does not diagnose, treat, cure, or prevent any condition. Cycle estimates are informational approximations and must not be used as contraception.

## 📄 License

AGPL-3.0 — See [LICENSE](LICENSE) for details.
