const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const TOKEN_FILE = ".twitch-state.enc";

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing GitHub secret: ${name}`);
  }

  return value;
}

async function main() {
  const clientId = required("TWITCH_CLIENT_ID");
  const clientSecret = required("TWITCH_CLIENT_SECRET");
  const initialRefreshToken = required("TWITCH_REFRESH_TOKEN");

  // Keep saved tokens encrypted and outside the public website.
  const key = crypto
    .createHash("sha256")
    .update(clientSecret)
    .digest();

  async function saveTokens(tokens) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(tokens), "utf8"),
      cipher.final()
    ]);

    await fs.writeFile(
      TOKEN_FILE,
      Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    );
  }

  let tokens;

  try {
    const saved = await fs.readFile(TOKEN_FILE);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      saved.subarray(0, 12)
    );

    decipher.setAuthTag(saved.subarray(12, 28));

    tokens = JSON.parse(
      Buffer.concat([
        decipher.update(saved.subarray(28)),
        decipher.final()
      ]).toString("utf8")
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error("Could not decrypt saved Twitch tokens.");
    }

    tokens = { refresh_token: initialRefreshToken };
  }

  function mask(value) {
    if (process.env.GITHUB_ACTIONS && value) {
      console.log(`::add-mask::${value}`);
    }
  }

  mask(tokens.access_token);
  mask(tokens.refresh_token);

  async function refresh() {
    const response = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokens.refresh_token
        }),
        signal: AbortSignal.timeout(30000)
      }
    );

    if (!response.ok) {
      throw new Error(
        `Twitch token refresh failed (${response.status}). ` +
        "Your Twitch authorisation may need renewing."
      );
    }

    const result = await response.json();

    if (!result.access_token || !result.refresh_token) {
      throw new Error("Twitch returned an incomplete token response.");
    }

    mask(result.access_token);
    mask(result.refresh_token);

    tokens = {
      access_token: result.access_token,
      refresh_token: result.refresh_token
    };

    await saveTokens(tokens);
  }

  if (!tokens.access_token) {
    await refresh();
  }

  async function api(path) {
    async function request() {
      return fetch(`https://api.twitch.tv/helix/${path}`, {
        headers: {
          "Client-Id": clientId,
          Authorization: `Bearer ${tokens.access_token}`
        },
        signal: AbortSignal.timeout(30000)
      });
    }

    let response = await request();

    if (response.status === 401) {
      await refresh();
      response = await request();
    }

    if (!response.ok) {
      throw new Error(
        `Twitch API request failed (${response.status}): ` +
        path.split("?")[0]
      );
    }

    return response.json();
  }

  const users = await api("users?login=taximals");
  const user = users.data?.[0];

  if (!user) {
    throw new Error("Could not find the taximals Twitch channel.");
  }

  const followers = await api(
    `channels/followers?broadcaster_id=${user.id}&first=1`
  );

  const subscriptions = await api(
    `subscriptions?broadcaster_id=${user.id}&first=1`
  );

  if (
    !Number.isInteger(followers.total) ||
    !Number.isInteger(subscriptions.total)
  ) {
    throw new Error("Twitch did not return valid follower/subscriber totals.");
  }

  const data = {
    collectedAt: new Date().toISOString(),
    source: "Twitch API",
    stats: [
      {
        label: "Twitch followers",
        value: followers.total.toLocaleString("en-AU")
      },
      {
        label: "Twitch subscribers",
        value: subscriptions.total.toLocaleString("en-AU")
      }
    ]
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/data.json",
    JSON.stringify(data, null, 2)
  );

  console.log("Collected Twitch follower and subscriber totals.");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
