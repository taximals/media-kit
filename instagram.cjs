const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const TOKEN_FILE = ".instagram-state.enc";
const RENEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

async function main() {
  const initialToken =
    process.env.INSTAGRAM_ACCESS_TOKEN?.trim();

  // Reuse the existing secret as an encryption key.
  const encryptionSecret =
    process.env.TWITCH_CLIENT_SECRET?.trim();

  if (!initialToken) {
    throw new Error(
      "Missing GitHub secret: INSTAGRAM_ACCESS_TOKEN"
    );
  }

  if (!encryptionSecret) {
    throw new Error(
      "Missing GitHub secret: TWITCH_CLIENT_SECRET"
    );
  }

  const key = crypto
    .createHash("sha256")
    .update(encryptionSecret)
    .digest();

  function mask(value) {
    if (process.env.GITHUB_ACTIONS && value) {
      console.log(`::add-mask::${value}`);
    }
  }

  async function saveState(state) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      key,
      iv
    );

    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(state), "utf8"),
      cipher.final()
    ]);

    await fs.writeFile(
      TOKEN_FILE,
      Buffer.concat([
        iv,
        cipher.getAuthTag(),
        encrypted
      ])
    );
  }

  let state;

  try {
    const saved = await fs.readFile(TOKEN_FILE);

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      saved.subarray(0, 12)
    );

    decipher.setAuthTag(saved.subarray(12, 28));

    state = JSON.parse(
      Buffer.concat([
        decipher.update(saved.subarray(28)),
        decipher.final()
      ]).toString("utf8")
    );

    if (
      typeof state.accessToken !== "string" ||
      !state.accessToken ||
      !Number.isFinite(state.lastRenewedAt)
    ) {
      throw new Error("Invalid saved token state.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(
        "Could not read or decrypt saved Instagram tokens."
      );
    }

    // Your newly generated token has approximately 60 days left.
    // Wait a week before attempting its first renewal.
    state = {
      accessToken: initialToken,
      lastRenewedAt: Date.now()
    };

    await saveState(state);
  }

  mask(state.accessToken);

  if (Date.now() - state.lastRenewedAt >= RENEW_AFTER_MS) {
    const refreshUrl = new URL(
      "https://graph.instagram.com/refresh_access_token"
    );

    refreshUrl.searchParams.set(
      "grant_type",
      "ig_refresh_token"
    );

    refreshUrl.searchParams.set(
      "access_token",
      state.accessToken
    );

    const refreshResponse = await fetch(refreshUrl, {
      signal: AbortSignal.timeout(30000)
    });

    const refreshed = await refreshResponse.json();

    if (
      !refreshResponse.ok ||
      refreshed.error ||
      !refreshed.access_token
    ) {
      const code =
        refreshed.error?.code ?? refreshResponse.status;

      throw new Error(
        `Instagram token renewal failed (code ${code}). ` +
        "The token may require reauthorisation."
      );
    }

    mask(refreshed.access_token);

    state = {
      accessToken: refreshed.access_token,
      lastRenewedAt: Date.now()
    };

    // Save immediately, even if the later stats request fails.
    await saveState(state);

    console.log("Instagram token renewed successfully.");
  } else {
    console.log("Instagram token renewal is not due yet.");
  }

  const profileUrl = new URL(
    "https://graph.instagram.com/v25.0/me"
  );

  profileUrl.searchParams.set(
    "fields",
    "user_id,username,followers_count,media_count"
  );

  const response = await fetch(profileUrl, {
    headers: {
      Authorization: `Bearer ${state.accessToken}`
    },
    signal: AbortSignal.timeout(30000)
  });

  const result = await response.json();

  if (!response.ok || result.error) {
    const code = result.error?.code ?? response.status;

    throw new Error(
      `Instagram API failed (code ${code}). ` +
      "Check the token, its expiry and account permissions."
    );
  }

  if (result.username?.toLowerCase() !== "taximalsvt") {
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

main().catch(() => {
  // Avoid logging request URLs or error objects containing tokens.
  console.error(
    "Instagram collection or renewal failed. " +
    "Check the preceding messages and GitHub secrets."
  );
  process.exitCode = 1;
});
