import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { bisector } from "d3-array";
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { ChartProvider } from "./chart-context";
import { Line } from "./line";
import { useChartInteraction } from "./use-chart-interaction";

function isPostOverlayComponent(child) {
  const childType = child.type;

  if (childType.__isChartMarkers) {
    return true;
  }

  const componentName =
    typeof child.type === "function"
      ? childType.displayName || childType.name || ""
      : "";

  return componentName === "ChartMarkers" || componentName === "MarkerGroup";
}

const DEFAULT_MARGIN = { top: 40, right: 40, bottom: 40, left: 40 };

function extractLineConfigs(children) {
  const configs = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return;
    }

    const childType = child.type;
    const componentName =
      typeof child.type === "function"
        ? childType.displayName || childType.name || ""
        : "";

    const props = child.props;
    const isLineComponent =
      componentName === "Line" ||
      child.type === Line ||
      (props && typeof props.dataKey === "string" && props.dataKey.length > 0);

    if (isLineComponent && props?.dataKey) {
      configs.push({
        dataKey: props.dataKey,
        stroke: props.stroke || "var(--chart-line-primary)",
        strokeWidth: props.strokeWidth || 2.5,
      });
    }
  });

  return configs;
}

function ChartInner({
  width,
  height,
  data,
  xDataKey,
  xScaleType,
  margin,
  animationDuration,
  children,
  containerRef,
}) {
  const [isLoaded, setIsLoaded] = useState(false);

  const lines = useMemo(() => extractLineConfigs(children), [children]);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xAccessor = useCallback(
    (d) => {
      const value = d[xDataKey];
      if (xScaleType === "linear") {
        return typeof value === "number" ? value : Number(value);
      }

      return value instanceof Date ? value : new Date(value);
    },
    [xDataKey, xScaleType]
  );

  const bisectX = useMemo(() => bisector((d) => xAccessor(d)).left, [xAccessor]);

  const xScale = useMemo(() => {
    if (xScaleType === "linear") {
      const values = data
        .map((d) => xAccessor(d))
        .filter((value) => Number.isFinite(value));

      const minValue = values.length ? Math.min(...values) : 0;
      const maxValue = values.length ? Math.max(...values) : 1;
      const safeMax = minValue === maxValue ? minValue + 1 : maxValue;

      return scaleLinear({
        range: [0, innerWidth],
        domain: [minValue, safeMax],
      });
    }

    const dates = data.map((d) => xAccessor(d));
    const minTime = Math.min(...dates.map((d) => d.getTime()));
    const maxTime = Math.max(...dates.map((d) => d.getTime()));

    return scaleTime({
      range: [0, innerWidth],
      domain: [minTime, maxTime],
    });
  }, [innerWidth, data, xAccessor, xScaleType]);

  const columnWidth = useMemo(() => {
    if (data.length < 2) {
      return 0;
    }
    return innerWidth / (data.length - 1);
  }, [innerWidth, data.length]);

  const yScale = useMemo(() => {
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;
    for (const line of lines) {
      for (const d of data) {
        const value = d[line.dataKey];
        if (typeof value === "number") {
          if (value < minValue) minValue = value;
          if (value > maxValue) maxValue = value;
        }
      }
    }

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      minValue = 0;
      maxValue = 100;
    }

    const range = Math.max(1, maxValue - minValue);
    const padding = Math.max(2, range * 0.15);

    return scaleLinear({
      range: [innerHeight, 0],
      domain: [minValue - padding, maxValue + padding],
      nice: true,
    });
  }, [innerHeight, data, lines]);

  const dateLabels = useMemo(
    () =>
      data.map((d, index) => {
        const xValue = xAccessor(d);
        if (xValue instanceof Date) {
          return xValue.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
        }

        return `Game ${index + 1}`;
      }),
    [data, xAccessor]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoaded(true);
    }, animationDuration);
    return () => clearTimeout(timer);
  }, [animationDuration]);

  const canInteract = isLoaded;

  const {
    tooltipData,
    setTooltipData,
    selection,
    clearSelection,
    interactionHandlers,
    interactionStyle,
  } = useChartInteraction({
    xScale,
    yScale,
    data,
    lines,
    margin,
    xAccessor,
    bisectDate: bisectX,
    canInteract,
  });

  if (width < 10 || height < 10) {
    return null;
  }

  const preOverlayChildren = [];
  const postOverlayChildren = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return;
    }

    if (isPostOverlayComponent(child)) {
      postOverlayChildren.push(child);
    } else {
      preOverlayChildren.push(child);
    }
  });

  const contextValue = {
    data,
    xScale,
    yScale,
    width,
    height,
    innerWidth,
    innerHeight,
    margin,
    columnWidth,
    tooltipData,
    setTooltipData,
    containerRef,
    lines,
    isLoaded,
    animationDuration,
    xAccessor,
    xScaleType,
    dateLabels,
    selection,
    clearSelection,
  };

  return (
    <ChartProvider value={contextValue}>
      <svg aria-hidden="true" height={height} width={width}>
        <defs>
          <clipPath id="chart-grow-clip">
            <rect
              height={innerHeight + 20}
              style={{
                transition: isLoaded
                  ? "none"
                  : `width ${animationDuration}ms cubic-bezier(0.85, 0, 0.15, 1)`,
              }}
              width={isLoaded ? innerWidth : 0}
              x={0}
              y={0}
            />
          </clipPath>
        </defs>

        <rect fill="transparent" height={height} width={width} x={0} y={0} />

        <g
          {...interactionHandlers}
          style={interactionStyle}
          transform={`translate(${margin.left},${margin.top})`}
        >
          <rect fill="transparent" height={innerHeight} width={innerWidth} x={0} y={0} />

          {preOverlayChildren}
          {postOverlayChildren}
        </g>
      </svg>
    </ChartProvider>
  );
}

export function LineChart({
  data,
  xDataKey = "date",
  xScaleType = "time",
  margin: marginProp,
  animationDuration = 1100,
  aspectRatio = "2 / 1",
  className = "",
  children,
}) {
  const containerRef = useRef(null);
  const margin = { ...DEFAULT_MARGIN, ...marginProp };

  return (
    <div
      className={cn("relative w-full", className)}
      ref={containerRef}
      style={{ aspectRatio, touchAction: "none" }}
    >
      <ParentSize debounceTime={10}>
        {({ width, height }) => (
          <ChartInner
            animationDuration={animationDuration}
            containerRef={containerRef}
            data={data}
            height={height}
            margin={margin}
            width={width}
            xDataKey={xDataKey}
            xScaleType={xScaleType}
          >
            {children}
          </ChartInner>
        )}
      </ParentSize>
    </div>
  );
}

export { Line } from "./line";

export default LineChart;
