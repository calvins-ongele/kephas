const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

// ==================== HELPER FUNCTIONS ====================
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==================== CONFIGURATION ====================
const CONFIG = {
  projectId: "centering-valve-501309-m8",
  emailsToAdd: ["test1@yourdomain.com"],
  profileDir: path.join(__dirname, "chrome-profile"),
  timeout: 30000,
  debug: true,
};

// ==================== MAIN AUTOMATION CLASS ====================
class GoogleCloudAutomation {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.profileDir = config.profileDir;
    this.sessionFile = path.join(this.profileDir, "session.json");
  }

  async createBrowser(headless = true) {
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }

    if (this.browser) {
      await this.browser.close();
    }

    if (this.config.debug) {
      headless = false;
    }

    const launchConfig = {
      headless: headless ? "new" : false,
      userDataDir: this.profileDir,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        ...(headless
          ? [
              "--disable-gpu",
              "--disable-software-rasterizer",
              "--disable-extensions",
              "--disable-sync",
              "--no-first-run",
            ]
          : []),
      ],
    };

    console.log(
      ` Launching browser in ${headless ? "HEADLESS" : "VISIBLE"} mode...`,
    );
    this.browser = await puppeteer.launch(launchConfig);
    return this.browser;
  }

  async createPage() {
    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

    const page = await this.browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent({
      userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

    page.setDefaultTimeout(this.config.timeout);
    page.setDefaultNavigationTimeout(this.config.timeout);

    return page;
  }

  async checkSessionValid(page) {
    try {
      console.log(" Checking session...");

      await page.goto("https://console.cloud.google.com", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      const isLoggedIn = await page.evaluate(() => {
        const isNotLoginPage = !window.location.href.includes(
          "accounts.google.com",
        );
        const accountElements = document.querySelectorAll(
          '[aria-label*="Google Account"], [aria-label*="account"], .gb_ua, .gb_va, [data-ogac]',
        );
        const hasCloudConsoleHeader =
          document.querySelector('[data-test-id="header"]') !== null;
        const hasProjectSelector =
          document.querySelector('[aria-label*="project"]') !== null;

        return (
          isNotLoginPage &&
          (accountElements.length > 0 ||
            hasCloudConsoleHeader ||
            hasProjectSelector)
        );
      });

      console.log(`Session: ${isLoggedIn ? " VALID" : " INVALID"}`);
      return isLoggedIn;
    } catch (error) {
      console.error("Session check error:", error.message);
      return false;
    }
  }

 async manualLogin() {
  console.log("\n=== MANUAL LOGIN REQUIRED ===");
  console.log("Switching to visible browser for login...");

  if (this.browser) {
    await this.browser.close();
  }

  await this.createBrowser(false);
  let page = await this.createPage();

  console.log("\n Login Instructions:");
  console.log("1. Log in with your Google account");
  console.log("2. Complete 2FA if prompted");
  console.log("3. Wait for Google Cloud Console to load");
  console.log("4. Script will auto-detect successful login\n");

  // Navigate directly to the audience page so we know exactly where to expect
  const targetUrl = `https://console.cloud.google.com/auth/audience?project=${this.config.projectId}`;
  await page.goto(targetUrl, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  console.log(" Waiting for login...");

  try {
    // Wait for URL to be on the actual audience page (not signin, not redirect chain)
    await page.waitForFunction(
      (projectId) => {
        const url = window.location.href;
        
        // Must NOT be on any google auth page
        if (url.includes("accounts.google.com")) return false;
        if (url.includes("ServiceLogin")) return false;
        if (url.includes("flowName=GlifWebSignIn")) return false;
        
        // Must be on console.cloud.google.com
        if (!url.includes("console.cloud.google.com")) return false;
        
        // The path must actually contain /auth/audience (not just in query string)
        try {
          const u = new URL(url);
          if (!u.pathname.includes("/auth/audience")) return false;
        } catch (e) {
          return false;
        }
        
        // Must have real signed-in indicators - account avatar with content
        const accountBtn = document.querySelector('[aria-label*="Google Account"]');
        if (!accountBtn) return false;
        
        // Check that the avatar actually contains an image or initial (proves logged in)
        const avatarImg = accountBtn.querySelector('img');
        if (avatarImg && avatarImg.src && avatarImg.src.length > 0) return true;
        
        // Or look for the project selector which only appears when logged in
        const projectSelector = document.querySelector('[aria-label*="project" i]');
        if (projectSelector) return true;
        
        return false;
      },
      { timeout: 300000, polling: 2000 },
      this.config.projectId
    );
  } catch (error) {
    console.error(" Login timeout");
    await page.screenshot({ path: "logs/login-timeout.png", fullPage: true });
    throw error;
  }

  console.log(" Login successful! Saving session...");

  const cookies = await page.cookies();
  fs.writeFileSync(
    path.join(this.profileDir, "cookies.json"),
    JSON.stringify(cookies, null, 2)
  );

  fs.writeFileSync(
    this.sessionFile,
    JSON.stringify(
      {
        lastLogin: new Date().toISOString(),
        sessionValid: true,
      },
      null,
      2
    )
  );

  // Small settle delay before closing
  await delay(1500);

  await this.browser.close();
  console.log("🔄 Switching to headless mode...");
  await this.createBrowser(true);

  return true;
}

  isOnSignInPage(url) {
    return (
      url.includes("accounts.google.com") ||
      url.includes("/signin") ||
      url.includes("ServiceLogin") ||
      url.includes("flowName=GlifWebSignIn") ||
      url.includes("flowEntry=ServiceLogin")
    );
  }

  isOnAudiencePage(url) {
    // must be on console.cloud.google.com
    if (!url.includes("console.cloud.google.com")) {
      return false;
    }
    //must not be on signin page
    if (this.isOnSignInPage(url)) {
      return false;
    }

    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      return (
        pathname.includes("/auth/audience") || pathname.includes("/audience")
      );
    } catch (error) {
      //does the auth/audience appear before the query string? if so, we can check for that
      const queryIndex = url.indexOf("?");
      const pathPart = queryIndex !== -1 ? url.substring(0, queryIndex) : url;
      return (
        pathPart.includes("/auth/audience") || pathPart.includes("/audience")
      );
    }
  }
  // ==================== EMAIL AUTOMATION ====================

  async navigateToAudiencePage(page) {
    const url = `https://console.cloud.google.com/auth/audience?project=${this.config.projectId}`;
    console.log(` Navigating to: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
    } catch (error) {
      console.log(
        "  Initial navigation timed out, waiting for page to settle...",
      );
      await delay(5000);
    }

    console.log(" Waiting for page to render...");
    await delay(3000);

    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    if (this.isOnSignInPage(currentUrl)) {
      console.log("  Redirected to sign-in page");
      throw new Error("SESSION_EXPIRED"); // let run() handle it
    }

    if (!this.isOnAudiencePage(currentUrl)) {
      console.log("  Not on audience page");
      throw new Error("SESSION_EXPIRED"); // or a different error
    }

    console.log(" Audience page loaded");

    await page.screenshot({
      path: "logs/audience-page-loaded.png",
      fullPage: true,
    });
  }

  async addSingleEmail(page, email) {
    console.log(`\n Processing: ${email}`);

    try {
      // STEP 1: Click "Add Users" button
      console.log('  Step 1: Clicking "Add Users" button...');
      const addButtonClicked = await this.clickAddUsersButton(page);
      if (!addButtonClicked)
        throw new Error("Could not click Add Users button");
      console.log("  ✓ Add Users button clicked");

      // STEP 2: Wait for side panel
      console.log("  Step 2: Waiting for side panel...");
      await delay(2000);
      await page.screenshot({ path: "logs/panel-opened.png", fullPage: true });

      // STEP 3: Type email and create chip
      console.log("  Step 3: Typing email...");
      const emailEntered = await this.fillEmailInput(page, email);
      if (!emailEntered) throw new Error("Could not enter email");
      console.log(`  ✓ Email "${email}" entered`);

      await page.screenshot({ path: "logs/email-entered.png", fullPage: true });

      // STEP 4: Press Enter to add as chip
      console.log("  Step 4: Pressing Enter to create chip...");
      await page.keyboard.press("Enter");
      await delay(1000);

      // STEP 5: First click on Save - prepares validation
      console.log("  Step 5: First click on Save (prepare)...");
      const saveButton = await page.waitForSelector(
        'button[aria-label="Save"][type="submit"]',
        {
          timeout: 5000,
          visible: true,
        },
      );
      await saveButton.click();
      console.log("  ✓ First click done");

      // STEP 6: Wait 3 seconds for validation to complete
      console.log("  Step 6: Waiting 3 seconds for validation...");
      await delay(2000);

      // STEP 7: Second click on Save - submits the form
      console.log("  Step 7: Second click on Save (submit)...");
      await saveButton.click();
      console.log("  ✓ Second click done");

      // STEP 8: Wait for save to complete
      console.log("  Step 8: Waiting for save to complete...");
      await delay(3000);

      await page.screenshot({
        path: `logs/after-adding-${email.replace(/[@.]/g, "-")}.png`,
        fullPage: true,
      });

      // STEP 9: Verify
      const verified = await this.verifyEmailAdded(page, email);
      console.log(
        `  ${verified ? "✓" : "⚠️"} Verification: ${verified ? "Email found on page" : "Email not found"}`,
      );

      return verified;
    } catch (error) {
      console.error(` Error adding ${email}:`, error.message);
      await page.screenshot({
        path: `logs/error-${email.replace(/[@.]/g, "-")}.png`,
        fullPage: true,
      });
      return false;
    }
  }

  async clickAddUsersButton(page) {
    const strategies = [
      async () => {
        const buttons = await page.$$('button, span, a, div[role="button"]');
        for (const button of buttons) {
          const text = await page.evaluate(
            (el) => el.textContent?.trim(),
            button,
          );
          if (
            text === "Add users" ||
            text === "ADD USERS" ||
            text === "Add user"
          ) {
            const box = await button.boundingBox();
            if (box) {
              console.log(`  Found button: "${text}"`);
              return button;
            }
          }
        }
        return null;
      },
      async () => {
        const xpaths = [
          "//button[contains(text(), 'Add users')]",
          "//span[contains(text(), 'Add users')]/parent::button",
        ];
        for (const xpath of xpaths) {
          const [element] = await page.$x(xpath);
          if (element) {
            const box = await element.boundingBox();
            if (box) return element;
          }
        }
        return null;
      },
    ];

    for (const strategy of strategies) {
      const button = await strategy();
      if (button) {
        await button.click();
        return true;
      }
    }
    return false;
  }

  async fillEmailInput(page, email) {
    const selectors = [
      'input[aria-label="Text field for emails"]',
      "input.mat-mdc-chip-input",
      'input[id*="mat-mdc-chip-list-input"]',
      ".mdc-evolution-chip-set__chips input",
    ];

    let inputField = null;

    for (const selector of selectors) {
      try {
        const elements = await page.$$(selector);
        for (const el of elements) {
          const box = await el.boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            inputField = el;
            console.log(`  ✓ Found input: ${selector}`);
            break;
          }
        }
        if (inputField) break;
      } catch (e) {
        continue;
      }
    }

    if (!inputField) {
      console.log(" Could not find email input");
      return false;
    }

    // Focus and type
    await inputField.focus();
    await delay(300);
    await inputField.click({ clickCount: 3 });
    await delay(200);
    await inputField.type(email, { delay: 50 });
    await delay(500);

    return true;
  }

  async verifyEmailAdded(page, email) {
    try {
      await delay(2000);
      const emailOnPage = await page.evaluate((searchEmail) => {
        return document.body.innerText.includes(searchEmail);
      }, email);
      return emailOnPage;
    } catch (error) {
      return false;
    }
  }

  async addAllEmails() {
    const page = await this.createPage();
    try {
        await this.navigateToAudiencePage(page);
    } catch (error) { 
        console.log(" Session expired during navigation. Please log in again:: ", error);  
        if (error.message === "SESSION_EXPIRED") {
           throw new Error("SESSION_EXPIRED");   
        }
    }

    console.log(
      `\n Starting to add ${this.config.emailsToAdd.length} email(s)...`,
    );

    const results = { successful: [], failed: [] };

    for (let i = 0; i < this.config.emailsToAdd.length; i++) {
      const email = this.config.emailsToAdd[i];
      console.log(`\n[${i + 1}/${this.config.emailsToAdd.length}]`);

      const success = await this.addSingleEmail(page, email);

      if (success) {
        results.successful.push(email);
      } else {
        results.failed.push(email);
      }

      if (i < this.config.emailsToAdd.length - 1) {
        console.log(" Waiting before next email...");
        await delay(2000);
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log(" SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total emails: ${this.config.emailsToAdd.length}`);
    console.log(` Successfully added: ${results.successful.length}`);
    console.log(` Failed: ${results.failed.length}`);

    if (results.successful.length > 0) {
      console.log("\nSuccessful:");
      results.successful.forEach((e) => console.log(`  ✓ ${e}`));
    }
    if (results.failed.length > 0) {
      console.log("\nFailed:");
      results.failed.forEach((e) => console.log(`  ✗ ${e}`));
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      `logs/results-${timestamp}.json`,
      JSON.stringify(results, null, 2),
    );
    console.log(`\n Results saved to logs/results-${timestamp}.json`);

    return results;
  }

  async run() {
    console.log(" Google Cloud OAuth Audience Email Automation");
    console.log("=".repeat(50));
    //console.log(`Project ID: ${this.config.projectId}`);
    console.log(`Emails to add: ${this.config.emailsToAdd.length}`);
    console.log(
      `Debug mode: ${this.config.debug ? "ON (Visible)" : "OFF (Headless)"}`,
    );
    console.log("=".repeat(50) + "\n");

    try {
      // Initial launch: visible if debug, headless otherwise
      await this.createBrowser(!this.config.debug);
      const page = await this.createPage();

      const isSessionValid = await this.checkSessionValid(page);

      if (!isSessionValid) {
        console.log("  Session required. Initiating manual login...");
        await this.manualLogin(); // This handles its own visible → headless switch
      } else {
        console.log(" Using existing session");
      }

      const results = await this.addAllEmails();

      console.log("\n Automation completed!");
      return results;
    } catch (error) {
      if (error.message === "SESSION_EXPIRED") {
        console.log("\n  Session expired while running. Please log in again.");
        try {
          await this.manualLogin();
          const results = await this.addAllEmails();
          console.log("\n Automation completed after re-login!");
          return results;
        } catch (loginError) {
          console.error("\n Re-login failed:", loginError.message);
          throw loginError;
        }
      }
      throw error;
    } finally {
      if (this.browser) {
        await this.browser.close();
        console.log("🔒 Browser closed");
      }
    }
  }
  // ==================== END OF CLASS ====================
}

module.exports = GoogleCloudAutomation;
