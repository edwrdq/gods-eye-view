import type { BBox, ElementsResponse, FeatureDetail, FeaturesResponse, FeedsResponse, FeedStatus, HistoryRange, LayerSnapshot, ObjectDetail, Track } from '@gev/shared';
import { bboxParam } from '../lib/bbox.ts';
import { getJson } from './client.ts';

export { ApiRequestError, configureApi, isAbort, type ApiConfig, type ApiFailure } from './client.ts';

export async function fetchFeeds(signal?: AbortSignal): Promise<FeedStatus[]> {
  return (await getJson<FeedsResponse>('/feeds', undefined, signal)).feeds;
}

export interface SnapshotQuery {
  /** null or omitted: the whole world. */
  bbox?: BBox | null;
  /** Epoch ms for a historical view; omitted for live. */
  at?: number | null;
}

/** 404 unknown layer; 409 feed off or key missing. */
export function fetchSnapshot(layer: string, q: SnapshotQuery, signal?: AbortSignal): Promise<LayerSnapshot> {
  return getJson<LayerSnapshot>(`/layers/${encodeURIComponent(layer)}/snapshot`, { bbox: q.bbox ? bboxParam(q.bbox) : undefined, at: q.at ?? undefined }, signal);
}

/** 404 when the object is not (or no longer) in the feed. */
export function fetchObject(layer: string, objectId: string, at: number | null, signal?: AbortSignal): Promise<ObjectDetail> {
  return getJson<ObjectDetail>(`/layers/${encodeURIComponent(layer)}/objects/${encodeURIComponent(objectId)}`, { at: at ?? undefined }, signal);
}

export function fetchTrack(layer: string, objectId: string, range: { from?: number; to?: number }, signal?: AbortSignal): Promise<Track> {
  return getJson<Track>(`/layers/${encodeURIComponent(layer)}/objects/${encodeURIComponent(objectId)}/track`, { from: range.from, to: range.to }, signal);
}

export function fetchHistoryRange(signal?: AbortSignal): Promise<HistoryRange> {
  return getJson<HistoryRange>('/history/range', undefined, signal);
}

export interface FeaturesQuery {
  bbox?: BBox | null;
  from?: number;
  to?: number;
}

/** 404 unknown layer; 409 feed off or key missing. */
export function fetchFeatures(layer: string, q: FeaturesQuery, signal?: AbortSignal): Promise<FeaturesResponse> {
  return getJson<FeaturesResponse>(`/layers/${encodeURIComponent(layer)}/features`, { bbox: q.bbox ? bboxParam(q.bbox) : undefined, from: q.from, to: q.to }, signal);
}

export function fetchFeatureDetail(layer: string, featureId: string, signal?: AbortSignal): Promise<FeatureDetail> {
  return getJson<FeatureDetail>(`/layers/${encodeURIComponent(layer)}/features/${encodeURIComponent(featureId)}`, undefined, signal);
}

/** Current orbital element sets; `group` narrows to one CelesTrak group (404 when unknown). */
export function fetchElements(layer: string, group: string | null, signal?: AbortSignal): Promise<ElementsResponse> {
  return getJson<ElementsResponse>(`/layers/${encodeURIComponent(layer)}/elements`, { group: group ?? undefined }, signal);
}
