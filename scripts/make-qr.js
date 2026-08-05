// Generate an install QR code PNG that points to a URL.
//
// Usage:
//   node scripts/make-qr.js https://your-app-url
//   (defaults to http://localhost:3000 if no URL given)
//
// Requires the 'qrcode' package (installed on demand via npx if missing).
// Output: app/install-qr.png

const path = require("path");

async function main() {
  const url = process.argv[2] || "http://localhost:3000";
  const out = path.join(__dirname, "..", "app", "install-qr.png");
  let QRCode;
  try {
    QRCode = require("qrcode");
  } catch (e) {
    console.error(
      "The 'qrcode' package isn't installed.\n" +
        "Run once:  npx --yes qrcode " +
        `"${url}" -o "${out}"\n` +
        "or:        npm i -D qrcode  (then re-run this script)"
    );
    process.exit(1);
  }
  await QRCode.toFile(out, url, { width: 600, margin: 2, color: { dark: "#0b1e3f", light: "#ffffff" } });
  console.log("QR written:", out, "->", url);
}
main();
