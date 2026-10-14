# TrackFlow - Dual-Account (BOB & ICICI) Expense Tracker

A modern, offline-first personal expense tracker designed for tracking expenses across **Bank of Baroda (BOB)** and **ICICI Bank** accounts. Built as a Progressive Web App (PWA) with **0% network dependency**, **no login required**, and **runs standalone on your mobile phone even when your laptop is turned off**.

Featuring an editorial, **card-free design** in **cream white, sage green, and ink black** with **silhouette vector icons** (zero emojis), desktop sidebar navigation, and dedicated **BOB Partner Notification & Shared Ledger**.

---

## 🌟 Key Features

1. **BOB Partner Pairing & Reimbursement Reminders (New)**:
   - **How to Fix / Pair the Partner**:
     - Go to **Settings** (`tab-settings`) -> **"BOB Partner Pairing & Reimbursement Reminders"**.
     - Set your **Partner Name** (e.g. Priya, Alex), **WhatsApp/Phone**, and optional **Partner UPI ID**.
     - Tap **"Copy Partner Request Link"** or **"Send Pair Link via WhatsApp"** to share the link with your partner.
   - **When Partner Spends on BOB**:
     - **In-App Option**: When recording an expense, choose **"Who Spent: Partner Spent"** with account **BOB**.
     - **Partner Phone Link Option**: Your partner can tap their link (`?action=partner_spend`) on their phone to request reimbursement.
     - **Active Reminder**: TrackFlow immediately triggers a notification alert and pins an active banner to your Dashboard:  
       > **"Reminder: You should send ₹[Amount] for [Purpose] to your partner ([Partner Name])"**
     - **BOB Balance is NOT Deducted Yet**: The money remains in your BOB account while pending.
   - **Marking as "I Paid"**:
     - When you send the money to your partner, tap **"I Paid (Deduct from BOB)"**.
     - **The reminder stops immediately**.
     - **The amount is deducted from your BOB account balance**.
     - The transaction is logged into the ledger as `Reimbursed [Partner] for [Purpose] ([Merchant])`.
     - Automatically launches WhatsApp directly with preformatted payment confirmation to your partner!

2. **Recurring Pop-Up Notifications & Reminders Engine (New)**:
   - **Notification Settings** (`tab-settings` -> *Recurring Reminders & Pop-up Notifications*):
     - **Keep Popping Reminders Automatically**: Toggle on/off recurring pop-ups.
     - **Repeat Frequency (Interval)**: Choose how frequently reminders pop up: `Every 1 Minute` (for testing/demo), `5 Minutes`, `15 Minutes` (recommended), `30 Minutes`, `1 Hour`, `2 Hours`, or `6 Hours`.
     - **Audio Chime**: Synthesizes a soft, pleasant two-tone offline chime via the Web Audio API whenever a reminder pops up.
     - **Low Balance Repeated Alerts**: Option to repeatedly pop up alerts if either account balance stays below ₹500.
     - **Device Lock Screen / System Alerts**: Integrated with the Web Notification API and Service Worker (`sw.js` cache-v6) to display alerts on your device's lock screen even when the app is in the background.
     - **Test Pop-up Button**: Instant test button to verify the audio chime and pop-up card immediately.
   - **Interactive Pop-Up Actions**:
     - Whenever a reminder pops up, it offers two direct buttons: **`[ ✓ I Paid (Deduct BOB) ]`** and **`[ Remind Later ]`**.
     - Tapping **"I Paid"** stops all future pop-ups for that reimbursement, deducts the amount from your BOB account, records the settlement transaction, and opens WhatsApp confirmation automatically.

3. **Dual-Account Expense Recording (BOB & ICICI)**:
   - Dedicated selector between **BOB** and **ICICI** with live balance preview.
   - Categorization: Food & Dining, Groceries, Shopping, Travel & Fuel, Bills & Utilities, Entertainment, Health & Medical, Education, and Other.
   - Required **"For What" (Description)** and **"To Whom" (Paid To / Payee)** fields.
   - **Precision Timestamps**: Defaults to automatic live timestamp right at the second of saving, with an optional **"Pick Custom Time"** button.

3. **Low Balance Alert (< ₹500)**:
   - Automatic real-time warning alert banner and badge when either BOB or ICICI balance drops below **₹500**.
   - Clear visual indicators to prevent accidental overdrafts.

4. **Monthly Insights & Analytics**:
   - **Top Spending Category Highlight**: Instantly shows the category where you spent the most money and its percentage.
   - **End-of-Month Leftover Balance**: Displays the total remaining funds at the end of the month.
   - **Account Breakdown**: Compares BOB spending vs ICICI spending.
   - **Top Payees / Recipients**: Shows who you paid the most money to.

5. **Desktop & Mobile Responsive Layout**:
   - **Desktop View (≥ 860px)**: Left-side panel menu bar with silhouette navigation icons, live account balances, and an expansive workspace.
   - **Mobile View (< 860px)**: Compact mobile screen layout with bottom navigation bar for single-thumb control.

6. **100% Offline & Mobile Widget Support**:
   - **No login required** — all transactions are stored locally on your device (`localStorage`).
   - **Runs without Laptop**: Caches locally via Service Worker (`sw.js`).
   - **Mobile Home Screen Widget**: Includes a compact widget view and PWA app shortcuts (+ Quick Expense, Widget).

---

## 📱 How to Use on Your Mobile Phone (Offline & No Laptop Needed)

### Method 1: Host Free with 1-Click (Recommended)
You can deploy this folder to **GitHub Pages**, **Netlify Drop** (drag & drop), or **Vercel** for free:
1. Open your private link on your mobile phone browser (Chrome, Safari, etc.).
2. On **Android (Chrome)**: Tap the 3 dots (`⋮`) at top right -> Tap **"Add to Home screen"** or **"Install app"**.
3. On **iPhone (Safari)**: Tap the Share button (`⎋`) at bottom -> Tap **"Add to Home Screen"**.
4. **Done!** The app is now installed on your phone. You can turn off your laptop, turn off Wi-Fi/Mobile Data, and open TrackFlow directly from your mobile home screen anytime.

### Method 2: Transfer `standalone.html` Directly
Send [standalone.html](standalone.html) to your phone via WhatsApp, Email, or Bluetooth and open it in Chrome/Safari.

---

## Security configuration required

The server now requires deployment environment variables for authentication. Do not commit real phone numbers or passwords to this repository.

For local development, the server reads a root-level `.env` file automatically (without overriding variables already set by the host). For production, configure the same values in your hosting provider's environment settings. The `.env` file is ignored by Git; never commit it.

Set these variables in `.env` or your hosting provider before starting the server:

- `TRACKFLOW_PRIMARY_PHONE`: primary user's 10-digit phone number
- `TRACKFLOW_PARTNER_PHONE`: partner user's 10-digit phone number
- `TRACKFLOW_PASSWORD`: the shared login password for both authorized users
- `TRACKFLOW_TOKEN_SECRET`: a separate, randomly generated secret used to sign login tokens (recommended; do not reuse the password)
- `TRACKFLOW_PRIMARY_NAME` and `TRACKFLOW_PARTNER_NAME`: optional display names
- `TRACKFLOW_ALLOWED_ORIGIN`: exact browser origin of the deployed frontend (for example, `https://your-app.example`); set this when the frontend and API use different origins

The server refuses login when the account passwords are not configured. Existing client-only sessions are no longer accepted. After deploying this change, configure the environment variables and sign in again on every device. Rotate any credentials that were previously committed to source control. The server stores newly changed passwords as salted scrypt hashes.

## 💻 Running on Laptop

- **Quick Start**:
  ```bash
  node server.js
  ```
  Open `http://localhost:3000` in any browser.
- Or simply open [index.html](index.html) or [standalone.html](standalone.html) directly!
