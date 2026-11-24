// The device fingerprint Qoder's servers see.
//
// Derived from the account's own uid, the way qoder2api-hub derives it:
// https://github.com/shuishuipingan/qoder2api-hub/blob/main/qoder_fingerprint.py
// (MIT). Consult that file when this one changes: the machine id, the
// session id, the machine type and the machine token are derived exactly
// as it derives them.
//
// The upstream package read this from Qoder's own `runtime-info` helper,
// which only exists where Qoder desktop or Qoder CLI is installed. That made
// the daily credits depend on the machine.
//
// One account derives the same identity every time, and two accounts never
// derive the same one: the salt separates the purposes, the uid separates
// the accounts. The request id is random per request and says nothing of the
// account, so no stable marker rides along on it.

import { createHash, randomUUID } from "node:crypto";
import { domainToASCII } from "node:url";

// The salt each purpose is derived under.
export const SALT_MACHINE = "machine";
export const SALT_SESSION = "session";

// The legacy shape: 32 hex characters, no dashes. The official client sends
// a dashed UUID, so this is off by default; it is for an account whose
// identity must not move (a machine id that changes is a new device to the
// upstream).
const legacyShape = () => {
  const raw = String(process.env.QD_DEVICE_ID_LEGACY ?? "").trim().toLowerCase();
  return raw === "1" || raw === "on" || raw === "true" || raw === "yes";
};

const md5 = (text) => createHash("md5").update(text, "utf8").digest("hex");

/**
 * The device or session id one account is seen as.
 *
 * @param {string} uid The account's uid. An empty one derives as "anonymous".
 * @param {string} salt The purpose the id is for.
 * @returns {string} A dashed UUIDv4, or 32 hex characters in the legacy shape.
 */
export const deriveId = (uid, salt) => {
  const hash = md5(`${salt}:${uid || "anonymous"}`);
  if (legacyShape()) return hash;
  const shaped = `${hash.slice(0, 12)}4${hash.slice(13, 16)}a${hash.slice(17)}`;
  return `${shaped.slice(0, 8)}-${shaped.slice(8, 12)}-${shaped.slice(12, 16)}-${shaped.slice(16, 20)}-${shaped.slice(20)}`;
};

/**
 * The machine id one account is seen as.
 *
 * @param {string} uid The account's uid.
 * @returns {string} A dashed UUIDv4.
 */
export const deriveMachineId = (uid) => deriveId(uid, SALT_MACHINE);

/**
 * The session id one account is seen as.
 *
 * @param {string} uid The account's uid.
 * @returns {string} A dashed UUIDv4.
 */
export const deriveSessionId = (uid) => deriveId(uid, SALT_SESSION);

/**
 * The machine type one account is seen as: 18 characters, no dashes, the
 * shape the `cosy-machinetype` header carries.
 *
 * @param {string} uid The account's uid.
 * @returns {string} 18 hex characters.
 */
export const deriveMachineType = (uid) => deriveId(uid, "machinetype").replaceAll("-", "").slice(0, 18);

/**
 * The machine token one account is seen as: a base64url string of the
 * length the official client's carries.
 *
 * @param {string} uid The account's uid.
 * @returns {string} 43 base64url characters.
 */
export const deriveMachineToken = (uid) =>
  createHash("sha512")
    .update(`machinetoken:${uid}`, "utf8")
    .digest("base64url")
    .replaceAll("=", "")
    .slice(0, 43);

/**
 * The request id one request carries: random per request, with nothing
 * about the account in it.
 *
 * @returns {string} 32 hex characters.
 */
export const generateRequestId = () => randomUUID().replaceAll("-", "");

// The host's own name, as the official client's Cosy-MachineHostname puts it
// on a chat request: printable ASCII as it is, else its punycode, else made
// safe and marked with a hash of the original, at most 96 characters.
const HOST_SAFE = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/u;

const hostHash = (value) => createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);

const capHost = (value) => {
  if (value.length <= 96) return value;
  const head = value.slice(0, 96 - 8 - 1).replace(/[-\s]+$/u, "");
  return head ? `${head}-${hostHash(value)}` : `unknown-${hostHash(value)}`;
};

/**
 * The machine hostname, as Qoder's client makes it safe.
 *
 * @param {string} name The host's name.
 * @returns {string} The name as it goes on the wire, "" for an empty one.
 */
export const safeHostname = (name) => {
  const value = String(name ?? "").trim();
  if (!value) return "";
  if (HOST_SAFE.test(value)) return capHost(value);
  const ascii = domainToASCII(value);
  if (ascii && HOST_SAFE.test(ascii)) return capHost(ascii);
  const safe = value.replace(/[^\x21-\x7e]+/gu, "-").replace(/-{2,}/gu, "-").replace(/^-+|-+$/gu, "");
  return capHost(safe ? `${safe}-${hostHash(value)}` : `unknown-${hostHash(value)}`);
};
