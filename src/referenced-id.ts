/**
 * **Referenced identifiers**: the replacement written for an identifier that other positions of the
 * same document point at, such as a FHIR resource's logical `id` and the id part of every reference to
 * it. Removing such an identifier would cut every link to it, so the engine writes a replacement in
 * its place, and writes the **same** replacement for the same identifier wherever it appears in one
 * call, so every link still resolves.
 *
 * Two kinds of replacement, chosen by the configured transform for the locus's category:
 *
 * - A **stand-in**, under a transform that withholds the value (`redact`, `block`): a sequence
 *   number counted from 1 in the order the distinct identifiers are first met in one call. It is
 *   computed from that order and from nothing about the identifier, so two documents that differ only
 *   in their identifiers come out the same, and it means nothing outside the call that wrote it.
 * - A **keyed surrogate**, under `pseudonymize` or `hash`: the keyed digest those transforms already
 *   compute, so the same identifier under the same key gets the same surrogate in every call, which is
 *   what lets a corpus link. It is a re-identification code, flagged as one in the manifest.
 *
 * Either replacement keeps the **shape** of the identifier it replaces, because a reader validates the
 * shape: a UUID is replaced by a UUID, an OID by an OID under the `2.25` arc, and anything else by a
 * plain token. The shape is read from the identifier alone, so it is the same wherever that identifier
 * appears.
 *
 * @packageDocumentation
 */

/** The shape of a referenced identifier, which its replacement keeps. */
type ReferencedIdShape = "uuid" | "oid" | "token";

/** A UUID in its canonical hyphenated form, either case. */
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** An OID: a first arc of 0, 1 or 2, then at least one more arc, with no leading zeros. */
const OID_SHAPE = /^[0-2](\.(0|[1-9][0-9]*))+$/;

/** Read the shape of an identifier. */
function shapeOf(id: string): ReferencedIdShape {
  if (UUID_SHAPE.test(id)) return "uuid";
  if (OID_SHAPE.test(id)) return "oid";
  return "token";
}

/** Write sequence number `n` in the given shape. */
function sequenceInShape(n: number, shape: ReferencedIdShape): string {
  if (shape === "uuid") return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  if (shape === "oid") return `2.25.${String(n)}`;
  return String(n);
}

/**
 * Write a keyed digest (lowercase hex, 64 characters) in the given shape. A token is the digest
 * itself, which is the longest id FHIR allows (64 characters). A UUID is the digest's first 128 bits
 * laid out as a version 8 UUID with the RFC 9562 variant bits; an OID is those same 128 bits as a
 * decimal arc under `2.25`, the arc ITU-T X.667 gives to UUID-derived OIDs.
 *
 * @internal
 */
export function keyedInShape(digest: string, id: string): string {
  const shape = shapeOf(id);
  if (shape === "token") return digest;
  if (shape === "oid") return `2.25.${BigInt(`0x${digest.slice(0, 32)}`).toString(10)}`;
  const variant = (8 | (parseInt(digest.charAt(16), 16) & 3)).toString(16);
  return (
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-` +
    `${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  );
}

/**
 * The stand-ins of one call: each distinct identifier gets the next sequence number the first time it
 * is met, and the same one every time after. One instance lives for exactly one engine call and is
 * dropped with it, so the mapping is never returned, stored or logged.
 *
 * @internal
 */
export class ReferencedIdStandIns {
  /** Identifier to stand-in, for this call only. */
  private readonly assigned = new Map<string, string>();

  /** The stand-in for `id`: the one already assigned, or the next sequence number in `id`'s shape. */
  public standIn(id: string): string {
    const existing = this.assigned.get(id);
    if (existing !== undefined) return existing;
    const next = sequenceInShape(this.assigned.size + 1, shapeOf(id));
    this.assigned.set(id, next);
    return next;
  }
}
