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

export function GlobeToMapTransform() {
  const { currentUser } = useAuth();
  const svgRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [progress, setProgress] = useState([0]);
  const [worldData, setWorldData] = useState([]);
  const [rotation, setRotation] = useState([0, 0]);
  const [translation, setTranslation] = useState([0, 0]);
  const [isDragging, setIsDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState([0, 0]);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [countryMarkers, setCountryMarkers] = useState([]);
  const [projectedMarkers, setProjectedMarkers] = useState([]);
  const [hoveredMarkerId, setHoveredMarkerId] = useState(null);

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
              .sort((a, b) => b.userCount - a.userCount)
              .slice(0, 16)
          : [];

        setCountryMarkers(markers);
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

  const hoveredMarker = useMemo(
    () => projectedMarkers.find((marker) => marker.id === hoveredMarkerId) || null,
    [projectedMarkers, hoveredMarkerId]
  );
  const hoveredMarkerRaw = useMemo(
    () => countryMarkers.find((marker) => marker.id === hoveredMarkerId) || null,
    [countryMarkers, hoveredMarkerId]
  );

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
        const fallbackData = [
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
        setWorldData(fallbackData);
      }
    };

    loadWorldData();
  }, []);

  const handleMouseDown = (event) => {
    setIsDragging(true);
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      setLastMouse([event.clientX - rect.left, event.clientY - rect.top]);
    }
  };

  const handleMouseMove = (event) => {
    if (!isDragging) return;

    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const currentMouse = [event.clientX - rect.left, event.clientY - rect.top];
    const dx = currentMouse[0] - lastMouse[0];
    const dy = currentMouse[1] - lastMouse[1];

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

    setLastMouse(currentMouse);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
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
      .scale(scale(alpha))
      .translate([width / 2 + translation[0], height / 2 + translation[1]])
      .rotate([baseRotate(alpha) + rotation[0], rotation[1]])
      .precision(0.1);

    projection.alpha(alpha);

    const path = d3.geoPath(projection);
    const gridColor = isDark ? "#9ca3af" : "#c4c4c4";
    const countryColor = isDark ? "#b7b7b7" : "#bbbbbb";
    const highlightColor = isDark ? "#e5e7eb" : "#525252";

    try {
      const graticule = d3.geoGraticule();
      const graticulePath = path(graticule());
      if (graticulePath) {
        svg
          .append("path")
          .datum(graticule())
          .attr("d", graticulePath)
          .attr("fill", "none")
          .attr("stroke", gridColor)
          .attr("stroke-width", 1)
          .attr("opacity", 0.28);
      }
    } catch (error) {
      console.log("[v0] Error creating graticule:", error);
    }

    const countriesSelection = svg
      .selectAll(".country")
      .data(worldData)
      .enter()
      .append("path")
      .attr("class", "country")
      .attr("d", (d) => {
        try {
          const pathString = path(d);
          if (!pathString) return "";
          if (
            typeof pathString === "string" &&
            (pathString.includes("NaN") || pathString.includes("Infinity"))
          ) {
            return "";
          }
          return pathString;
        } catch (error) {
          console.log("[v0] Error generating path for country:", error);
          return "";
        }
      })
      .attr("fill", "none")
      .attr("stroke", (d) => {
        if (!hoveredMarkerRaw) return countryColor;
        return d3.geoContains(d, [hoveredMarkerRaw.lng, hoveredMarkerRaw.lat])
          ? highlightColor
          : countryColor;
      })
      .attr("stroke-width", (d) => {
        if (!hoveredMarkerRaw) return 1;
        return d3.geoContains(d, [hoveredMarkerRaw.lng, hoveredMarkerRaw.lat]) ? 1.8 : 1;
      })
      .attr("opacity", 1)
      .style("visibility", function () {
        const pathData = d3.select(this).attr("d");
        return pathData && pathData.length > 0 && !pathData.includes("NaN")
          ? "visible"
          : "hidden";
      });

    if (hoveredMarkerRaw) {
      countriesSelection
        .filter((d) => d3.geoContains(d, [hoveredMarkerRaw.lng, hoveredMarkerRaw.lat]))
        .raise();
    }

    try {
      const sphereOutline = path({ type: "Sphere" });
      if (sphereOutline) {
        svg
          .append("path")
          .datum({ type: "Sphere" })
          .attr("d", sphereOutline)
          .attr("fill", "none")
          .attr("stroke", gridColor)
          .attr("stroke-width", 1)
          .attr("opacity", 1);
      }
    } catch (error) {
      console.log("[v0] Error creating sphere outline:", error);
    }

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
  }, [worldData, progress, rotation, translation, countryMarkers, isDark, hoveredMarkerRaw]);

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
      const currentProgress = startProgress + (endProgress - startProgress) * eased;

      setProgress([currentProgress]);

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
        onMouseLeave={handleMouseUp}
      />
      <div className="pointer-events-none absolute inset-0 z-10">
        {projectedMarkers.map((marker) => (
          <button
            key={marker.id}
            type="button"
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: marker.x, top: marker.y }}
            onMouseEnter={() => setHoveredMarkerId(marker.id)}
            onMouseLeave={() =>
              setHoveredMarkerId((current) => (current === marker.id ? null : current))
            }
          >
            <span className="block size-2 rounded-full bg-primary shadow-[0_0_6px_color-mix(in_oklch,var(--primary)_45%,transparent)]" />
          </button>
        ))}
      </div>

      {hoveredMarker ? (
        <div
          className="pointer-events-none absolute z-20 w-56 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-md border border-border/70 bg-background/95 px-2.5 py-2 text-[11px] leading-tight text-foreground shadow-md backdrop-blur-sm"
          style={{ left: hoveredMarker.x, top: hoveredMarker.y }}
        >
          <div className="mb-1 truncate text-xs font-semibold">{hoveredMarker.country}</div>
          <div className="tabular-nums text-muted-foreground">
            Average rating: {Math.round(hoveredMarker.avgRating)}
          </div>
          <div className="tabular-nums text-muted-foreground">
            Average win rate:{" "}
            {Number.isFinite(hoveredMarker.avgWinRate)
              ? `${Math.round(hoveredMarker.avgWinRate)}%`
              : "N/A"}
          </div>
          <div className="tabular-nums text-muted-foreground">
            Most played mode:{" "}
            {hoveredMarker.mostPlayedMode ? `${hoveredMarker.mostPlayedMode}s` : "N/A"}
          </div>
        </div>
      ) : null}

      <div className="absolute bottom-4 right-4 z-10 flex gap-2">
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
