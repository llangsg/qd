// The machine the plugin signs in from.
//
// The device flow names a machine id before the account is known: the
// account-select page is asked to authorize a device. The official client
// sends the OS hardware UUID there, so the same device comes back for every
// sign-in.
//
// The value is kept in the plugin's own directory, so it survives a restart
// and needs nothing installed on the machine. It is the machine, not the
// account: the identity an account is seen as on its own requests is
// derived from the account's uid (see fingerprint.js).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const DEVICE_FILE = "qoder-device.json";

const read = (path) => {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return typeof raw?.machineId === "string" && raw.machineId.trim() ? raw.machineId.trim() : "";
  } catch {
    return "";
  }
};

const write = (path, machineId) => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ machineId }, null, 2), "utf8");
    renameSync(tmp, path);
  } catch {
    // A device id that cannot be written costs a fresh one per start.
  }
};

/**
 * The machine id this installation signs in from, made once and kept.
 *
 * @param {string} directory The plugin's own directory. Without one the id is
 *   made for this run only and nothing is written.
 * @returns {string} A dashed UUID.
 */
export const machineIdOf = (directory) => {
  if (!directory) return randomUUID();
  const path = join(directory, DEVICE_FILE);
  const known = read(path);
  if (known) return known;
  const machineId = randomUUID();
  write(path, machineId);
  return machineId;
};
