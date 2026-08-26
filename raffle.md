# Copify Raffle Automation Architecture & Playbook

**Document:** `raffle.md`  
**Target Focus:** Scaling multi-profile entries for high-resale sneaker and streetwear raffles (EQL, Shopify Form Raffles, Boutique Apps).  
**Primary Location Strategy:** Portugal / EU Financial & Network Integration.

---

## 1. The Raffle Paradigm Shift: Speed vs. Scale

First-Come, First-Served (FCFS) botting relies on **millisecond execution speed** and direct-carting. In contrast, **Raffle Automation** relies on **scale, identity isolation, and fraud-score evasion**. 

Instead of running 3 ultra-fast sessions, a successful raffle workflow submits **20 to 100+ entries** over several hours or days. The primary enemy is not stock sell-out speed, but **backend deduplication and machine-learning trust scoring** (such as EQL’s "Run Fair" algorithms) which penalize duplicate payments, shared IPs, and linked browser parameters.

---

## 2. The 5 Pillars of Isolated Raffle Personas

Every entry must look like a completely independent human being. Reusing any variable across multiple entries results in automated filtering.

### Pillar A: Identity Matrix & Address Jigging
*   **Catch-All Emails:** Use your Namecheap or Name.com domain configured with a catch-all forwarder. Generate clean, unique handles per profile (e.g., `profile.01@yourdomain.com`).
*   **Address Jigging:** Systematically mutate street addresses to prevent database matching while remaining 100% deliverable by local postal carriers.
    *   *Base:* `Rua Augusta 123, 1100-053 Lisboa`
    *   *Jig 1:* `Rua Augusta 123, 3º Esq, 1100-053 Lisboa`
    *   *Jig 2:* `R. Augusta, No. 123, Andar 3D, 1100-053 Lisboa`
    *   *Jig 3:* `Rua Augusta, 123 - Apt A, 1100-053 Lisboa`

### Pillar B: Financial Persona Diversification (Portuguese Context)
Platforms like EQL track Bank Identification Numbers (BINs) and digital wallet source signatures. Spamming 20 virtual cards from a single Revolut account creates a glaring footprint. 
*   **The Portuguese Multi-Source Strategy:**
    1.  **Revolut (Portugal):** Create multiple independent virtual cards.
    2.  **MB WAY / MB NET:** Generate single-use or multi-use virtual cards across different traditional Portuguese banking apps (Millennium BCP, CGD, Santander, Novo Banco, etc.).
    3.  **European Neobanks:** Integrate accounts from N26, Wise, or Vivid Money operating in the EU.
    4.  **Household Network:** Secure explicit permission from family members to utilize their names and separate banking profiles to introduce entirely clean financial origins.
*   **Understanding Holds:** EQL places a temporary zero-dollar or low-value authorization hold to verify card activity. Actual charges occur only upon winning. Maintain sufficient balances or utilize credit lines to prevent authorization rejections during draw periods.

### Pillar C: Network Isolation (DataImpulse)
*   Never submit multiple entries from your home IP router or sequential proxy subnets.
*   Assign a unique **Sticky Residential Proxy** port (e.g., ports `10000` through `10020`) to every single raffle profile. Every entry must originate from a geographically distinct residential IP address.

### Pillar D: Browser & Fingerprint Isolation
*   Never run multiple entries inside standard open tabs of a single browser instance.
*   Leverage Copify’s persistent Chrome profiles (`userDataDir`) combined with stealth patching (`rebrowser-patches`) to ensure isolated cookies, local storage, hardware canvas, and WebGL telemetry.

### Pillar E: Automated SMS Verification
*   Integrate **Hero-SMS** API endpoints into Copify to programmatically fetch disposable, unique phone numbers and inject One-Time Passwords (OTPs) during account registration or entry validation.

---

## 3. Target Breakdown: EQL vs. Shopify Form Raffles

### 1. EQL ("Run Fair") Raffles
*   **Used By:** Stüssy, Undefeated, A Ma Maniére, Concepts, Crocs, etc.
*   **Mechanics:** Accepts all entries silently during the entry window. Evaluates hundreds of signals on the backend using AI and machine learning. Penalizes duplicate profiles, linked payment methods, and flagged proxies.
*   **Automation Approach:** Requires full profile isolation, strict VCC diversification, and clean residential proxies.

### 2. Standard Shopify Form Raffles (ViralSweep, Typeform, Custom Themes)
*   **Mechanics:** Simpler embedded forms requiring name, email, size, and address data.
*   **Automation Approach:** Can be fully automated via lightweight HTTP `POST` requests or headless automation combined with an automated CAPTCHA solver API (CapSolver).

---

## 4. Automated Verification Hooks

To prevent manual bottlenecks, raffle automation requires background listeners:
1.  **IMAP Catch-All Listener:** Automatically connects to your domain's mail server via `node-imap`. When a boutique sends an email stating *"Confirm your entry to the draw,"* the script parses the HTML body, extracts the unique confirmation token link, and triggers a background HTTP GET request to verify the entry instantly.
2.  **SMS API Integrations:** Hooks directly into Hero-SMS to poll for incoming verification texts and populate form fields without human intervention.

---

## 5. Copify Raffle Workflow & Tracking Matrix

Set up a structured matrix in your tracking document (Google Docs or local SQLite database) for every batch drop:

| Profile ID | Proxy Port | Catch-All Email | Hero-SMS Number | Jigged Address | Payment Source | Target Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `raffle-01` | `10000` | `profile.01@domain.com` | `+35191xxxxx01` | `Jigged Addr A` | Revolut VCC #1 | Armed |
| `raffle-02` | `10001` | `profile.02@domain.com` | `+35191xxxxx02` | `Jigged Addr B` | MB WAY Card #1 | Armed |
| `raffle-03` | `10002` | `profile.03@domain.com` | `+35191xxxxx03` | `Jigged Addr C` | N26 Virtual #1 | Armed |

---

## 6. Required Copify Features for Future Raffle Support

To transition Copify from an FCFS checkout engine into a dual-purpose FCFS + Raffle suite, future architectural extensions will include:
1.  **Batch Identity Generator:** A utility tool to automatically spit out randomized jigged address variants and assign unique catch-all prefixes.
2.  **IMAP Verification Worker:** A background service listening to your domain mail server to auto-confirm verification emails.
3.  **Multi-Profile Submission Queue:** A dedicated execution scheduler that paces form submissions across multiple proxy routes over a defined time window (e.g., submitting 1 entry every 30 seconds to look organic) rather than firing everything simultaneously.