"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoCentroid,
  geoContains,
  geoDistance,
  geoEquirectangularRaw,
  geoGraticule,
  geoOrthographicRaw,
  geoPath,
  geoProjectionMutator,
  scaleLinear,
  select,
} from "d3";
import { feature } from "topojson-client";
import { useQuery } from "@tanstack/react-query";
import { m, useReducedMotion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/api-client";
import { globeKeys } from "@/lib/query-keys";

const FALLBACK_WORLD = [
  {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-180, -90],
          [180, -90],
          [180, 90],
          [-180, 90],
          [-180, -90],
        ],
      ],
    },
    properties: {},
  },
];

function interpolateProjection(raw0, raw1) {
  const mutate = geoProjectionMutator((t) => (x, y) => {
    const [x0, y0] = raw0(x, y);
    const [x1, y1] = raw1(x, y);
    return [x0 + t * (x1 - x0), y0 + t * (y1 - y0)];
  });

  let t = 0;
  return Object.assign(mutate(t), {
    alpha(next) {
      if (arguments.length) {
        t = +next;
        return mutate(t);
      }
      return t;
    },
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function colorFromIndex(index) {
  const colorVars = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];
  const base = colorVars[index % colorVars.length];
  const tier = Math.floor(index / colorVars.length);
  const alpha = clamp(0.9 - tier * 0.12, 0.38, 0.9);
  return { base, alpha };
}

function useGlobeTransform() {
  const { state: { currentUser } } = useAuth();
  const svgRef = useRef(null);

  const [isAnimating, setIsAnimating] = useState(false);
  const [progress, setProgress] = useState([0]);
  const [rotation, setRotation] = useState([0, 0]);
  const [translation, setTranslation] = useState([0, 0]);
  const [isDark, setIsDark] = useState(() => {
    const stored =
      (typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null) ||
      "light";
    return (
      document.documentElement.classList.contains("dark") || stored === "dark"
    );
  });
  const [projectedMarkers, setProjectedMarkers] = useState([]);
  const [hoveredMarkerId, setHoveredMarkerId] = useState(null);
  const [zoom, setZoom] = useState(1);

  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });

  const touchRef = useRef({ pinchStartDist: 0, pinchStartZoom: 1 });

  const width = 800;
  const height = 500;

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => setIsDark(root.classList.contains("dark"));
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const worldQuery = useQuery({
    queryKey: ["world-atlas", "countries-110m"],
    queryFn: async () => {
      try {
        const response = await fetch(
          "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
        );
        if (!response.ok) {
          throw new Error(`Failed to load world atlas (${response.status})`);
        }
        const world = await response.json();
        return feature(world, world.objects.countries).features;
      } catch (error) {
        console.error("[v0] Error loading world data:", error);
        return FALLBACK_WORLD;
      }
    },
    staleTime: Infinity,
  });

  const worldData = useMemo(
    () => worldQuery.data ?? FALLBACK_WORLD,
    [worldQuery.data]
  );

  const countryRatingsQuery = useQuery({
    queryKey: globeKeys.countryRatings(),
    queryFn: () =>
      apiFetch(
        currentUser,
        "/api/users/globe/country-ratings?minUsers=1"
      ).then(({ data }) => (Array.isArray(data?.markerCountries) ? data.markerCountries : [])),
    enabled: Boolean(currentUser),
    staleTime: 5 * 60 * 1000,
  });

  const countryMarkers = useMemo(() => {
    const markers = (countryRatingsQuery.data ?? []).flatMap((item) => {
      if (
        !Number.isFinite(item?.lat) ||
        !Number.isFinite(item?.lng) ||
        typeof item?.country !== "string"
      ) {
        return [];
      }

      return [
        {
          id: item.country,
          country: item.country,
          lat: Number(item.lat),
          lng: Number(item.lng),
          avgRating: Number(item.avgRating || 0),
          avgWinRate: Number.isFinite(Number(item.avgWinRate))
            ? Number(item.avgWinRate)
            : null,
          mostPlayedMode: Number(item.mostPlayedMode || 0) || null,
          userCount: Number(item.userCount || 0),
        },
      ];
    });

    const shuffled = [...markers];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }, [countryRatingsQuery.data]);

  const markerById = useMemo(() => {
    const next = new Map();
    countryMarkers.forEach((marker) => {
      next.set(marker.id, marker);
    });
    return next;
  }, [countryMarkers]);

  const markerColorMap = useMemo(() => {
    const next = new Map();
    countryMarkers.forEach((marker, index) => {
      next.set(marker.id, colorFromIndex(index));
    });
    return next;
  }, [countryMarkers]);

  const globeStats = useMemo(() => {
    if (countryMarkers.length === 0) return null;

    const totalPlayers = countryMarkers.reduce(
      (sum, marker) => sum + marker.userCount,
      0
    );
    const topRated = countryMarkers.reduce((best, marker) =>
      marker.avgRating > best.avgRating ? marker : best
    );
    const modeCounts = new Map();
    countryMarkers.forEach((marker) => {
      if (!marker.mostPlayedMode) return;
      modeCounts.set(
        marker.mostPlayedMode,
        (modeCounts.get(marker.mostPlayedMode) ?? 0) + 1
      );
    });
    const mostPlayedMode =
      [...modeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      totalCountries: countryMarkers.length,
      totalPlayers,
      topRated,
      mostPlayedMode,
    };
  }, [countryMarkers]);

  const worldCentroids = useMemo(
    () => worldData.map((country) => geoCentroid(country)),
    [worldData]
  );

  const hoveredMarker = useMemo(
    () => projectedMarkers.find((marker) => marker.id === hoveredMarkerId) || null,
    [projectedMarkers, hoveredMarkerId]
  );

  const activeMarkerSource = hoveredMarkerId
    ? markerById.get(hoveredMarkerId) || null
    : null;
  const activeMarker = hoveredMarker;
  const activeMarkerUserCount = Number(
    activeMarkerSource?.userCount ?? activeMarker?.userCount ?? NaN
  );

  const getNearestProjectedMarker = (x, y) => {
    let nearest = null;
    let nearestDistance = Infinity;

    for (const marker of projectedMarkers) {
      const dx = marker.x - x;
      const dy = marker.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = marker;
      }
    }

    if (!nearest || nearestDistance > 20) return null;
    return nearest;
  };

  const handleMouseDown = (event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragRef.current.active = true;
    dragRef.current.moved = false;
    dragRef.current.startX = event.clientX - rect.left;
    dragRef.current.startY = event.clientY - rect.top;
    dragRef.current.lastX = dragRef.current.startX;
    dragRef.current.lastY = dragRef.current.startY;
  };

  const handleMouseMove = (event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const nearest = getNearestProjectedMarker(x, y);
    setHoveredMarkerId(nearest?.id || null);

    if (!dragRef.current.active) return;

    const totalDx = x - dragRef.current.startX;
    const totalDy = y - dragRef.current.startY;

    if (Math.hypot(totalDx, totalDy) > 4) {
      dragRef.current.moved = true;
    }

    rotateByDrag(x, y);
  };

  const handleMouseUp = (event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      dragRef.current.active = false;
      return;
    }

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = getNearestProjectedMarker(x, y);

    if (!dragRef.current.moved) {
      setHoveredMarkerId(nearest?.id || null);
    }

    dragRef.current.active = false;
  };

  const handleMouseLeave = () => {
    dragRef.current.active = false;
    setHoveredMarkerId(null);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    setZoom((prev) => clamp(prev + (event.deltaY > 0 ? -0.08 : 0.08), 0.6, 2.5));
  };

  const getTouchPoint = (touch) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };

  const rotateByDrag = (x, y) => {
    const dx = x - dragRef.current.lastX;
    const dy = y - dragRef.current.lastY;
    const totalDx = x - dragRef.current.startX;
    const totalDy = y - dragRef.current.startY;

    if (Math.hypot(totalDx, totalDy) > 4) {
      dragRef.current.moved = true;
    }

    const t = progress[0] / 100;
    if (t < 0.5) {
      const sensitivity = 0.5;
      setRotation((prev) => [
        prev[0] + dx * sensitivity,
        Math.max(-90, Math.min(90, prev[1] - dy * sensitivity)),
      ]);
    } else {
      const sensitivityMap = 0.25;
      setRotation((prev) => [
        prev[0] + dx * sensitivityMap,
        Math.max(-90, Math.min(90, prev[1] - dy * sensitivityMap)),
      ]);
    }

    dragRef.current.lastX = x;
    dragRef.current.lastY = y;
  };

  const handleTouchStart = (event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (event.touches.length === 1) {
      const point1 = getTouchPoint(event.touches[0]);
      if (!point1) return;
      dragRef.current.active = true;
      dragRef.current.moved = false;
      dragRef.current.startX = point1.x;
      dragRef.current.startY = point1.y;
      dragRef.current.lastX = point1.x;
      dragRef.current.lastY = point1.y;
      touchRef.current.pinchStartDist = 0;
    } else if (event.touches.length === 2) {
      dragRef.current.active = false;
      const a = getTouchPoint(event.touches[0]);
      const b = getTouchPoint(event.touches[1]);
      if (!a || !b) return;
      touchRef.current.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      touchRef.current.pinchStartZoom = zoom;
    }
  };

  const handleTouchMove = (event) => {
    if (event.touches.length === 2) {
      const a = getTouchPoint(event.touches[0]);
      const b = getTouchPoint(event.touches[1]);
      if (!a || !b || !touchRef.current.pinchStartDist) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const next = clamp(
        touchRef.current.pinchStartZoom * (dist / touchRef.current.pinchStartDist),
        0.6,
        2.5
      );
      setZoom(next);
      return;
    }

    if (event.touches.length === 1 && dragRef.current.active) {
      const point = getTouchPoint(event.touches[0]);
      if (!point) return;
      rotateByDrag(point.x, point.y);
    }
  };

  const handleTouchEnd = (event) => {
    dragRef.current.active = false;
    touchRef.current.pinchStartDist = 0;

    const touch = event.changedTouches?.[0];
    if (!touch || dragRef.current.moved) return;
    const point = getTouchPoint(touch);
    if (!point) return;
    const nearest = getNearestProjectedMarker(point.x, point.y);
    setHoveredMarkerId(nearest?.id || null);
  };

  useEffect(() => {
    if (!svgRef.current || worldData.length === 0) return;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const t = progress[0] / 100;
    const alpha = Math.pow(t, 0.5);

    const scale = scaleLinear().domain([0, 1]).range([200, 120]);
    const baseRotate = scaleLinear().domain([0, 1]).range([0, 0]);

    const projection = interpolateProjection(
      geoOrthographicRaw,
      geoEquirectangularRaw
    )
      .scale(scale(alpha) * zoom)
      .translate([width / 2 + translation[0], height / 2 + translation[1]])
      .rotate([baseRotate(alpha) + rotation[0], rotation[1]])
      .precision(0.1);

    projection.alpha(alpha);

    const path = geoPath(projection);
    const gridColor = isDark ? "#9ca3af" : "#c4c4c4";
    const countryColor = isDark ? "#b7b7b7" : "#bbbbbb";

    const markerFeatureById = new Map();
    const featureMarkerByIndex = new Map();

    countryMarkers.forEach((marker) => {
      let featureIndex = worldData.findIndex((country) =>
        geoContains(country, [marker.lng, marker.lat])
      );

      if (featureIndex < 0 && worldCentroids.length > 0) {
        let nearestIndex = -1;
        let nearestDistance = Infinity;

        worldCentroids.forEach((centroid, index) => {
          const distance = geoDistance([marker.lng, marker.lat], centroid);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
          }
        });
        featureIndex = nearestIndex;
      }

      if (featureIndex >= 0) {
        markerFeatureById.set(marker.id, featureIndex);
        const current = featureMarkerByIndex.get(featureIndex);
        if (!current || marker.userCount > current.userCount) {
          featureMarkerByIndex.set(featureIndex, marker);
        }
      }
    });

    const activeFeatureIndex =
      activeMarkerSource && markerFeatureById.has(activeMarkerSource.id)
        ? markerFeatureById.get(activeMarkerSource.id)
        : null;
    const activeFeatureMarker =
      activeFeatureIndex !== null ? featureMarkerByIndex.get(activeFeatureIndex) : null;
    const activeFeatureStroke = activeFeatureMarker
      ? markerColorMap.get(activeFeatureMarker.id)?.base || countryColor
      : countryColor;
    const activeFeatureStrokeOpacity = 1;

    const defs = svg.append("defs");
    const hatch = defs
      .append("pattern")
      .attr("id", "country-hatch")
      .attr("width", 8)
      .attr("height", 8)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", "rotate(30)");

    hatch
      .append("rect")
      .attr("width", 8)
      .attr("height", 8)
      .attr("fill", activeFeatureStroke)
      .attr("opacity", 0.14);

    hatch
      .append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 8)
      .attr("stroke", activeFeatureStroke)
      .attr("stroke-width", 2)
      .attr("opacity", activeFeatureStrokeOpacity);

    const graticule = geoGraticule();
    svg
      .append("path")
      .datum(graticule())
      .attr("d", path(graticule()))
      .attr("fill", "none")
      .attr("stroke", gridColor)
      .attr("stroke-width", 1)
      .attr("opacity", 0.28);

    const countriesSelection = svg
      .selectAll(".country")
      .data(worldData)
      .enter()
      .append("path")
      .attr("class", "country")
      .attr("d", (d) => path(d) || "")
      .attr("fill", (_, index) =>
        activeFeatureIndex === index ? "url(#country-hatch)" : "none"
      )
      .attr("stroke", (_, index) => {
        const matchedMarker = featureMarkerByIndex.get(index);
        if (!matchedMarker) return countryColor;
        return markerColorMap.get(matchedMarker.id)?.base || countryColor;
      })
      .attr("stroke-opacity", (_, index) => {
        const matchedMarker = featureMarkerByIndex.get(index);
        if (!matchedMarker) return 0.95;
        return 1;
      })
      .attr("stroke-width", (_, index) =>
        activeFeatureIndex === index ? 2.05 : featureMarkerByIndex.has(index) ? 2.05 : 1.15
      )
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("vector-effect", "non-scaling-stroke")
      .attr("opacity", 1)
      .style("visibility", function () {
        const pathData = select(this).attr("d");
        return pathData && pathData.length > 0 && !pathData.includes("NaN")
          ? "visible"
          : "hidden";
      });

    if (activeFeatureIndex !== null) {
      countriesSelection
        .filter((_, index) => index === activeFeatureIndex)
        .raise();
    }

    svg
      .append("path")
      .datum({ type: "Sphere" })
      .attr("d", path({ type: "Sphere" }))
      .attr("fill", "none")
      .attr("stroke", gridColor)
      .attr("stroke-width", 1)
      .attr("opacity", 1);

    const fitScale = Math.min(
      width > 0 ? svgRef.current.clientWidth / width : 1,
      height > 0 ? svgRef.current.clientHeight / height : 1
    );
    const renderWidth = width * fitScale;
    const renderHeight = height * fitScale;
    const offsetX = (svgRef.current.clientWidth - renderWidth) / 2;
    const offsetY = (svgRef.current.clientHeight - renderHeight) / 2;

    const projected = countryMarkers.flatMap((marker) => {
      const point = projection([marker.lng, marker.lat]);
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        return [];
      }

      const isFrontFacing =
        t >= 0.55 ||
        geoDistance([marker.lng, marker.lat], [-rotation[0], -rotation[1]]) <=
          Math.PI / 2;

      if (!isFrontFacing) return [];

      return [
        {
          ...marker,
          x: offsetX + point[0] * fitScale,
          y: offsetY + point[1] * fitScale,
        },
      ];
    });

    setProjectedMarkers(projected);
  }, [
    worldData,
    progress,
    rotation,
    translation,
    countryMarkers,
    worldCentroids,
    isDark,
    zoom,
    markerColorMap,
    activeMarkerSource,
  ]);

  const handleAnimate = () => {
    if (isAnimating) return;

    setIsAnimating(true);
    const startProgress = progress[0];
    const endProgress = startProgress === 0 ? 100 : 0;
    const duration = 2000;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setProgress([startProgress + (endProgress - startProgress) * eased]);

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
      }
    };

    animate();
  };

  const handleReset = () => {
    setRotation([0, 0]);
    setTranslation([0, 0]);
    setZoom(1);
    setHoveredMarkerId(null);
  };

  const handleZoomIn = () => setZoom((prev) => clamp(prev + 0.12, 0.6, 2.5));
  const handleZoomOut = () => setZoom((prev) => clamp(prev - 0.12, 0.6, 2.5));

  return {
    svgRef,
    width,
    height,
    isDark,
    projectedMarkers,
    markerColorMap,
    globeStats,
    activeMarker,
    activeMarkerUserCount,
    isAnimating,
    progress,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleAnimate,
    handleReset,
    handleZoomIn,
    handleZoomOut,
  };
}

function GlobeBackground({ isDark }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        background: isDark
          ? "radial-gradient(125% 125% at 50% 10%, #000000 40%, #072607 100%)"
          : "radial-gradient(125% 125% at 50% 10%, #ffffff 40%, color-mix(in oklab, var(--primary) 55%, white) 100%)",
      }}
    />
  );
}

function GlobeInteractiveSvg({
  svgRef,
  width,
  height,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onWheel,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}) {
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full touch-none cursor-grab bg-transparent active:cursor-grabbing"
      preserveAspectRatio="xMidYMid meet"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    />
  );
}

function GlobeMarkersLayer({ projectedMarkers, markerColorMap }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {projectedMarkers.map((marker) => {
        const colorToken = markerColorMap.get(marker.id);
        return (
          <div
            key={marker.id}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: marker.x, top: marker.y }}
          >
            <span
              className="block size-2.5 rotate-45 border border-background/60 shadow-sm"
              style={{
                background: colorToken?.base || "var(--primary)",
                opacity: colorToken?.alpha || 0.85,
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{
                borderColor: colorToken?.base || "var(--primary)",
                opacity: 0.3,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function GlobeActiveMarkerTooltip({ activeMarker, activeMarkerUserCount, cardWidth }) {
  if (!activeMarker) return null;

  const TIP_WIDTH = 256;
  const EDGE = 8;
  const tight = Math.max(TIP_WIDTH / 2 + EDGE, 0);
  const clampedX = Number.isFinite(Number(cardWidth))
    ? Math.min(Math.max(activeMarker.x, tight), Math.max(tight, cardWidth - TIP_WIDTH / 2 - EDGE))
    : activeMarker.x;
  const clampedY = Math.max(activeMarker.y, 160);

  return (
    <>
      <div
        className="pointer-events-none absolute z-20 hidden w-64 rounded-md border border-border/70 bg-background/95 px-3 py-2.5 text-xs leading-tight text-foreground shadow-md backdrop-blur-sm sm:block -translate-x-1/2 -translate-y-[calc(100%+12px)]"
        style={{ left: clampedX, top: clampedY }}
      >
        <div className="mb-1 truncate text-xs font-semibold">{activeMarker.country}</div>
        <div className="tabular-nums text-muted-foreground">
          Average rating: {Math.round(activeMarker.avgRating)}
        </div>
        <div className="tabular-nums text-muted-foreground">
          Average win rate: {Number.isFinite(activeMarker.avgWinRate) ? `${Math.round(activeMarker.avgWinRate)}%` : "N/A"}
        </div>
        <div className="tabular-nums text-muted-foreground">
          Most played mode: {activeMarker.mostPlayedMode ? `${activeMarker.mostPlayedMode}s` : "N/A"}
        </div>
        <div className="tabular-nums text-muted-foreground">
          Players: {Number.isFinite(activeMarkerUserCount) ? activeMarkerUserCount.toLocaleString() : "N/A"}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border/70 bg-background/95 px-3 py-2 text-xs leading-tight text-foreground shadow-md backdrop-blur-sm sm:hidden">
        <span className="truncate font-semibold">{activeMarker.country}</span>
        <span className="tabular-nums text-muted-foreground">
          {Math.round(activeMarker.avgRating)} rating ·{" "}
          {Number.isFinite(activeMarker.avgWinRate) ? `${Math.round(activeMarker.avgWinRate)}% WR` : "N/A"}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {activeMarker.mostPlayedMode ? `${activeMarker.mostPlayedMode}s` : "N/A"} ·{" "}
          {Number.isFinite(activeMarkerUserCount) ? `${activeMarkerUserCount} players` : "N/A"}
        </span>
      </div>
    </>
  );
}

function GlobeStatCard({ label, value }) {
  return (
    <div className="rounded-md border border-border/70 bg-card/85 p-4 backdrop-blur-[1px]">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 truncate text-lg font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}

function GlobeControls({
  isAnimating,
  progress,
  onAnimate,
  onZoomIn,
  onZoomOut,
  onReset,
}) {
  return (
    <div className="absolute bottom-2 right-2 z-20 flex max-w-full flex-wrap items-center justify-end gap-1.5 sm:bottom-4 sm:right-4 sm:gap-2">
      <Button
        onClick={onAnimate}
        disabled={isAnimating}
        className="min-w-0 flex-1 cursor-pointer rounded px-2.5 text-xs sm:flex-none sm:min-w-[120px] sm:px-4 sm:text-sm"
      >
        {isAnimating
          ? "Animating..."
          : progress[0] === 0
            ? "Unroll Globe"
            : "Roll to Globe"}
      </Button>
      <Button
        onClick={onZoomIn}
        variant="outline"
        className="min-w-10 shrink-0 cursor-pointer rounded px-0 sm:min-w-[42px]"
        aria-label="Zoom in"
      >
        +
      </Button>
      <Button
        onClick={onZoomOut}
        variant="outline"
        className="min-w-10 shrink-0 cursor-pointer rounded px-0 sm:min-w-[42px]"
        aria-label="Zoom out"
      >
        -
      </Button>
      <Button
        onClick={onReset}
        variant="outline"
        className="min-w-0 shrink-0 cursor-pointer rounded px-2.5 text-xs sm:min-w-[80px] sm:px-4 sm:text-sm"
      >
        Reset
      </Button>
    </div>
  );
}

export function GlobeToMapTransform() {
  const {
    svgRef,
    width,
    height,
    isDark,
    projectedMarkers,
    markerColorMap,
    globeStats,
    activeMarker,
    activeMarkerUserCount,
    isAnimating,
    progress,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleAnimate,
    handleReset,
    handleZoomIn,
    handleZoomOut,
  } = useGlobeTransform();
  const reduceMotion = useReducedMotion();
  const cardRef = useRef(null);
  const [cardWidth, setCardWidth] = useState(0);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const update = () => setCardWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <m.header
        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.06 }}
        className="border-b border-border/70 pb-4"
      >
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
          Global Community
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">The Globe</h1>
      </m.header>

      <m.div
        ref={cardRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="relative isolate flex w-full min-h-[300px] flex-1 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-card"
      >
        <GlobeBackground isDark={isDark} />
        <GlobeInteractiveSvg
          svgRef={svgRef}
          width={width}
          height={height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
        <GlobeMarkersLayer projectedMarkers={projectedMarkers} markerColorMap={markerColorMap} />
        <GlobeActiveMarkerTooltip activeMarker={activeMarker} activeMarkerUserCount={activeMarkerUserCount} cardWidth={cardWidth} />
      <GlobeControls
        isAnimating={isAnimating}
        progress={progress}
        onAnimate={handleAnimate}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
      />
      </m.div>

      <m.section
        initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.12 }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <GlobeStatCard
            label="Countries mapped"
            value={globeStats ? globeStats.totalCountries : "—"}
          />
          <GlobeStatCard
            label="Players represented"
            value={globeStats ? globeStats.totalPlayers.toLocaleString() : "—"}
          />
          <GlobeStatCard
            label="Top rated country"
            value={globeStats ? globeStats.topRated.country : "—"}
          />
          <GlobeStatCard
            label="Most played mode"
            value={globeStats && globeStats.mostPlayedMode
              ? `${globeStats.mostPlayedMode}s`
              : "—"}
          />
        </div>
      </m.section>
    </div>
  );
}

export default function TheGlobe() {
  return <GlobeToMapTransform />;
}
