const path = require("path");
const express = require("express");
const { listWindowsComPorts } = require("./comScan");
const { buildLogoPngBuffer, lineWidthChars } = require("./logoResize");
const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require("node-thermal-printer");

const PORT = Number(process.env.PORT) || 3001;

/**
 * USB (Windows): set PRINTER_COM to the COM number from Device Manager
 * (Ports → "USB Serial Device" / "Epson TM Virtual port" → COM5 → PRINTER_COM=5),
 * or set PRINTER_INTERFACE to the full path, e.g. \\.\COM5
 *
 * Network: PRINTER_INTERFACE=tcp://192.168.0.50:9100
 *
 * Windows spooler RAW: PRINTER_INTERFACE=printer:Exact queue name (requires npm package "printer" + MSVC)
 */
function resolvePrinterInterface() {
  const explicit = process.env.PRINTER_INTERFACE?.trim();
  if (explicit) {
    if (/^COM\d+$/i.test(explicit)) {
      return `\\\\.\\${explicit.toUpperCase()}`;
    }
    return explicit;
  }
  const com = process.env.PRINTER_COM?.trim();
  if (com && /^\d+$/.test(com)) {
    return `\\\\.\\COM${com}`;
  }
  return "\\\\.\\COM3";
}

const PRINTER_INTERFACE = resolvePrinterInterface();
const LOGO_PATH = path.join(__dirname, "assets", "HSBC-Premier-logo.png");

/**
 * 58 (default): logo max 384 dots — fits 58mm; on 80mm it prints narrower, not cropped.
 * 80: logo max 576 dots and 48-char lines for full 80mm roll.
 */
function paperMode() {
  const p = (process.env.PAPER_MM || "58").trim().toLowerCase();
  if (p === "80" || p === "80mm" || p === "3" || p === "3inch") return "80";
  return "58";
}

const PAPER_MM = paperMode();

/** Display size for queue token (design sp); mapped to Epson GS ! magnification 2–7. */
const TOKEN_SP = Number.parseInt(String(process.env.TOKEN_SP || "32"), 10);

function escposMagnificationFromSp(sp) {
  const s = Number.isFinite(sp) ? Math.max(8, Math.min(64, sp)) : 32;
  return Math.min(7, Math.max(2, Math.round((s - 8) / 5)));
}

function shouldProbeConnection(uri) {
  return /^tcp:\/\//i.test(uri) || /^printer:/i.test(uri);
}

function createPrinter() {
  const init = {
    type: PrinterTypes.EPSON,
    width: lineWidthChars(PAPER_MM),
    interface: PRINTER_INTERFACE,
    characterSet: CharacterSet.PC850_MULTILINGUAL,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    breakLine: BreakLine.WORD,
    options: { timeout: 10000 },
  };

  if (/^printer:/i.test(PRINTER_INTERFACE)) {
    try {
      init.driver = require("printer");
    } catch {
      const err = new Error(
        'PRINTER_INTERFACE uses printer:... but the native module "printer" is not installed or failed to load. ' +
          "For USB without that module, use Epson's virtual COM driver and set PRINTER_COM=<number> " +
          '(see Device Manager → Ports COM & LPT), e.g. PRINTER_COM=5 for \\\\.\\COM5.'
      );
      err.code = "MISSING_PRINTER_DRIVER";
      throw err;
    }
  }

  return new ThermalPrinter(init);
}

async function printReceipt(token) {
  const printer = createPrinter();

  if (shouldProbeConnection(PRINTER_INTERFACE)) {
    const connected = await printer.isPrinterConnected();
    if (!connected) {
      const err = new Error(
        `Printer not reachable at ${PRINTER_INTERFACE}. Check cable, driver, or queue name.`
      );
      err.code = "PRINTER_OFFLINE";
      throw err;
    }
  }

  const logoPng = buildLogoPngBuffer(LOGO_PATH, PAPER_MM);
  printer.alignCenter();
  await printer.printImageBuffer(logoPng);
  printer.newLine();

  const mag = escposMagnificationFromSp(TOKEN_SP);
  printer.setTypeFontA();
  printer.bold(true);
  printer.setTextNormal();
  printer.setTextSize(mag, mag);
  printer.println(String(token));
  printer.setTextSize(0, 0);
  printer.setTextNormal();
  printer.bold(false);
  printer.newLine();

  const dateStr = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  printer.alignCenter();
  printer.setTypeFontA();
  printer.setTextNormal();
  printer.setTextSize(1, 1);
  printer.println(`Token generated at: ${dateStr}`);
  printer.setTextSize(0, 0);
  printer.setTextNormal();
  printer.newLine();
  printer.newLine();

  printer.cut();

  await printer.execute();
}

const app = express();

/** Lists COM ports (Windows WMI). Epson-like devices use USB VID 04B8 or "Epson" in the description. */
app.get("/ports", (req, res) => {
  const scan = listWindowsComPorts();
  return res.status(200).json(scan);
});

app.get("/print", async (req, res) => {
  const raw = req.query.token;
  if (raw === undefined || raw === "") {
    return res.status(400).json({ error: "Missing required query parameter: token" });
  }

  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) {
    return res.status(400).json({ error: "token must be a non-negative integer" });
  }
  const token = Number(s);
  if (token > Number.MAX_SAFE_INTEGER) {
    return res.status(400).json({ error: "token out of range" });
  }

  try {
    await printReceipt(token);
    return res.status(200).json({ ok: true, token });
  } catch (err) {
    if (err.code === "MISSING_PRINTER_DRIVER") {
      return res.status(500).json({ error: err.message });
    }
    if (err.code === "PRINTER_OFFLINE") {
      return res.status(503).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: err.message || "Print failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Print server listening on http://localhost:${PORT}`);
  console.log(`PRINTER_INTERFACE=${PRINTER_INTERFACE}`);
  console.log(`PAPER_MM=${PAPER_MM} (58 = safe on 58+80mm logo; 80 = full-width logo on 80mm)`);
  console.log(`TOKEN_SP=${TOKEN_SP} (ESC/POS mag=${escposMagnificationFromSp(TOKEN_SP)})`);
  console.log(`COM scan: http://localhost:${PORT}/ports`);
  if (/^\\\\\.\\COM/i.test(PRINTER_INTERFACE)) {
    console.log(
      "USB/COM: ensure Epson TM USB / virtual COM driver is installed and this COM port matches Device Manager."
    );
  }
});
