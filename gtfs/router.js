function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(":");
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2] || 0);
}

function secondsToTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return { h: h % 24, m, totalSeconds: seconds };
}

function formatTime(timeStr) {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  return `${parts[0]}:${parts[1]}`;
}

export function findRoutes(graph, params) {
  const {
    fromStopId,
    toStopId,
    hour,
    minute,
    isArrival = false,
    maxTransfers = 3,
    maxWalk = 700,
    allowTransfers = true,
    wholeDay = false,
  } = params;

  const startSeconds = hour * 3600 + minute * 60;
  const { stops, stopTimesIndex, trips, routes, transferIndex } = graph;

  if (!stops.has(fromStopId)) return { error: "Induló állomás nem található" };
  if (!stops.has(toStopId)) return { error: "Cél állomás nem található" };
  if (isArrival) return { error: "Érkezés szerinti keresés jelenleg nem támogatott" };

  // Collect origin stops (origin + nearby within walk distance)
  const originStops = new Map();
  originStops.set(fromStopId, 0);
  for (const t of transferIndex.get(fromStopId) || []) {
    if (t.dist <= maxWalk) originStops.set(t.stopId, t.walkTime);
  }

  // Target stop set (for quick lookup)
  const targetStopIds = new Set([toStopId]);
  for (const t of transferIndex.get(toStopId) || []) {
    if (t.dist <= maxWalk) targetStopIds.add(t.stopId);
  }

  // Results
  const results = [];
  const MAX_RESULTS = wholeDay ? 48 : 8;
  let bestArrivalTime = Infinity;
  const routeTimeSeen = new Set();
  const PHASE1_WINDOW = wholeDay ? 3600 : 300;
  const searchWindow = wholeDay ? 24 : 4;
  const transferWindow = wholeDay ? 3600 : 300;
  const hourResults = wholeDay ? {} : null;

  // Phase 1: Find direct routes
  for (const [originStopId, walkTimeToBoard] of originStops) {
    if (results.length >= MAX_RESULTS) break;

    const times = stopTimesIndex.get(originStopId) || [];
    const hourRouteSeen = wholeDay ? {} : null;

    for (const st of times) {
      const depSec = timeToSeconds(st.departure_time || st.arrival_time);
      const minDepSec = wholeDay ? 0 : startSeconds + walkTimeToBoard;
      if (depSec < minDepSec) continue;
      if (depSec > startSeconds + searchWindow * 3600) break;

      let trip = trips.get(st.trip_id);
      if (wholeDay) {
        const depHour = Math.floor(depSec / 3600);
        if (!hourResults[depHour]) hourResults[depHour] = 0;
        if (hourResults[depHour] >= 3) continue;
        if (!trip) continue;
        const rKey = `${trip.route_id}_${depHour}`;
        if (hourRouteSeen[rKey]) continue;
        hourRouteSeen[rKey] = true;
      }

      if (!trip || !trip.stopTimes) continue;

      const routeData = routes.get(trip.route_id);
      const tripPath = trip.stopTimes;

      let idx = -1;
      for (let i = 0; i < tripPath.length; i++) {
        if (tripPath[i].stop_id === originStopId && tripPath[i].stop_sequence === st.stop_sequence) {
          idx = i;
          break;
        }
      }
      if (idx === -1) continue;

      for (let j = idx + 1; j < tripPath.length; j++) {
        const arrivalStop = tripPath[j];
        const arrSec = timeToSeconds(arrivalStop.arrival_time);
        if (arrSec <= depSec) continue;

        if (targetStopIds.has(arrivalStop.stop_id)) {
          const depHour = Math.floor(depSec / 3600);
          if (wholeDay) {
            if (!hourResults[depHour]) hourResults[depHour] = 0;
            if (hourResults[depHour] >= 4) continue;
          }

          const routeKey = `${routeData?.route_short_name || ""}_${Math.floor(depSec / PHASE1_WINDOW)}`;
          if (routeTimeSeen.has(routeKey)) continue;

          const totalTravel = (arrSec - depSec) + walkTimeToBoard;
          results.push({
            departure: {
              time: secondsToTime(depSec),
              stopName: stops.get(fromStopId)?.stop_name || fromStopId,
              stopId: fromStopId,
            },
            arrival: {
              time: secondsToTime(arrSec),
              stopName: stops.get(toStopId)?.stop_name || toStopId,
              stopId: toStopId,
            },
            travelTimeMinutes: Math.round(totalTravel / 60),
            transfers: 0,
            routeShortName: routeData?.route_short_name || "",
            routeLongName: routeData?.route_long_name || "",
            routeType: routeData?.route_type || "",
            source: trip.source || "",
            segments: [{
              type: "ride",
              tripId: st.trip_id,
              routeShortName: routeData?.route_short_name || "",
              routeLongName: routeData?.route_long_name || "",
              routeType: routeData?.route_type || "",
              fromStopId: originStopId,
              fromStopName: stops.get(originStopId)?.stop_name || originStopId,
              departureTime: formatTime(st.departure_time || st.arrival_time),
              toStopId: arrivalStop.stop_id,
              toStopName: stops.get(arrivalStop.stop_id)?.stop_name || arrivalStop.stop_id,
              arrivalTime: formatTime(arrivalStop.arrival_time),
            }],
          });

          if (wholeDay) hourResults[depHour]++;
          routeTimeSeen.add(routeKey);
          if (arrSec < bestArrivalTime) bestArrivalTime = arrSec;
          if (results.length >= MAX_RESULTS) break;
        }
      }
      if (results.length >= MAX_RESULTS) break;
    }
  }

  // Phase 2: Find 1-transfer routes (only if transfers allowed)
  if (allowTransfers) {
    const firstLegTrips = [];
    const transferRouteSeen = new Set();
    const maxGlobalFirstLegs = wholeDay ? 240 : 40;
    let globalFirstLegCount = 0;
    const flHourSeen = wholeDay ? {} : null;

    for (const [originStopId, walkTimeToBoard] of originStops) {
      if (globalFirstLegCount >= maxGlobalFirstLegs) break;

      const times = stopTimesIndex.get(originStopId) || [];
      let count = 0;
      const maxFirstLeg = wholeDay ? 96 : 20;
      const lastHourSeen = {};

      for (const st of times) {
        const depSec = timeToSeconds(st.departure_time || st.arrival_time);
        const minDepSec = wholeDay ? 0 : startSeconds + walkTimeToBoard;
        if (depSec < minDepSec) continue;
        if (depSec > startSeconds + searchWindow * 3600) break;

        if (wholeDay) {
          const depHour = Math.floor(depSec / 3600);
          if (!lastHourSeen[depHour]) lastHourSeen[depHour] = 0;
          if (lastHourSeen[depHour] >= 4) continue;
          lastHourSeen[depHour]++;

          const trip = trips.get(st.trip_id);
          if (!trip) continue;
          const flKey = `${trip.route_id}_${depHour}`;
          if (flHourSeen[flKey]) continue;
          flHourSeen[flKey] = true;
        }

        if (count >= maxFirstLeg) break;

        const trip = trips.get(st.trip_id);
        if (!trip || !trip.stopTimes) continue;

        let idx = -1;
        const tripPath = trip.stopTimes;
        for (let i = 0; i < tripPath.length; i++) {
          if (tripPath[i].stop_id === originStopId && tripPath[i].stop_sequence === st.stop_sequence) {
            idx = i;
            break;
          }
        }
        if (idx === -1) continue;

        firstLegTrips.push({
          tripId: st.trip_id,
          boardStopId: originStopId,
          boardIdx: idx,
          depSec,
          walkTimeToBoard,
          routeData: routes.get(trip.route_id),
          tripPath,
          trip,
        });
        count++;
        globalFirstLegCount++;
      }
    }

    const minTransferTime = 180;
    const maxWaitTime = wholeDay ? 1800 : 1200;

    for (const firstLeg of firstLegTrips) {
      if (results.length >= MAX_RESULTS) break;

      const { tripPath, boardIdx, depSec, boardStopId, walkTimeToBoard, routeData, tripId, trip } = firstLeg;

      for (let i = boardIdx + 1; i < tripPath.length; i++) {
        const transferStop = tripPath[i];
        const alightSec = timeToSeconds(transferStop.arrival_time);
        if (alightSec <= depSec) continue;
        if (!wholeDay && alightSec > bestArrivalTime + transferWindow) continue;

        if (targetStopIds.has(transferStop.stop_id)) continue;

        const transferCandidates = [transferStop.stop_id];
        for (const t of transferIndex.get(transferStop.stop_id) || []) {
          if (t.dist <= maxWalk) transferCandidates.push(t.stopId);
        }

        const onwardRouteTaken = new Set();

        for (const candStopId of transferCandidates) {
          const onwardTimes = stopTimesIndex.get(candStopId) || [];
          const earliestOnward = alightSec + minTransferTime;

          for (const onward of onwardTimes) {
            const onwardDepSec = timeToSeconds(onward.departure_time || onward.arrival_time);
            if (onwardDepSec < earliestOnward) continue;
            if (onwardDepSec > alightSec + maxWaitTime) break;
            if (onward.trip_id === tripId) continue;

            const onwardTrip = trips.get(onward.trip_id);
            if (!onwardTrip || !onwardTrip.stopTimes) continue;

            const onwardRouteKey = onwardTrip.route_id;
            if (onwardRouteTaken.has(onwardRouteKey)) continue;
            onwardRouteTaken.add(onwardRouteKey);

            const onwardRouteData = routes.get(onwardTrip.route_id);
            const onwardPath = onwardTrip.stopTimes;

            let onwardIdx = -1;
            for (let k = 0; k < onwardPath.length; k++) {
              if (onwardPath[k].stop_id === candStopId && onwardPath[k].stop_sequence === onward.stop_sequence) {
                onwardIdx = k;
                break;
              }
            }
            if (onwardIdx === -1) continue;

            for (let j = onwardIdx + 1; j < onwardPath.length; j++) {
              const finalStop = onwardPath[j];
              const finalArrSec = timeToSeconds(finalStop.arrival_time);
              if (finalArrSec <= onwardDepSec) continue;

              if (targetStopIds.has(finalStop.stop_id)) {
                const totalTravel = (finalArrSec - depSec) + walkTimeToBoard;
                const finalWalkTime = (finalStop.stop_id === toStopId) ? 0 :
                  (transferIndex.get(toStopId) || []).find(t => t.stopId === finalStop.stop_id)?.walkTime || 0;

                const routePairKey = `${routeData?.route_short_name || ""}_${onwardRouteData?.route_short_name || ""}_${Math.floor(depSec / 60)}`;
                if (transferRouteSeen.has(routePairKey)) continue;
                transferRouteSeen.add(routePairKey);

                results.push({
                  departure: {
                    time: secondsToTime(depSec),
                    stopName: stops.get(fromStopId)?.stop_name || fromStopId,
                    stopId: fromStopId,
                  },
                  arrival: {
                    time: secondsToTime(finalArrSec),
                    stopName: stops.get(toStopId)?.stop_name || toStopId,
                    stopId: toStopId,
                  },
                  travelTimeMinutes: Math.round((totalTravel + finalWalkTime) / 60),
                  transfers: 1,
                  routeShortName: routeData?.route_short_name || "",
                  routeLongName: routeData?.route_long_name || "",
                  routeType: routeData?.route_type || "",
                  source: trip.source || "",
                  transferWaitMin: Math.round((onwardDepSec - alightSec) / 60),
                  segments: [
                    {
                      type: "ride",
                      tripId,
                      routeShortName: routeData?.route_short_name || "",
                      routeLongName: routeData?.route_long_name || "",
                      routeType: routeData?.route_type || "",
                      fromStopId: boardStopId,
                      fromStopName: stops.get(boardStopId)?.stop_name || boardStopId,
                      departureTime: formatTime(tripPath[boardIdx].departure_time || tripPath[boardIdx].arrival_time),
                      toStopId: transferStop.stop_id,
                      toStopName: stops.get(transferStop.stop_id)?.stop_name || transferStop.stop_id,
                      arrivalTime: formatTime(transferStop.arrival_time),
                    },
                    {
                      type: "transfer",
                      fromStopId: transferStop.stop_id,
                      fromStopName: stops.get(transferStop.stop_id)?.stop_name || transferStop.stop_id,
                      toStopId: candStopId,
                      toStopName: stops.get(candStopId)?.stop_name || candStopId,
                      walkTime: (transferStop.stop_id === candStopId) ? 0 :
                        (transferIndex.get(transferStop.stop_id) || []).find(t => t.stopId === candStopId)?.walkTime || 0,
                      waitTime: onwardDepSec - alightSec,
                    },
                    {
                      type: "ride",
                      tripId: onward.trip_id,
                      routeShortName: onwardRouteData?.route_short_name || "",
                      routeLongName: onwardRouteData?.route_long_name || "",
                      routeType: onwardRouteData?.route_type || "",
                      fromStopId: candStopId,
                      fromStopName: stops.get(candStopId)?.stop_name || candStopId,
                      departureTime: formatTime(onward.departure_time || onward.arrival_time),
                      toStopId: finalStop.stop_id,
                      toStopName: stops.get(finalStop.stop_id)?.stop_name || finalStop.stop_id,
                      arrivalTime: formatTime(finalStop.arrival_time),
                    },
                  ],
                });

                if (finalArrSec < bestArrivalTime) bestArrivalTime = finalArrSec;
                if (results.length >= MAX_RESULTS) break;
              }
            }
            if (results.length >= MAX_RESULTS) break;
          }
          if (results.length >= MAX_RESULTS) break;
        }
        if (results.length >= MAX_RESULTS) break;
      }
    }
  }

  // Sort by departure time, prefer fewer transfers for same departure
  results.sort((a, b) => {
    const depDiff = a.departure.time.totalSeconds - b.departure.time.totalSeconds;
    if (Math.abs(depDiff) > 60) return depDiff;
    return a.transfers - b.transfers;
  });

  // For whole day mode, spread results across the day (one per hour slot)
  if (wholeDay) {
    const hourSlots = {};
    const spread = [];
    for (const r of results) {
      const hour = r.departure.time.h;
      const key = `${hour}_${r.transfers}`;
      if (!hourSlots[key]) {
        hourSlots[key] = r;
        spread.push(r);
      }
      if (spread.length >= 48) break;
    }
    if (spread.length > 0) {
      return { results: spread };
    }
  }

  // Final deduplication: group by route combo + departure minute
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = `${r.departure.time.totalSeconds}_${r.arrival.time.totalSeconds}_${r.segments.map(s => s.type === "ride" ? s.routeShortName : "X").join("_")}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
    if (deduped.length >= MAX_RESULTS) break;
  }

  return { results: deduped };
}

export function findDepartures(graph, stopId, hour, minute, maxCount = 20) {
  const { stops, stopTimesIndex, trips, routes } = graph;

  if (!stops.has(stopId)) return { error: "Megálló nem található" };

  const times = stopTimesIndex.get(stopId) || [];
  const startSeconds = hour * 3600 + minute * 60;
  const departures = [];

  for (const st of times) {
    const depTime = timeToSeconds(st.departure_time || st.arrival_time);
    if (depTime >= startSeconds && departures.length < maxCount) {
      const trip = trips.get(st.trip_id);
      const routeData = trip ? routes.get(trip.route_id) : null;

      departures.push({
        time: secondsToTime(depTime),
        routeShortName: routeData?.route_short_name || "",
        routeLongName: routeData?.route_long_name || "",
        routeType: routeData?.route_type || "",
        tripHeadsign: trip?.trip_headsign || "",
        stopId,
        stopName: stops.get(stopId)?.stop_name || stopId,
      });
    }
  }

  return { departures };
}
