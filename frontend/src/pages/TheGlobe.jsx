"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

function interpolateProjection(raw0, raw1) {
  const mutate = d3.geoProjectionMutator((t) => (x, y) => {
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

export function GlobeToMapTransform() {
  const { currentUser } = useAuth();
  const svgRef = useRef(null);

  const [isAnimating, setIsAnimating] = useState(false);
  const [progress, setProgress] = useState([0]);
  const [worldData, setWorldData] = useState([]);
  const [rotation, setRotation] = useState([0, 0]);
  const [translation, setTranslation] = useState([0, 0]);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [countryMarkers, setCountryMarkers] = useState([]);
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

  const width = 800;
  const height = 500;

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const loadWorldData = async () => {
      try {
        const response = await fetch(
          "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
        );
        const world = await response.json();
        const countries = feature(world, world.objects.countries).features;
        setWorldData(countries);
      } catch (error) {
        console.log("[v0] Error loading world data:", error);
        setWorldData([
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
        ]);
      }
    };

    loadWorldData();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchCountryRatings = async () => {
      if (!currentUser) {
        setCountryMarkers([]);
        return;
      }

      try {
        const token = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http")
          ? serverUrl
          : `http://${serverUrl}`;

        const response = await fetch(
          `${fullUrl}/api/users/globe/country-ratings?minUsers=1`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (!response.ok) {
          throw new Error(`Failed with ${response.status}`);
        }

        const data = await response.json();
        if (cancelled) return;

        const markers = Array.isArray(data?.markerCountries)
          ? data.markerCountries
              .filter(
                (item) =>
                  Number.isFinite(item?.lat) &&
                  Number.isFinite(item?.lng) &&
                  typeof item?.country === "string"
              )
              .map((item) => ({
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
              }))
          : [];

        const shuffled = [...markers];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        setCountryMarkers(shuffled);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch globe markers:", error);
          setCountryMarkers([]);
        }
      }
    };

    fetchCountryRatings();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

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

  const worldCentroids = useMemo(
    () => worldData.map((country) => d3.geoCentroid(country)),
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

  const handleWheel = (event) => {
    event.preventDefault();
    setZoom((prev) => clamp(prev + (event.deltaY > 0 ? -0.08 : 0.08), 0.6, 2.5));
  };

  useEffect(() => {
    if (!svgRef.current || worldData.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const t = progress[0] / 100;
    const alpha = Math.pow(t, 0.5);

    const scale = d3.scaleLinear().domain([0, 1]).range([200, 120]);
    const baseRotate = d3.scaleLinear().domain([0, 1]).range([0, 0]);

    const projection = interpolateProjection(
      d3.geoOrthographicRaw,
      d3.geoEquirectangularRaw
    )
      .scale(scale(alpha) * zoom)
      .translate([width / 2 + translation[0], height / 2 + translation[1]])
      .rotate([baseRotate(alpha) + rotation[0], rotation[1]])
      .precision(0.1);

    projection.alpha(alpha);

    const path = d3.geoPath(projection);
    const gridColor = isDark ? "#9ca3af" : "#c4c4c4";
    const countryColor = isDark ? "#b7b7b7" : "#bbbbbb";

    const markerFeatureById = new Map();
    const featureMarkerByIndex = new Map();

    countryMarkers.forEach((marker) => {
      let featureIndex = worldData.findIndex((country) =>
        d3.geoContains(country, [marker.lng, marker.lat])
      );

      if (featureIndex < 0 && worldCentroids.length > 0) {
        let nearestIndex = -1;
        let nearestDistance = Infinity;

        worldCentroids.forEach((centroid, index) => {
          const distance = d3.geoDistance([marker.lng, marker.lat], centroid);
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

    const defs = svg.append("defs");
    const hatch = defs
      .append("pattern")
      .attr("id", "country-hatch")
      .attr("width", 8)
      .attr("height", 8)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", "rotate(30)");

    hatch
      .append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 8)
      .attr("stroke", "var(--primary)")
      .attr("stroke-width", 2)
      .attr("opacity", isDark ? 0.45 : 0.35);

    const graticule = d3.geoGraticule();
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
        return markerColorMap.get(matchedMarker.id)?.alpha || 0.95;
      })
      .attr("stroke-width", (_, index) =>
        activeFeatureIndex === index ? 1.9 : 1.15
      )
      .attr("opacity", 1)
      .style("visibility", function () {
        const pathData = d3.select(this).attr("d");
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

    const projected = countryMarkers
      .map((marker) => {
        const point = projection([marker.lng, marker.lat]);
        if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          return null;
        }

        const isFrontFacing =
          t >= 0.55 ||
          d3.geoDistance([marker.lng, marker.lat], [-rotation[0], -rotation[1]]) <=
            Math.PI / 2;

        if (!isFrontFacing) return null;

        return {
          ...marker,
          x: offsetX + point[0] * fitScale,
          y: offsetY + point[1] * fitScale,
        };
      })
      .filter(Boolean);

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

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full cursor-grab bg-transparent active:cursor-grabbing"
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragRef.current.active = false;
          setHoveredMarkerId(null);
        }}
        onWheel={handleWheel}
      />

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

      {activeMarker ? (
        <div
          className="pointer-events-none absolute z-20 w-64 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-md border border-border/70 bg-background/95 px-3 py-2.5 text-xs leading-tight text-foreground shadow-md backdrop-blur-sm"
          style={{ left: activeMarker.x, top: activeMarker.y }}
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
        </div>
      ) : null}

      <div className="absolute bottom-4 right-4 z-20 flex gap-2">
        <Button
          onClick={handleAnimate}
          disabled={isAnimating}
          className="min-w-[120px] cursor-pointer rounded"
        >
          {isAnimating
            ? "Animating..."
            : progress[0] === 0
              ? "Unroll Globe"
              : "Roll to Globe"}
        </Button>
        <Button
          onClick={() => setZoom((prev) => clamp(prev + 0.12, 0.6, 2.5))}
          variant="outline"
          className="min-w-[42px] cursor-pointer rounded"
        >
          +
        </Button>
        <Button
          onClick={() => setZoom((prev) => clamp(prev - 0.12, 0.6, 2.5))}
          variant="outline"
          className="min-w-[42px] cursor-pointer rounded"
        >
          -
        </Button>
        <Button
          onClick={handleReset}
          variant="outline"
          className="min-w-[80px] cursor-pointer rounded"
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

export default function TheGlobe() {
  return <GlobeToMapTransform />;
}
