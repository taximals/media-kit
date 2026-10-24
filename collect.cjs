const { chromium } = require("playwright");
const fs = require("node:fs/promises");

async function main() {
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);

    await page.goto("https://beacons.ai/taximals/mediakit", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.getByRole("button", {
      name: "Social Analytics - twitch - taximals",
      exact: true
    }).click();

    const panel = page.getByRole("button", {
      name: /^Twitch - social stats title/
    });

    await panel.getByText("AVG CONCURRENT VIEWERS", {
      exact: true
    }).waitFor();

    const text = await panel.innerText();

    function read(label) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = text.match(
        new RegExp(escaped + "\\s+([\\d,.]+\\s*[kKmM]?)")
      );

      if (!match) {
        throw new Error("Could not read: " + label);
      }

      return match[1].trim();
    }

    const sync = text.match(
      /Data from last 30 days\s*\/\s*Last updated\s+([^\n]+)/i
    );

    const data = {
      collectedAt: new Date().toISOString(),
      beaconsUpdated: sync ? sync[1].trim() : "Not specified",
      stats: [
        { label: "Twitch followers", value: read("FOLLOWERS") },
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

    console.log(JSON.stringify(data, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
