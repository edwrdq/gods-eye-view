import type { BBox } from '@gev/shared';
import type { Camera } from '../camera.ts';
import type { FetchLike } from '../../types.ts';

export interface LoadContext {
  fetch: FetchLike;
  signal: AbortSignal;
  now: () => number;
  log: (msg: string) => void;
  /** Hand over the cameras found so far, so a view can draw before a multi-request load ends. */
  partial?: (cameras: Camera[]) => void;
}

export interface LoadResult {
  cameras: Camera[];
  /** Groups (districts) that failed this time; the catalogue keeps their previous cameras. */
  failedGroups?: string[];
}

/** How a source's pictures are fetched. All of it is checked against the camera's registered address, never against client input. */
export interface FrameSpec {
  /** Seconds between pictures worth asking for. The server never pulls one camera more often than this. */
  refreshS: number;
  /** Upstream hosts a picture may come from (exact names). Redirects must stay on the same origin. */
  hosts: readonly string[];
  /** http is allowed only where the source publishes nothing else. */
  allowHttp?: boolean;
  /** The upstream answers JSON with the JPEG inside (TxDOT). */
  format?: 'image' | 'txdot-json';
  /** A host that serves pictures only to browsers. */
  userAgent?: string;
}

export interface CameraSource {
  id: string;
  /** Short name for the detail panel and the layer's source list. */
  name: string;
  /** The agency that runs the cameras. */
  provider: string;
  /** Where cameras can be: a view outside this box never loads the source. */
  coverage: BBox;
  /** The agency's own public page for these cameras (the "Open source page" link). */
  pageUrl: string;
  /** Licence or terms of the camera list and pictures, in the source's words. */
  licence: string;
  /** The line the licence asks to be shown. Empty when none is asked for. */
  attribution?: string;
  /** How long a loaded list is used before a view triggers a refresh. */
  catalogTtlMs: number;
  frame?: FrameSpec;
  /** Fetch the camera list. Throws when nothing could be loaded. */
  load(ctx: LoadContext): Promise<LoadResult>;
  /** The picture address for a camera whose address is not fixed (Tarktee). */
  resolveImage?(camera: Camera, ctx: Pick<LoadContext, 'fetch' | 'signal' | 'now' | 'log'>): Promise<string | undefined>;
}
