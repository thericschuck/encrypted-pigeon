/**
 * Text pool for <EncryptionSequence />, the "hacker" show in front of every
 * instant chat message (pigeon letters skip it). Every send picks a random
 * subset of MID_SEQUENCE_LINES (shuffled), then always ends with
 * TRANSMIT_LINES — extend either array for more variety, no component
 * changes needed.
 */
export type EncryptionLineKind = "log" | "progress" | "warning" | "success";

export interface EncryptionLineTemplate {
  kind: EncryptionLineKind;
  text: string;
}

export const MID_SEQUENCE_LINES: EncryptionLineTemplate[] = [
  { kind: "log", text: "> INITIALIZING QUANTUM ENTANGLEMENT MODULE..." },
  { kind: "progress", text: "ENCRYPTING MESSAGE — AES-256" },
  { kind: "log", text: "> ROUTING THROUGH 7 PROXIES..." },
  { kind: "warning", text: "⚠ DEEP PACKET INSPECTION DETECTED — SPOOFING SIGNATURE..." },
  { kind: "log", text: "> BYPASSING GREAT FIREWALL..." },
  { kind: "progress", text: "MINING BITCOIN FOR TRANSIT FEE" },
  { kind: "log", text: "> CRACKING THE BLOCKCHAIN..." },
  { kind: "log", text: "> ENCRYPTING THE MATRIX..." },
  { kind: "log", text: "> INJECTING NOISE INTO PACKET HEADERS..." },
  { kind: "warning", text: "⚠ SURVEILLANCE SATELLITE OVERHEAD — GOING DARK..." },
  { kind: "log", text: "> NEGOTIATING WITH ROGUE AI..." },
  { kind: "progress", text: "COMPRESSING PAYLOAD" },
  { kind: "log", text: "> SPOOFING MAC ADDRESS..." },
  { kind: "log", text: "> ROTATING ONION LAYERS (x3)..." },
  { kind: "log", text: "> DOWNLOADING MORE RAM..." },
  { kind: "log", text: "> CONSULTING THE ORACLE..." },
  { kind: "log", text: "> HACKING THE MAINFRAME..." },
  { kind: "warning", text: "⚠ NSA VAN DETECTED OUTSIDE — REROUTING..." },
  { kind: "progress", text: "GENERATING NOISE ENTROPY" },
  { kind: "log", text: "> BOUNCING SIGNAL OFF THE MOON..." },
  { kind: "log", text: "> APPLYING TINFOIL WRAPPER..." },
  { kind: "log", text: "> LAUNDERING PACKETS THROUGH OFFSHORE SERVER..." },
  { kind: "progress", text: "SHUFFLING ENTROPY POOL" },
  { kind: "warning", text: "⚠ GLOBAL-K SATELLITE UPLINK DETECTED — JAMMING..." },
  { kind: "log", text: "> TRANSLATING TO MORSE CODE AND BACK..." },
];

export const TRANSMIT_LINES: EncryptionLineTemplate[] = [
  { kind: "success", text: "> HANDSHAKE WITH RECIPIENT... OK" },
  { kind: "success", text: "✔ TRANSMITTED." },
];
