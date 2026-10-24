const { chromium } = require("playwright");
const fs = require("node:fs/promises");

async function main() {
  const browser = await chromium.launch();
  let page;

  try {
    page = await browser.newPage();
    page.setDefaultTimeout(60000);

    await page.goto("https://beacons.ai/taximals/mediakit", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Twitch is the default section. Wait for its stats to load.
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          /AVG CONCURRENT VIEWERS/i.test(text) &&
          /30 DAY WATCH HOURS/i.test(text)
        );
      },
      { timeout: 60000 }
    );

    const text = await page.locator("body").innerText();

    function read(label) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = text.match(
        new RegExp(
          escaped + "\\s+([\\d,.]+\\s*[kKmM]?)",
          "i"
        )
      );

      if (!match) {
        throw new Error("Could not read: " + label);
      }

      return match[1].trim();
    }

    // Limit the follower search to the Twitch summary.
    const summaryStart = text.search(/AVG STREAM VIEWS/i);
    const precedingText = text.slice(0, summaryStart);
    const followerMatches = [
      ...precedingText.matchAll(
        /\bFOLLOWERS\s+([\d,.]+\s*[kKmM]?)/gi
      )
    ];

    if (!followerMatches.length) {
      throw new Error("Could not read Twitch followers");
    }

    const followers = followerMatches.at(-1)[1].trim();

    const sync = text.match(
      /Data from last 30 days\s*\/\s*Last updated\s+([^\n]+)/i
    );

    const data = {
      collectedAt: new Date().toISOString(),
      beaconsUpdated: sync ? sync[1].trim() : "Not specified",
      stats: [
        {
          label: "Twitch followers",
          value: followers
        },
        {
          label: "Average concurrent viewers",
          value: read("AVG CONCURRENT VIEWERS")
        },
        {
          label: "Maximum concurrent viewers",
          value: read("MAX CONCURRENT VIEWERS")
        },
        {
          label: "Hours streamed",
          value: read("TOTAL HOURS STREAMED")
        },
        {
          label: "30-day watch hours",
          value: read("30 DAY WATCH HOURS")
        }
      ]
    };

    await fs.mkdir("public", { recursive: true });

    await fs.writeFile(
      "public/data.json",
      JSON.stringify(data, null, 2)
    );

    console.log("Collected stats successfully:");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    // Show what actually loaded if the stats were unavailable.
    if (page) {
      console.error("Page URL:", page.url());
      console.error(
        "Page text:",
        (await page.locator("body").innerText()
          .catch(() => "Unable to read page")).slice(0, 12000)
      );
    }

    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
