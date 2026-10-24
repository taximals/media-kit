const fs = require("node:fs/promises");

async function main() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "Missing GitHub secret: INSTAGRAM_ACCESS_TOKEN"
    );
  }

  const url = new URL(
    "https://graph.instagram.com/v25.0/me"
  );

  url.searchParams.set(
    "fields",
    "user_id,username,followers_count,media_count"
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(30000)
  });

  const result = await response.json();

  if (!response.ok || result.error) {
    const code = result.error?.code ?? response.status;

    throw new Error(
      `Instagram API failed (code ${code}). ` +
      "Check the token, its expiry and the account permissions."
    );
  }

  if (
    result.username?.toLowerCase() !== "taximalsvt"
  ) {
    throw new Error(
      "The Instagram token does not belong to taximalsvt."
    );
  }

  function formatCount(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Instagram did not return a valid ${label}.`
      );
    }

    return value.toLocaleString("en-AU");
  }

  const instagramStats = [
    {
      label: "Instagram followers",
      value: formatCount(
        result.followers_count,
        "follower count"
      )
    },
    {
      label: "Instagram posts",
      value: formatCount(
        result.media_count,
        "post count"
      )
    }
  ];

  // Twitch creates this file; YouTube adds its stats.
  const data = JSON.parse(
    await fs.readFile("public/data.json", "utf8")
  );

  if (!Array.isArray(data.stats)) {
    throw new Error(
      "The existing stats file has an unexpected format."
    );
  }

  data.stats = [
    ...data.stats.filter(
      stat => !stat.label.startsWith("Instagram ")
    ),
    ...instagramStats
  ];

  data.source =
    "Twitch API + YouTube Data API + Instagram API";

  data.instagramCollectedAt = new Date().toISOString();

  await fs.writeFile(
    "public/data.json",
    JSON.stringify(data, null, 2)
  );

  console.log(
    "Collected Instagram follower and post counts."
  );
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
