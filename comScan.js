const { execFileSync } = require("child_process");

/**
 * Lists Windows serial (COM) ports via WMI (Win32_SerialPort).
 * Flags likely Epson TM / POS devices: USB VID 04B8 (Seiko Epson) or "Epson" in description.
 */
function listWindowsComPorts() {
  if (process.platform !== "win32") {
    return {
      supported: false,
      ports: [],
      message: "Automatic COM listing is only available on Windows.",
    };
  }

  const ps =
    "@(Get-CimInstance Win32_SerialPort | ForEach-Object { " +
    "[PSCustomObject]@{ " +
    "com=$_.DeviceID; " +
    "description=$_.Description; " +
    "pnpDeviceId=$_.PNPDeviceID; " +
    "likelyEpsonTm=(($null -ne $_.PNPDeviceID) -and (($_.PNPDeviceID -match 'VID_04B8') -or ($_.Description -match 'Epson'))) " +
    "} " +
    "}) | ConvertTo-Json -Compress";

  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 20000,
      windowsHide: true,
    });

    const trimmed = out.trim();
    if (!trimmed) {
      return {
        supported: true,
        ports: [],
        suggested: null,
        note: "No COM ports reported by Win32_SerialPort. Install Epson TM USB / virtual COM driver so the printer appears under Ports (COM & LPT).",
      };
    }

    let rows = JSON.parse(trimmed);
    if (!Array.isArray(rows)) {
      rows = [rows];
    }

    const ports = rows.map((row) => {
      const com = row.com != null ? String(row.com) : "";
      const path =
        /^COM\d+$/i.test(com) ? `\\\\.\\${com.toUpperCase()}` : null;
      return {
        com,
        path,
        description: row.description != null ? String(row.description) : "",
        pnpDeviceId: row.pnpDeviceId != null ? String(row.pnpDeviceId) : "",
        likelyEpsonTm: Boolean(row.likelyEpsonTm),
      };
    });

    const epson = ports.filter((p) => p.likelyEpsonTm);
    let suggested = null;
    if (epson.length === 1) {
      suggested = { com: epson[0].com, path: epson[0].path };
    } else if (epson.length > 1) {
      suggested = {
        com: epson[0].com,
        path: epson[0].path,
        ambiguous: true,
        candidates: epson.map((p) => ({ com: p.com, path: p.path, description: p.description })),
      };
    }

    return { supported: true, ports, suggested };
  } catch (e) {
    return {
      supported: true,
      ports: [],
      suggested: null,
      error: e.message || String(e),
    };
  }
}

module.exports = { listWindowsComPorts };
