/**
 * FPGA fabric — Stage 1 (the abstract "mini-VPR"), the routability-driven place-and-route loop.
 * The full staging is FPGA-FABRIC-RESEARCH.md Appendix A. Minimizing wirelength (fpga-place.ts) and routing
 * (fpga-router.ts) are separate objectives: the shortest-wirelength placement can pack too many nets through
 * one channel for the router to legalize. Real flows (VPR, nextpnr) close that gap with an OUTER loop —
 * place, route, and if routing fails, FEED the congestion back into the next placement — which is exactly
 * this module.
 *
 * The feedback: the PathFinder router reports the routing-resource nodes it could not decongest
 * (`RouteResult.overused`). Each overused channel node (`chanx_<y>_<t>` / `chany_<x>_<t>`) is aggregated to
 * its channel (`chanx_<y>` / `chany_<x>`) and its congestion count is bumped. That congestion map is handed
 * to the next placeClusters call, whose cost charges any net whose bounding box spans a congested row/column
 * — so the placer steers nets off the channels that just failed, spreading the design until it routes.
 *
 * It converges to a routed design or fails HONESTLY: `fits:false` (more LUTs than tiles — re-placing cannot
 * help, so it stops immediately) or, after `maxAttempts`, the last attempt's own `overused` / `unroutable`
 * diagnostics — never a bare failure with no reason.
 */

import {
  type Cluster,
  type ExtractedRouting,
  extractRouting,
  type Placement,
  placeClusters,
} from './fpga-place.ts'
import { type RouteNet, type RouteResult, type RouterOptions, routeDesign } from './fpga-router.ts'
import type { Fabric } from './fpga-rrg.ts'
import { generateFabric as _generateFabric } from './fpga-rrg.ts'

// re-export so callers can build the fabric without a second import (the loop is the natural entry point).
export const generateFabric = _generateFabric

export type PlaceAndRouteOptions = {
  /** PRNG seed, HELD FIXED across attempts — so the ONLY thing that changes a re-placement is the congestion
   *  feedback, not a random restart. (With `congestionWeight: 0` the placement never changes and the loop is a
   *  no-op — which is exactly what makes the feedback demonstrably load-bearing, not seed luck.) */
  seed?: number
  /** how many place→route rounds to try before giving up (default 8). */
  maxAttempts?: number
  /** weight on the congestion feedback in the placer's cost (default 8; 0 disables feedback). */
  congestionWeight?: number
  /** annealing knobs forwarded to placeClusters (moves / cooling). */
  moves?: number
  cooling?: number
  /** options forwarded to routeDesign. */
  routeOptions?: RouterOptions
}

export type PlaceAndRouteResult = {
  /** true iff an attempt produced a legal, congestion-free routing. */
  routed: boolean
  /** false iff the design has more LUTs than the fabric has tiles (routing was never attempted). */
  fits: boolean
  /** how many place→route rounds ran (1 = routed with no feedback needed). */
  attempts: number
  placement: Placement
  /** the winning (or last-tried) extraction + route; null only when `fits` is false. */
  extraction: ExtractedRouting | null
  route: RouteResult | null
  /** the per-channel congestion the feedback accumulated (empty if it routed first try). */
  congestion: Map<string, number>
}

/** Aggregate an overused RRG node to its channel key (`chanx_<y>` / `chany_<x>`), or null if it is not a channel. */
function channelOf(nodeId: string): string | null {
  const m = /^(chanx|chany)_(\d+)_\d+$/.exec(nodeId)
  return m ? `${m[1]}_${m[2]}` : null
}

/**
 * Place the clusters and route them, feeding routing congestion back into re-placement until it routes or
 * `maxAttempts` is exhausted. Returns the winning place+route, or an honest failure with diagnostics.
 */
export function placeAndRoute(
  clusters: readonly Cluster[],
  fabric: Fabric,
  options: PlaceAndRouteOptions = {},
): PlaceAndRouteResult {
  const maxAttempts = options.maxAttempts ?? 8
  const congestionWeight = options.congestionWeight ?? 8
  const congestion = new Map<string, number>()
  let lastPlacement: Placement = new Map()
  let lastExtraction: ExtractedRouting | null = null
  let lastRoute: RouteResult | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const place = placeClusters(clusters, fabric.device, {
      seed: options.seed ?? 1, // FIXED across attempts — congestion feedback is the only thing that moves nets
      congestion,
      congestionWeight,
      ...(options.moves !== undefined ? { moves: options.moves } : {}),
      ...(options.cooling !== undefined ? { cooling: options.cooling } : {}),
    })
    lastPlacement = place.placement
    if (!place.fits) {
      // More LUTs than tiles: re-placing cannot fix it. Fail immediately and honestly.
      return {
        routed: false,
        fits: false,
        attempts: attempt,
        placement: place.placement,
        extraction: null,
        route: null,
        congestion,
      }
    }

    const extraction = extractRouting(clusters, place.placement)
    const route = routeDesign(fabric.rrg, extraction.nets, options.routeOptions)
    lastExtraction = extraction
    lastRoute = route
    if (route.routed) {
      return {
        routed: true,
        fits: true,
        attempts: attempt,
        placement: place.placement,
        extraction,
        route,
        congestion,
      }
    }

    // Feedback: bump the congestion of every channel the router could not decongest, so the next placement
    // steers nets off it. (ipin/sink overuse is not a channel and cannot be relieved by spreading, so it is
    // left to the router's own negotiation — it never contributes a channel key here.)
    for (const nodeId of route.overused) {
      const channel = channelOf(nodeId)
      if (channel !== null) congestion.set(channel, (congestion.get(channel) ?? 0) + 1)
    }
  }

  return {
    routed: false,
    fits: true,
    attempts: maxAttempts,
    placement: lastPlacement,
    extraction: lastExtraction,
    route: lastRoute,
    congestion,
  }
}

export type { RouteNet }
