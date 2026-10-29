const assert = require("node:assert/strict");
const test = require("node:test");
const app = require("../src/app");

test("API responses explicitly disable HTTP caching", async () => {
  const server = app.listen(0);
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/health`
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
