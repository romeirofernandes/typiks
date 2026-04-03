import { localPoint } from "@visx/event";
import { useCallback, useRef, useState } from "react";

export function useChartInteraction(
  {
    xScale,
    yScale,
    data,
    lines,
    margin,
    xAccessor,
    bisectDate,
    canInteract
  }
) {
  const [tooltipData, setTooltipData] = useState(null);
  const [selection, setSelection] = useState(null);

  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);

  const toComparableX = useCallback((value) => {
    if (value instanceof Date) {
      return value.getTime();
    }

    return Number(value);
  }, []);

  const resolveTooltipFromX = useCallback(pixelX => {
    const x0 = xScale.invert(pixelX);
    const index = bisectDate(data, x0, 1);
    const d0 = data[index - 1];
    const d1 = data[index];

    if (!d0) {
      return null;
    }

    let d = d0;
    let finalIndex = index - 1;
    if (d1) {
      const x0Value = toComparableX(x0);
      const d0Value = toComparableX(xAccessor(d0));
      const d1Value = toComparableX(xAccessor(d1));
      if (x0Value - d0Value > d1Value - x0Value) {
        d = d1;
        finalIndex = index;
      }
    }

    const yPositions = {};
    for (const line of lines) {
      const value = d[line.dataKey];
      if (typeof value === "number") {
        yPositions[line.dataKey] = yScale(value) ?? 0;
      }
    }

    return {
      point: d,
      index: finalIndex,
      x: xScale(xAccessor(d)) ?? 0,
      yPositions,
    };
  }, [xScale, yScale, data, lines, xAccessor, bisectDate, toComparableX]);

  const resolveIndexFromX = useCallback(pixelX => {
    const x0 = xScale.invert(pixelX);
    const index = bisectDate(data, x0, 1);
    const d0 = data[index - 1];
    const d1 = data[index];
    if (!d0) {
      return 0;
    }
    if (d1) {
      const x0Value = toComparableX(x0);
      const d0Value = toComparableX(xAccessor(d0));
      const d1Value = toComparableX(xAccessor(d1));
      if (x0Value - d0Value > d1Value - x0Value) {
        return index;
      }
    }
    return index - 1;
  }, [xScale, data, xAccessor, bisectDate, toComparableX]);

  const getChartX = useCallback((event, touchIndex = 0) => {
    let point = null;

    if ("touches" in event) {
      const touch = event.touches[touchIndex];
      if (!touch) {
        return null;
      }
      const svg = event.currentTarget.ownerSVGElement;
      if (!svg) {
        return null;
      }
      point = localPoint(svg, touch);
    } else {
      point = localPoint(event);
    }

    if (!point) {
      return null;
    }
    return point.x - margin.left;
  }, [margin.left]);

  // --- Mouse handlers ---

  const handleMouseMove = useCallback((event) => {
    const chartX = getChartX(event);
    if (chartX === null) {
      return;
    }

    if (isDraggingRef.current) {
      const startX = Math.min(dragStartXRef.current, chartX);
      const endX = Math.max(dragStartXRef.current, chartX);
      setSelection({
        startX,
        endX,
        startIndex: resolveIndexFromX(startX),
        endIndex: resolveIndexFromX(endX),
        active: true,
      });
      return;
    }

    const tooltip = resolveTooltipFromX(chartX);
    if (tooltip) {
      setTooltipData(tooltip);
    }
  }, [getChartX, resolveTooltipFromX, resolveIndexFromX]);

  const handleMouseLeave = useCallback(() => {
    setTooltipData(null);
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
    }
    setSelection(null);
  }, []);

  const handleMouseDown = useCallback((event) => {
    const chartX = getChartX(event);
    if (chartX === null) {
      return;
    }
    isDraggingRef.current = true;
    dragStartXRef.current = chartX;
    setTooltipData(null);
    setSelection(null);
  }, [getChartX]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
    }
    setSelection(null);
  }, []);

  // --- Touch handlers ---

  const handleTouchStart = useCallback((event) => {
    if (event.touches.length === 1) {
      event.preventDefault();
      const chartX = getChartX(event, 0);
      if (chartX === null) {
        return;
      }
      const tooltip = resolveTooltipFromX(chartX);
      if (tooltip) {
        setTooltipData(tooltip);
      }
    } else if (event.touches.length === 2) {
      event.preventDefault();
      setTooltipData(null);
      const x0 = getChartX(event, 0);
      const x1 = getChartX(event, 1);
      if (x0 === null || x1 === null) {
        return;
      }
      const startX = Math.min(x0, x1);
      const endX = Math.max(x0, x1);
      setSelection({
        startX,
        endX,
        startIndex: resolveIndexFromX(startX),
        endIndex: resolveIndexFromX(endX),
        active: true,
      });
    }
  }, [getChartX, resolveTooltipFromX, resolveIndexFromX]);

  const handleTouchMove = useCallback((event) => {
    if (event.touches.length === 1) {
      event.preventDefault();
      const chartX = getChartX(event, 0);
      if (chartX === null) {
        return;
      }
      const tooltip = resolveTooltipFromX(chartX);
      if (tooltip) {
        setTooltipData(tooltip);
      }
    } else if (event.touches.length === 2) {
      event.preventDefault();
      const x0 = getChartX(event, 0);
      const x1 = getChartX(event, 1);
      if (x0 === null || x1 === null) {
        return;
      }
      const startX = Math.min(x0, x1);
      const endX = Math.max(x0, x1);
      setSelection({
        startX,
        endX,
        startIndex: resolveIndexFromX(startX),
        endIndex: resolveIndexFromX(endX),
        active: true,
      });
    }
  }, [getChartX, resolveTooltipFromX, resolveIndexFromX]);

  const handleTouchEnd = useCallback(() => {
    setTooltipData(null);
    setSelection(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const interactionHandlers = canInteract
    ? {
        onMouseMove: handleMouseMove,
        onMouseLeave: handleMouseLeave,
        onMouseDown: handleMouseDown,
        onMouseUp: handleMouseUp,
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
      }
    : {};

  const interactionStyle = {
    cursor: canInteract ? "crosshair" : "default",
    touchAction: "none",
  };

  return {
    tooltipData,
    setTooltipData,
    selection,
    clearSelection,
    interactionHandlers,
    interactionStyle,
  };
}
