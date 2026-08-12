import { useWindowDimensions, ScaledSize, Platform } from 'react-native';
import { useMemo } from 'react';

// Screen size breakpoints (based on iOS device widths)
export const BREAKPOINTS = {
  xs: 0,      // iPhone SE, small phones
  sm: 375,    // iPhone 13 mini, standard phones
  md: 414,    // iPhone 13/14/15 Pro Max, larger phones
  lg: 768,    // iPad mini
  xl: 1024,   // iPad Pro 11"
  xxl: 1366,  // iPad Pro 12.9"
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

// Device type detection
export type DeviceType = 'phone' | 'tablet' | 'desktop';

export interface ResponsiveInfo {
  // Screen dimensions
  width: number;
  height: number;

  // Current breakpoint
  breakpoint: Breakpoint;

  // Device type
  deviceType: DeviceType;

  // Orientation
  isLandscape: boolean;
  isPortrait: boolean;

  // Convenience booleans
  isPhone: boolean;
  isTablet: boolean;
  isSmallPhone: boolean;
  isLargePhone: boolean;

  // Responsive scaling factors
  fontScale: number;        // Scale factor for fonts (1.0 = base)
  spacingScale: number;     // Scale factor for spacing/padding
  componentScale: number;   // Scale factor for component sizes

  // Responsive value helpers
  wp: (percentage: number) => number;  // Width percentage
  hp: (percentage: number) => number;  // Height percentage
  rs: (size: number) => number;        // Responsive size (scales with screen)
  rf: (size: number) => number;        // Responsive font (scales for readability)

  // Breakpoint-based value selector
  select: <T>(values: Partial<Record<Breakpoint, T>> & { default: T }) => T;

  // Max width for content containers (prevents ultra-wide layouts on tablets)
  maxContentWidth: number;
}

/**
 * Get the current breakpoint based on screen width
 */
function getBreakpoint(width: number): Breakpoint {
  if (width >= BREAKPOINTS.xxl) return 'xxl';
  if (width >= BREAKPOINTS.xl) return 'xl';
  if (width >= BREAKPOINTS.lg) return 'lg';
  if (width >= BREAKPOINTS.md) return 'md';
  if (width >= BREAKPOINTS.sm) return 'sm';
  return 'xs';
}

/**
 * Get device type based on screen dimensions
 */
function getDeviceType(width: number, height: number): DeviceType {
  const minDimension = Math.min(width, height);
  const maxDimension = Math.max(width, height);

  // Tablets have minimum dimension >= 600dp typically
  if (minDimension >= 600) {
    return 'tablet';
  }

  // Large phones in landscape might look like tablets
  // but we still treat them as phones
  if (maxDimension >= 1024 && minDimension >= 500) {
    return 'tablet';
  }

  return 'phone';
}

/**
 * Calculate font scale factor based on screen width
 * Base is iPhone 13 Pro (390pt width)
 */
function getFontScale(width: number): number {
  const baseWidth = 390;
  const scale = width / baseWidth;

  // Clamp between 0.85 and 1.3 to prevent extreme scaling
  return Math.min(Math.max(scale, 0.85), 1.3);
}

/**
 * Calculate spacing scale factor
 * Slightly more aggressive than font scaling
 */
function getSpacingScale(width: number): number {
  const baseWidth = 390;
  const scale = width / baseWidth;

  // Clamp between 0.8 and 1.5
  return Math.min(Math.max(scale, 0.8), 1.5);
}

/**
 * Calculate component scale factor
 */
function getComponentScale(width: number, deviceType: DeviceType): number {
  const baseWidth = 390;
  const scale = width / baseWidth;

  // Tablets get less aggressive scaling to prevent giant components
  if (deviceType === 'tablet') {
    return Math.min(Math.max(scale * 0.8, 0.9), 1.2);
  }

  return Math.min(Math.max(scale, 0.85), 1.25);
}

/**
 * Get maximum content width based on device type
 * Prevents content from stretching too wide on tablets
 */
function getMaxContentWidth(width: number, deviceType: DeviceType): number {
  if (deviceType === 'tablet') {
    // On tablets, limit content width for better readability
    return Math.min(width, 600);
  }
  // On phones, use full width
  return width;
}

/**
 * Hook for responsive design utilities
 * Provides screen dimensions, breakpoints, and scaling helpers
 */
export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const breakpoint = getBreakpoint(width);
    const deviceType = getDeviceType(width, height);
    const isLandscape = width > height;

    const fontScale = getFontScale(width);
    const spacingScale = getSpacingScale(width);
    const componentScale = getComponentScale(width, deviceType);
    const maxContentWidth = getMaxContentWidth(width, deviceType);

    // Width percentage helper
    const wp = (percentage: number): number => {
      return Math.round((percentage / 100) * width);
    };

    // Height percentage helper
    const hp = (percentage: number): number => {
      return Math.round((percentage / 100) * height);
    };

    // Responsive size helper (for spacing, padding, margins)
    const rs = (size: number): number => {
      return Math.round(size * spacingScale);
    };

    // Responsive font helper
    const rf = (size: number): number => {
      return Math.round(size * fontScale);
    };

    // Breakpoint-based value selector
    const select = <T,>(values: Partial<Record<Breakpoint, T>> & { default: T }): T => {
      // Check breakpoints from largest to smallest
      const breakpointOrder: Breakpoint[] = ['xxl', 'xl', 'lg', 'md', 'sm', 'xs'];
      const currentIndex = breakpointOrder.indexOf(breakpoint);

      // Find the first defined value at or below current breakpoint
      for (let i = currentIndex; i < breakpointOrder.length; i++) {
        const bp = breakpointOrder[i];
        if (values[bp] !== undefined) {
          return values[bp] as T;
        }
      }

      return values.default;
    };

    return {
      width,
      height,
      breakpoint,
      deviceType,
      isLandscape,
      isPortrait: !isLandscape,
      isPhone: deviceType === 'phone',
      isTablet: deviceType === 'tablet',
      isSmallPhone: deviceType === 'phone' && width < BREAKPOINTS.sm,
      isLargePhone: deviceType === 'phone' && width >= BREAKPOINTS.md,
      fontScale,
      spacingScale,
      componentScale,
      wp,
      hp,
      rs,
      rf,
      select,
      maxContentWidth,
    };
  }, [width, height]);
}

/**
 * Helper to create responsive styles object
 * Use with StyleSheet.create() or inline styles
 */
export function createResponsiveStyles<T extends Record<string, unknown>>(
  stylesFactory: (responsive: ResponsiveInfo) => T
): () => T {
  return () => {
    const responsive = useResponsive();
    return stylesFactory(responsive);
  };
}

export default useResponsive;
