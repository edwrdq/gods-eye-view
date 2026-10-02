import { austin } from './austin.ts';
import { caltrans } from './caltrans.ts';
import { calgary } from './calgary.ts';
import { deldot } from './deldot.ts';
import { drivebc } from './drivebc.ts';
import { fintraffic } from './fintraffic.ts';
import { nsw } from './nsw.ts';
import { tarktee } from './tarktee.ts';
import { tallinn, warendorf } from './curated.ts';
import { tfl } from './tfl.ts';
import { txdot } from './txdot.ts';
import type { CameraSource } from './types.ts';

/**
 * Every camera source this server can serve. Not ported, with the reason:
 * - Ontario 511 (511on.ca): the original app read its camera list without a key; the API now
 *   answers "Invalid Key" (HTTP 400), so it cannot be used keyless.
 */
export const SOURCES: readonly CameraSource[] = [austin, txdot, caltrans, tfl, nsw, calgary, drivebc, fintraffic, tarktee, tallinn, warendorf, deldot];

export type { CameraSource } from './types.ts';
