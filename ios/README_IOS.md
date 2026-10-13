# TrackFlow iOS Setup Guide (iPhone)

You have two ways to get TrackFlow on your iPhone:

---

## ⚡ Option 1: Instant PWA Install (Takes 10 Seconds — No Mac or Xcode needed!)

TrackFlow already has a complete **Progressive Web App (PWA)** manifest and service worker configured.

1. On your iPhone, open **Safari**.
2. Navigate to your app:
   - **On home Wi-Fi**: `http://10.70.8.97:3000`
   - **On Netlify**: `https://your-app.netlify.app`
3. Tap the **Share icon** (the square with an arrow pointing up at the bottom of Safari).
4. Scroll down and tap **"Add to Home Screen"**.
5. Tap **Add** in the top right corner.

🎉 **Result**: TrackFlow appears on your iPhone home screen with its custom icon. When opened, it runs in **standalone full-screen app mode** without any Safari browser bars or URL inputs!

---

## 🛠️ Option 2: Native Swift Xcode App (For Xcode / USB / TestFlight)

If you have a Mac with **Xcode** (or an Apple Developer account) and want an actual native `.ipa` iOS application:

### Step 1: Create a new project in Xcode
1. Open **Xcode** → **File > New > Project**.
2. Choose **iOS > App** and click **Next**.
3. Name it `TrackFlow`:
   - **Interface**: `SwiftUI`
   - **Language**: `Swift`
4. Click **Create**.

### Step 2: Copy the Swift files
In your project navigator, replace/add the files from the `ios/` folder:
- Replace `TrackFlowApp.swift` with [TrackFlowApp.swift](file:///c:/Users/HariniManikandan/Downloads/Expense%20tracker/ios/TrackFlowApp.swift)
- Replace `ContentView.swift` with [ContentView.swift](file:///c:/Users/HariniManikandan/Downloads/Expense%20tracker/ios/ContentView.swift)
- Add [WebView.swift](file:///c:/Users/HariniManikandan/Downloads/Expense%20tracker/ios/WebView.swift)

### Step 3: Bundle Offline Web Assets (Optional for Offline-First)
- Drag [standalone.html](file:///c:/Users/HariniManikandan/Downloads/Expense%20tracker/standalone.html) into your Xcode project.
- Check **"Copy items if needed"** and add to target `TrackFlow`.

### Step 4: Configure Info.plist (App Transport Security)
If testing on local network (`http://10.70.8.97:3000` or local IP), add this to your project's `Info.plist`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

### Step 5: Run on iPhone
1. Connect your iPhone to your Mac with a USB cable.
2. Select your iPhone in Xcode's device selector at the top.
3. In **Signing & Capabilities**, select your free personal Apple ID Team.
4. Click **Run (Cmd + R)**.
5. On your iPhone: Go to **Settings > General > VPN & Device Management** → Tap your Apple ID → Tap **Trust**.
6. Open **TrackFlow** from your iPhone screen!
